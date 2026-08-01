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
        ILogger<Program> logger,
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
            // Enrichment only, not required for plan creation to succeed: if climate-project
            // is briefly unreachable (retries exhausted, or the Polly circuit breaker is open),
            // fall back to no cicloExternalId rather than failing the whole request with a 500.
            try
            {
                var hallazgo = await climateProjectClient.GetHallazgoByIdAsync(request.HallazgoExternalId, cancellationToken);
                cicloExternalId = hallazgo?.CicloId;
            }
            // Catch everything the lookup can throw, not just connection/5xx failures:
            // ClimateProjectClient.GetAsync does `ReadFromJsonAsync<T>(...)!` and this method
            // immediately dereferences envelope.Data.Hallazgos, so a reachable-but-misbehaving
            // climate-project can throw well past HttpRequestException/BrokenCircuitException —
            // a 200 whose body omits "data" throws NullReferenceException, a non-JSON response
            // (e.g. a proxy/HTML interstitial) throws NotSupportedException, and a truncated
            // body throws JsonException. cicloExternalId is enrichment only, so none of these
            // should turn into a 500 for plan creation.
            // The one exception we let through is a genuine caller-initiated cancellation
            // (client disconnect): OperationCanceledException/TaskCanceledException raised
            // because cancellationToken itself was signaled must still propagate instead of
            // being swallowed here — HttpClient's own request-timeout TaskCanceledException
            // (token not signaled) is still caught like any other lookup failure.
            catch (Exception ex) when (
                !(ex is OperationCanceledException && cancellationToken.IsCancellationRequested))
            {
                logger.LogError(
                    ex, "Hallazgo lookup failed for {HallazgoExternalId}; creating plan without cicloExternalId",
                    request.HallazgoExternalId);
            }
        }

        var fechaCreacion = DateOnly.FromDateTime(DateTime.UtcNow);
        var plan = new PlanDeAccion
        {
            // Sequential per-year numbering is generated from a Postgres sequence
            // (GeneratePlanCodeAsync) precisely to avoid the race window a naive
            // COUNT(*)-based approach would have under concurrent creates.
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
        // Sequence name is built from a server-side int (DateTime.UtcNow.Year), never
        // user input -- safe to interpolate directly; Postgres identifiers can't be
        // bound as query parameters anyway. Created lazily on first use per year rather
        // than pre-migrated, since future years aren't known in advance.
        var sequenceName = $"plan_code_seq_{year}";
        var prefix = $"PA-{year}-";
        bool createdNewSequence;
#pragma warning disable EF1002
        try
        {
            // Deliberately CREATE SEQUENCE without IF NOT EXISTS: this makes Postgres raise
            // a duplicate-relation error whenever the sequence already exists -- whether it
            // was created by an earlier call this year or by a concurrent request that won
            // the race to create it just now -- giving us a definite "did I just create
            // this?" signal instead of the silent no-op IF NOT EXISTS would give.
            await db.Database.ExecuteSqlRawAsync($"CREATE SEQUENCE {sequenceName}", cancellationToken);
            createdNewSequence = true;
        }
        catch (Npgsql.PostgresException ex) when (
            ex.SqlState is Npgsql.PostgresErrorCodes.UniqueViolation
                or Npgsql.PostgresErrorCodes.DuplicateObject
                or Npgsql.PostgresErrorCodes.DuplicateTable)
        {
            // A plain (non-"IF NOT EXISTS") CREATE SEQUENCE on a name that's already taken
            // deterministically raises 42P07 (duplicate_table -- sequences are relations in
            // pg_class, so this is the same error class as re-creating an existing table).
            // 23505/42710 are kept too for the genuine concurrent-race case: two requests
            // can both pass Postgres's internal "does this relation exist" check before
            // either commits, and the loser can surface as a unique-violation on pg_class's
            // name index instead of the deterministic duplicate_table.
            // Someone else already created (and, if they won a creation race, is seeding)
            // this year's sequence -- by the time we observe this, their CREATE has already
            // committed, so the sequence now exists and is safe to use.
            createdNewSequence = false;
        }

        if (createdNewSequence)
        {
            // We just created a brand-new sequence, which always starts at 1 -- but this
            // database may already hold plans for this year created before this sequence
            // existed (the old COUNT(*)-based scheme, a prior deploy, or a database
            // restored from an environment that already has data, e.g. staging/prod).
            // Seed it from the highest existing PlanCode suffix so nextval() can't
            // collide with a pre-existing unique PlanCode.
            // The suffix-is-all-digits check guards against a legacy/malformed PlanCode that
            // happens to match the '{prefix}%' LIKE filter but isn't purely numeric after the
            // prefix -- without it, CAST(... AS bigint) would throw for that row instead of
            // just being excluded from the max.
            var maxExisting = await db.Database.SqlQueryRaw<long>(
                $"""
                SELECT COALESCE(MAX(CAST(SUBSTRING("PlanCode" FROM {prefix.Length + 1}) AS bigint)), 0) AS "Value"
                FROM planes_de_accion
                WHERE "PlanCode" LIKE '{prefix}%'
                  AND SUBSTRING("PlanCode" FROM {prefix.Length + 1}) ~ '^[0-9]+$'
                """).SingleAsync(cancellationToken);
            if (maxExisting > 0)
            {
                await db.Database.ExecuteSqlRawAsync($"SELECT setval('{sequenceName}', {maxExisting})", cancellationToken);
            }
        }

        // EF Core's scalar SqlQueryRaw<T> wraps the raw SQL as
        // `SELECT s."Value" FROM (<sql>) AS s`, so the inner query's column must be
        // aliased "Value" -- nextval(...) alone produces a column literally named
        // "nextval", which makes Postgres raise 42703 (column s.Value does not exist).
        var nextVal = await db.Database.SqlQueryRaw<long>($"SELECT nextval('{sequenceName}') AS \"Value\"").SingleAsync(cancellationToken);
#pragma warning restore EF1002
        return $"PA-{year}-{nextVal:D5}";
    }
}
