using System.Security.Claims;
using ClimateTracking.Application.Auth;
using ClimateTracking.Application.Dashboards;
using ClimateTracking.Application.PlanesAccion;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api").RequireAuthorization();

        group.MapGet("/tablero-seguimiento", TableroAsync);
        group.MapGet("/consolidado", ConsolidadoAsync);
        group.MapGet("/mis-tareas", MisTareasAsync);
    }

    private static async Task<IResult> TableroAsync(
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        string? nodoId,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();
        var targetNodoId = nodoId ?? currentUser.NodoExternalId;

        if (!Roles.Admin.Contains(currentUser.Role) && targetNodoId != currentUser.NodoExternalId)
        {
            return Results.Forbid();
        }

        var plans = await db.PlanesDeAccion
            .Where(p => p.NodoExternalId == targetNodoId)
            .ToListAsync(cancellationToken);

        return Results.Ok(new TableroResponse(
            targetNodoId,
            CountSemaforo(plans),
            plans.Select(PlanResponse.From).ToList()));
    }

    private static async Task<IResult> ConsolidadoAsync(
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role))
        {
            return Results.Forbid();
        }

        var plans = await db.PlanesDeAccion.ToListAsync(cancellationToken);
        var porNodo = plans
            .GroupBy(p => p.NodoExternalId)
            .Select(g => new NodoConsolidado(g.Key, CountSemaforo(g.ToList()), g.Count()))
            .ToList();

        return Results.Ok(new ConsolidadoResponse(CountSemaforo(plans), porNodo));
    }

    private static async Task<IResult> MisTareasAsync(
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();

        // See PlanesAccionEndpoints.ListAsync — InvolucradosExternalIds is Ignore()'d in EF
        // config, so querying it requires going through the mapped backing field.
        var plans = await db.PlanesDeAccion
            .Where(p =>
                p.ResponsableEjecucionExternalId == currentUser.PersonaExternalId ||
                EF.Property<List<string>>(p, "_involucradosExternalIds").Contains(currentUser.PersonaExternalId))
            .ToListAsync(cancellationToken);

        return Results.Ok(plans.Select(PlanResponse.From));
    }

    private static SemaforoCounts CountSemaforo(IReadOnlyCollection<PlanDeAccion> plans) => new(
        Rojo: plans.Count(p => p.EstadoSemaforo == EstadoSemaforo.Rojo),
        Amarillo: plans.Count(p => p.EstadoSemaforo == EstadoSemaforo.Amarillo),
        Verde: plans.Count(p => p.EstadoSemaforo == EstadoSemaforo.Verde));
}
