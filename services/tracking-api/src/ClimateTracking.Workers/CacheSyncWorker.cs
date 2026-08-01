using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateTracking.Workers;

/// <summary>
/// Polls climate-project's /internal/nodos, /internal/personas, and /internal/ciclos-encuesta
/// on an interval and upserts the corresponding cache tables.
///
/// Hallazgos are deliberately NOT synced here -- they're looked up on-demand via
/// IClimateProjectClient.GetHallazgoByIdAsync in PlanesAccionEndpoints.CreateAsync
/// instead of cached, since they're only needed at plan-creation time for a single
/// hallazgo, not queried in bulk like nodos/personas/ciclos.
/// </summary>
public class CacheSyncWorker(
    IServiceScopeFactory scopeFactory,
    IClimateProjectClient client,
    ILogger<CacheSyncWorker> logger,
    TimeSpan? syncInterval = null) : BackgroundService
{
    private readonly TimeSpan _syncInterval = syncInterval ?? TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(_syncInterval);
        do
        {
            await SyncOnceAsync(stoppingToken);
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task SyncOnceAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();

        await SyncEntityTypeAsync("nodos", () => SyncNodosAsync(db, cancellationToken));
        await SyncEntityTypeAsync("personas", () => SyncPersonasAsync(db, cancellationToken));
        await SyncEntityTypeAsync("ciclos-encuesta", () => SyncCiclosAsync(db, cancellationToken));
    }

    private async Task SyncEntityTypeAsync(string entityTypeName, Func<Task> sync)
    {
        try
        {
            await sync();
        }
        catch (Exception ex)
        {
            // One failing entity type (e.g. /internal/personas briefly down) must not block
            // the others from syncing on this tick.
            logger.LogError(ex, "Cache sync failed for {EntityType}", entityTypeName);
        }
    }

    private async Task SyncNodosAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var nodos = await client.GetNodosAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;

        foreach (var dto in nodos)
        {
            var existing = await db.Nodos.FirstOrDefaultAsync(n => n.ExternalId == dto.NodoId, cancellationToken);
            if (existing is null)
            {
                db.Nodos.Add(new NodoCache
                {
                    ExternalId = dto.NodoId,
                    Nombre = dto.Nombre,
                    NodoPadreExternalId = dto.NodoPadreId,
                    LiderExternalId = dto.LiderId ?? string.Empty,
                    CantidadColaboradores = dto.CantidadColaboradores,
                    Activo = dto.Activo,
                    LastSyncedAt = now,
                });
            }
            else
            {
                existing.Nombre = dto.Nombre;
                existing.NodoPadreExternalId = dto.NodoPadreId;
                existing.LiderExternalId = dto.LiderId ?? string.Empty;
                existing.CantidadColaboradores = dto.CantidadColaboradores;
                existing.Activo = dto.Activo;
                existing.LastSyncedAt = now;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task SyncPersonasAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var personas = await client.GetPersonasAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;

        foreach (var dto in personas)
        {
            var existing = await db.Personas.FirstOrDefaultAsync(p => p.ExternalId == dto.PersonaId, cancellationToken);
            if (existing is null)
            {
                db.Personas.Add(new PersonaCache
                {
                    ExternalId = dto.PersonaId,
                    NombreCompleto = dto.NombreCompleto,
                    Correo = dto.Correo,
                    NodoExternalId = dto.NodoId,
                    LastSyncedAt = now,
                });
            }
            else
            {
                existing.NombreCompleto = dto.NombreCompleto;
                existing.Correo = dto.Correo;
                existing.NodoExternalId = dto.NodoId;
                existing.LastSyncedAt = now;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task SyncCiclosAsync(ClimateTrackingDbContext db, CancellationToken cancellationToken)
    {
        var ciclos = await client.GetCiclosAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;

        foreach (var dto in ciclos)
        {
            var existing = await db.CiclosEncuesta.FirstOrDefaultAsync(c => c.ExternalId == dto.CicloId, cancellationToken);
            var estado = dto.Estado == "cerrado"
                ? Domain.Enums.EstadoCicloEncuesta.Cerrado
                : Domain.Enums.EstadoCicloEncuesta.Abierto;

            if (existing is null)
            {
                db.CiclosEncuesta.Add(new CicloEncuestaCache
                {
                    ExternalId = dto.CicloId,
                    FechaApertura = DateOnly.FromDateTime(dto.FechaApertura.UtcDateTime),
                    FechaCierre = DateOnly.FromDateTime(dto.FechaCierre.UtcDateTime),
                    NumeroPreguntas = dto.NumeroPreguntas,
                    Estado = estado,
                    LastSyncedAt = now,
                });
            }
            else
            {
                existing.FechaApertura = DateOnly.FromDateTime(dto.FechaApertura.UtcDateTime);
                existing.FechaCierre = DateOnly.FromDateTime(dto.FechaCierre.UtcDateTime);
                existing.NumeroPreguntas = dto.NumeroPreguntas;
                existing.Estado = estado;
                existing.LastSyncedAt = now;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
