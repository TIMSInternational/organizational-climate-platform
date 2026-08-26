using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using ClimateTracking.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateTracking.Workers;

/// <summary>
/// Once a day: recalculates semaforo for every open PlanDeAccion, then evaluates and
/// dispatches the 30-day/15-day/vencimiento notification triggers. Each trigger fires once
/// per plan, ever — idempotency is "has this trigger already been sent successfully"
/// (Notificacion.EstadoEnvio == Enviado), not "sent today", so a Fallido day is retried on
/// every subsequent run until it succeeds (a same-day-only check would permanently lose
/// Alerta15Dias/Recordatorio30Dias, which each only match one specific day).
///
/// <para><b>This is the worker the lease exists for.</b> "Has this trigger already been
/// recorded Enviado for this plan" is a read followed by a write with nothing between them,
/// so two instances ticking together both read "not sent" and both send. Since #219 the API
/// image hosts this worker on every instance, so that is no longer hypothetical: it is
/// duplicate 30-day and 15-day emails about the client's own action plans, in front of a
/// government client. <see cref="LeasedScheduledWorker"/> takes a Postgres advisory lock for
/// the whole run, so only one instance is ever inside it.</para>
/// </summary>
public class DailySemaforoWorker(
    IServiceScopeFactory scopeFactory,
    IClimateProjectClient client,
    ILogger<DailySemaforoWorker> logger,
    bool enabled = true)
    : LeasedScheduledWorker(TrackingJobs.DailySemaforo, TimeSpan.FromHours(24), enabled, scopeFactory, logger)
{
    protected override Task RunTickAsync(CancellationToken cancellationToken) =>
        RunOnceAsync(DateOnly.FromDateTime(DateTime.UtcNow), cancellationToken);

    /// <summary>
    /// One daily pass, for the given date.
    ///
    /// <para>Public and callable outside a lease so the tests can drive a run against a
    /// simulated "today". In the host it is only ever reached through
    /// <see cref="LeasedScheduledWorker.TickAsync"/>, which holds the lease around it.</para>
    /// </summary>
    public async Task RunOnceAsync(DateOnly today, CancellationToken cancellationToken)
    {
        using var scope = ScopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateTrackingDbContext>();
        var config = await db.SemaforoThresholdConfigs.SingleAsync(
            c => c.Id == SemaforoThresholdConfig.DefaultConfigId, cancellationToken);

        var openPlans = await db.PlanesDeAccion
            .Include("_bitacora")
            .Where(p => !p.Cumplido)
            .ToListAsync(cancellationToken);

        foreach (var plan in openPlans)
        {
            try
            {
                await ProcessPlanAsync(db, plan, config, today, cancellationToken);
                // Saved per plan (not once for the whole batch) so a failure partway
                // through the batch can't roll back notifications already dispatched
                // to other plans earlier in this same run — see CacheSyncWorker for the
                // same per-entity isolation principle applied there.
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to process daily semaforo/notification for plan {PlanId}", plan.Id);
            }
        }
    }

    private async Task ProcessPlanAsync(
        ClimateTrackingDbContext db,
        PlanDeAccion plan,
        SemaforoThresholdConfig config,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        plan.RecalcularSemaforo(today, config);

        var trigger = DetermineTrigger(plan, today);
        if (trigger is null)
        {
            return;
        }

        var alreadySent = await db.Notificaciones.AnyAsync(
            n => n.PlanDeAccionId == plan.Id
                && n.TipoDisparador == trigger.Value
                && n.EstadoEnvio == EstadoEnvioNotificacion.Enviado,
            cancellationToken);
        if (alreadySent)
        {
            return;
        }

        await DispatchAsync(db, plan, trigger.Value, today, cancellationToken);
    }

    private static TipoDisparadorNotificacion? DetermineTrigger(PlanDeAccion plan, DateOnly today)
    {
        var diasRestantes = plan.FechaCompromiso.DayNumber - today.DayNumber;

        // Windows (not exact-day matches) so a run that's late or was skipped a day still
        // catches up, and so a Fallido at, say, day 28 retries on day 27, 26, ... down to 16
        // rather than only ever getting one shot at exactly day 30.
        if (diasRestantes < 0)
        {
            return TipoDisparadorNotificacion.Vencimiento;
        }
        if (diasRestantes <= 15)
        {
            return TipoDisparadorNotificacion.Alerta15Dias;
        }
        if (diasRestantes <= 30)
        {
            return TipoDisparadorNotificacion.Recordatorio30Dias;
        }

        return null;
    }

    private static string TriggerToWireFormat(TipoDisparadorNotificacion trigger) => trigger switch
    {
        TipoDisparadorNotificacion.Recordatorio30Dias => "recordatorio_30_dias",
        TipoDisparadorNotificacion.Alerta15Dias => "alerta_15_dias",
        TipoDisparadorNotificacion.Vencimiento => "vencimiento",
        TipoDisparadorNotificacion.ActualizacionAvance => "actualizacion_avance",
        TipoDisparadorNotificacion.AperturaCiclo => "apertura_ciclo",
        _ => throw new ArgumentOutOfRangeException(nameof(trigger)),
    };

    private async Task DispatchAsync(
        ClimateTrackingDbContext db,
        PlanDeAccion plan,
        TipoDisparadorNotificacion trigger,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var destinatarios = new[] { plan.LiderExternalId, plan.ResponsableEjecucionExternalId }
            .Concat(plan.InvolucradosExternalIds)
            .Distinct()
            .ToList();
        var contenido = trigger switch
        {
            TipoDisparadorNotificacion.Vencimiento =>
                $"El plan {plan.PlanCode} vencio el {plan.FechaCompromiso:yyyy-MM-dd} y no ha sido marcado como cumplido.",
            TipoDisparadorNotificacion.Alerta15Dias =>
                $"El plan {plan.PlanCode} vence en 15 dias ({plan.FechaCompromiso:yyyy-MM-dd}).",
            _ => $"El plan {plan.PlanCode} vence en 30 dias ({plan.FechaCompromiso:yyyy-MM-dd}).",
        };

        var notificacion = new Notificacion
        {
            Id = Guid.NewGuid(),
            PlanDeAccionId = plan.Id,
            TipoDisparador = trigger,
            Destinatarios = destinatarios,
            Canal = CanalNotificacion.Correo,
            // Stamped from the simulated "today" parameter, not DateTimeOffset.UtcNow —
            // keeps it consistent with whatever date drove RecalcularSemaforo/DetermineTrigger
            // above (matters for tests and any future backfill run using a non-current date).
            FechaEnvio = new DateTimeOffset(today.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero),
            Contenido = contenido,
            EstadoEnvio = EstadoEnvioNotificacion.Pendiente,
        };

        try
        {
            await client.SendNotificationAsync(
                new SendNotificationRequest(destinatarios, TriggerToWireFormat(trigger), contenido, plan.Id.ToString()),
                cancellationToken);
            notificacion.EstadoEnvio = EstadoEnvioNotificacion.Enviado;
        }
        catch (Exception ex)
        {
            // Left as Fallido — the next run's DetermineTrigger/alreadySent check (querying
            // for EstadoEnvio == Enviado, not "sent today") will retry it automatically.
            logger.LogError(ex, "Failed to dispatch {Trigger} for plan {PlanId}", trigger, plan.Id);
            notificacion.EstadoEnvio = EstadoEnvioNotificacion.Fallido;
        }

        db.Notificaciones.Add(notificacion);
    }
}
