using System.Globalization;
using System.Security.Claims;
using ClimateTracking.Application.Auth;
using ClimateTracking.Application.Export;
using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateTracking.Api.Endpoints;

/// <summary>
/// Procomer acceptance criterion 7: the plans can be exported with the column structure of the
/// client's own template. See <see cref="TrackingSheetExport"/> for the column contract, the
/// transforms, and why this direction is the only direction.
/// </summary>
public static class TrackingSheetExportEndpoints
{
    /// <summary>
    /// A GET, and only a GET. There is no counterpart that reads this sheet back in: "Estado"
    /// is calculated by the domain and a filled-in dropdown must never be able to overwrite it
    /// (<see cref="TrackingSheetExport"/>).
    /// </summary>
    public static void MapTrackingSheetExportEndpoints(this WebApplication app)
    {
        app.MapGet("/api/planes-accion/export", ExportAsync)
            .RequireAuthorization()
            .WithName("ExportPlanesAccion");
    }

    private static async Task<IResult> ExportAsync(
        ClaimsPrincipal user,
        ClimateTrackingDbContext db,
        IClimateProjectClient climateProjectClient,
        ILogger<Program> logger,
        string? nodoId,
        string? estado,
        CancellationToken cancellationToken)
    {
        var currentUser = user.GetCurrentUser();

        // Same predicate as GET /api/planes-accion, so the sheet can never contain a row the
        // list endpoint would have withheld from this caller. The filters are accepted for the
        // same reason: what you exported should be what you were looking at.
        var planes = await PlanesAccionEndpoints
            .Visible(db.PlanesDeAccion.Include("_bitacora"), currentUser, nodoId, estado)
            // PlanCode is zero-padded (PA-2026-00007), so ordinal order is creation order, and
            // an ordered query is what makes the sheet's "No." column stable between runs.
            .OrderBy(p => p.PlanCode)
            .ToListAsync(cancellationToken);

        var lookups = new TrackingSheetLookups(
            await NodosAsync(db, planes, cancellationToken),
            await PersonasAsync(db, planes, cancellationToken),
            await CategoriasAsync(planes, climateProjectClient, logger, cancellationToken));

        var fileName = string.Create(
            CultureInfo.InvariantCulture,
            $"seguimiento-planes-accion-{DateTime.UtcNow:yyyy-MM-dd}.csv");

        return Results.File(TrackingSheetExport.Build(planes, lookups), "text/csv; charset=utf-8", fileName);
    }

    private static async Task<IReadOnlyDictionary<string, string>> NodosAsync(
        ClimateTrackingDbContext db, IReadOnlyCollection<PlanDeAccion> planes, CancellationToken cancellationToken)
    {
        var ids = planes.Select(p => p.NodoExternalId).Distinct().ToList();
        return await db.Nodos
            .Where(n => ids.Contains(n.ExternalId))
            .ToDictionaryAsync(n => n.ExternalId, n => n.Nombre, StringComparer.Ordinal, cancellationToken);
    }

    private static async Task<IReadOnlyDictionary<string, PersonaCache>> PersonasAsync(
        ClimateTrackingDbContext db, IReadOnlyCollection<PlanDeAccion> planes, CancellationToken cancellationToken)
    {
        var ids = planes
            .SelectMany(p => p.InvolucradosExternalIds.Append(p.LiderExternalId).Append(p.ResponsableEjecucionExternalId))
            .Distinct()
            .ToList();

        return await db.Personas
            .Where(p => ids.Contains(p.ExternalId))
            .ToDictionaryAsync(p => p.ExternalId, p => p, StringComparer.Ordinal, cancellationToken);
    }

    /// <summary>
    /// hallazgo id → categoría, for the sheet's "Hallazgo (tema de la encuesta)" column.
    /// </summary>
    /// <remarks>
    /// Fetched per ciclo rather than per plan: the hallazgos cache table was dropped
    /// (<c>DropHallazgosCache</c>), so categorías live only in climate-project, and a sheet of
    /// forty plans drawn from two survey cycles should cost two calls rather than forty.
    /// Plans created while climate-project was unreachable have a hallazgo but no ciclo — those
    /// are not resolvable this way and fall back to the raw hallazgo id, exactly as an
    /// unreachable climate-project does here.
    ///
    /// A failed lookup must not fail the export. This mirrors the enrichment-only handling in
    /// <c>PlanesAccionEndpoints.CreateAsync</c>, including which exception it declines to
    /// swallow: a genuine caller-initiated cancellation still propagates, while everything a
    /// reachable-but-misbehaving climate-project can throw (a 200 with no "data", a non-JSON
    /// proxy interstitial, a truncated body) is logged and costs the sheet one column's worth
    /// of prettiness rather than the whole file.
    /// </remarks>
    private static async Task<IReadOnlyDictionary<string, string>> CategoriasAsync(
        IReadOnlyCollection<PlanDeAccion> planes,
        IClimateProjectClient climateProjectClient,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var categorias = new Dictionary<string, string>(StringComparer.Ordinal);

        var ciclos = planes
            .Where(p => p.HallazgoExternalId is not null && p.CicloEncuestaExternalId is not null)
            .Select(p => p.CicloEncuestaExternalId!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        foreach (var ciclo in ciclos)
        {
            try
            {
                foreach (var hallazgo in await climateProjectClient.GetHallazgosAsync(ciclo, cancellationToken))
                {
                    categorias[hallazgo.HallazgoId] = hallazgo.Categoria;
                }
            }
            catch (Exception ex) when (
                !(ex is OperationCanceledException && cancellationToken.IsCancellationRequested))
            {
                logger.LogError(
                    ex,
                    "Hallazgo lookup failed for ciclo {CicloExternalId}; exporting those rows with the hallazgo id",
                    ciclo);
            }
        }

        return categorias;
    }
}
