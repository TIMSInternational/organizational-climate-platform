using System.Security.Claims;
using ClimateTracking.Application.Auth;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Application.PlanesAccion;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.Api.Endpoints;

public static class PlanesAccionEndpoints
{
    public static void MapPlanesAccionEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/planes-accion").RequireAuthorization();

        group.MapPost("/", CreateAsync);
        group.MapGet("/", ListAsync);
        group.MapGet("/{id:guid}", GetByIdAsync);
        group.MapPost("/{id:guid}/avance", RegistrarAvanceAsync);
        group.MapPost("/{id:guid}/cumplir", MarcarCumplidoAsync);
        group.MapPost("/{id:guid}/involucrados", AgregarInvolucradoAsync);
    }

    private static async Task<IResult> CreateAsync(
        CreatePlanRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IClimateProjectClient climateProjectClient,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();
        if (!Roles.PlanCreator.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        // A leader can only create plans for their own node — without this check, any
        // leader could create (and assign) plans on a node they have no authority over.
        var isAdmin = Roles.Admin.Contains(currentUser.Role);
        if (!isAdmin && currentUser.NodoExternalId != request.NodoExternalId)
        {
            return Results.Forbid();
        }

        var nodo = await db.Nodos.FirstOrDefaultAsync(n => n.ExternalId == request.NodoExternalId, cancellationToken);
        if (nodo is null)
        {
            return Results.BadRequest(new { error = $"Nodo '{request.NodoExternalId}' not found in cache." });
        }

        string? cicloExternalId = null;
        if (request.HallazgoExternalId is not null)
        {
            var hallazgo = await climateProjectClient.GetHallazgoByIdAsync(request.HallazgoExternalId, cancellationToken);
            cicloExternalId = hallazgo?.CicloId;
        }

        var fechaCreacion = DateOnly.FromDateTime(DateTime.UtcNow);
        var plan = new PlanDeAccion
        {
            // Sequential per-year numbering has a known race window under concurrent
            // creates (two requests could read the same count before either commits) —
            // acceptable for now given expected creation volume; revisit if that changes.
            PlanCode = await GeneratePlanCodeAsync(db, cancellationToken),
            NodoExternalId = request.NodoExternalId,
            LiderExternalId = nodo.LiderExternalId,
            HallazgoExternalId = request.HallazgoExternalId,
            DescripcionQue = request.DescripcionQue,
            MetodologiaComo = request.MetodologiaComo,
            ResponsableEjecucionExternalId = request.ResponsableEjecucionExternalId,
            FechaCreacion = fechaCreacion,
            FechaCompromiso = request.FechaCompromiso,
            CicloEncuestaExternalId = cicloExternalId,
        };

        foreach (var involucrado in request.Involucrados ?? [])
        {
            plan.AgregarInvolucrado(involucrado);
        }

        // FechaUltimaActualizacion has no public setter — RegistrarAvance is the domain's
        // only way to initialize it (and it also runs the initial semaforo calculation).
        var config = await db.SemaforoThresholdConfigs.SingleAsync(
            c => c.Id == SemaforoThresholdConfig.DefaultConfigId, cancellationToken);
        plan.RegistrarAvance(0m, currentUser.PersonaExternalId, "Plan creado", fechaCreacion, config);

        db.PlanesDeAccion.Add(plan);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/planes-accion/{plan.Id}", PlanResponse.From(plan));
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        string? nodoId,
        string? estado,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();

        IQueryable<PlanDeAccion> query = db.PlanesDeAccion;

        if (!Roles.Admin.Contains(currentUser.Role))
        {
            // InvolucradosExternalIds is Ignore()'d in EF config (it's a read-only wrapper
            // over the private "_involucradosExternalIds" field, which is what's actually
            // mapped) — querying the wrapper isn't translatable, so go through EF.Property.
            query = query.Where(p =>
                p.NodoExternalId == currentUser.NodoExternalId ||
                p.ResponsableEjecucionExternalId == currentUser.PersonaExternalId ||
                EF.Property<List<string>>(p, "_involucradosExternalIds").Contains(currentUser.PersonaExternalId));
        }

        if (!string.IsNullOrEmpty(nodoId))
        {
            query = query.Where(p => p.NodoExternalId == nodoId);
        }

        if (!string.IsNullOrEmpty(estado) && Enum.TryParse<Domain.Enums.EstadoSemaforo>(estado, true, out var parsedEstado))
        {
            query = query.Where(p => p.EstadoSemaforo == parsedEstado);
        }

        var plans = await query.ToListAsync(cancellationToken);
        return Results.Ok(plans.Select(PlanResponse.From));
    }

    private static async Task<IResult> GetByIdAsync(
        Guid id,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Read));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<IResult> RegistrarAvanceAsync(
        Guid id,
        RegistrarAvanceRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Write));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        var config = await db.SemaforoThresholdConfigs.SingleAsync(
            c => c.Id == SemaforoThresholdConfig.DefaultConfigId, cancellationToken);

        var currentUser = user.GetCurrentUser();
        try
        {
            plan.RegistrarAvance(request.PorcentajeAvance, currentUser.PersonaExternalId, request.Comentario, request.Fecha, config);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<IResult> MarcarCumplidoAsync(
        Guid id,
        MarcarCumplidoRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Write));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        var currentUser = user.GetCurrentUser();
        plan.MarcarCumplido(request.Fecha, currentUser.PersonaExternalId);

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<IResult> AgregarInvolucradoAsync(
        Guid id,
        AgregarInvolucradoRequest request,
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IAuthorizationService authorizationService,
        CancellationToken cancellationToken)
    {
        var plan = await db.PlanesDeAccion.Include("_bitacora").FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.NotFound();
        }

        var authResult = await authorizationService.AuthorizeAsync(
            user, plan, new PlanAccessRequirement(AccessLevel.Write));
        if (!authResult.Succeeded)
        {
            return Results.Forbid();
        }

        plan.AgregarInvolucrado(request.PersonaExternalId);

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(PlanResponse.From(plan));
    }

    private static async Task<string> GeneratePlanCodeAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var year = DateTime.UtcNow.Year;
        var countThisYear = await db.PlanesDeAccion.CountAsync(
            p => p.FechaCreacion.Year == year, cancellationToken);
        return $"PA-{year}-{(countThisYear + 1):D5}";
    }
}
