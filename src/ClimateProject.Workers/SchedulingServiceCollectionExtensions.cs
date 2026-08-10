using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Scheduling;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ClimateProject.Workers;

/// <summary>
/// Registers the whole scheduler in one call.
///
/// <para>An extension method rather than inline wiring in <c>Program.cs</c> so that the same
/// jobs can be hosted either by this standalone worker process or by the API process,
/// without the registration being written twice and drifting. That is a real choice #275 has to
/// make at cutover, and the advisory lease is what makes it a free one: the jobs behave
/// identically whether they run in one dedicated instance or in all twenty-five API instances.
/// The trade is operational, not correctness -- a separate service is one more thing to deploy
/// and monitor, co-hosting shares the API's CPU and connection pool.</para>
///
/// <para>Nothing here is registered into the API today. Choosing where the scheduler runs is a
/// deployment decision and belongs with the deployment work, not smuggled in as a side effect
/// of adding the jobs.</para>
/// </summary>
public static class SchedulingServiceCollectionExtensions
{
    /// <summary>
    /// Add every scheduled job in <see cref="WorkerJobs.All"/>, the heartbeat registry and the
    /// liveness monitor.
    ///
    /// <para>Assumes the caller has already registered <c>ClimateProjectDbContext</c> and an
    /// <see cref="INotificationSender"/> -- both are shared with the API and neither should be
    /// configured differently just because a worker is resolving it.</para>
    /// </summary>
    public static IServiceCollection AddClimateProjectScheduling(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var options = new WorkerSchedulingOptions();
        configuration.GetSection(WorkerSchedulingOptions.SectionName).Bind(options);

        // Validated here, at startup, rather than by IValidateOptions resolved on first use:
        // the first use of these options is inside a background thread, where an exception
        // stops one job and leaves the host reporting healthy. #189's principle, applied to the
        // one place where a late failure is *less* visible than in a request pipeline.
        options.Validate();

        services.AddSingleton(Microsoft.Extensions.Options.Options.Create(options));
        services.AddSingleton<WorkerHeartbeats>();

        // Scoped, because it takes a transaction on the scoped DbContext's connection and holds
        // it for exactly the life of one tick.
        services.AddScoped<IJobLease, PostgresAdvisoryJobLease>();

        // The seam #91 replaces. See IScheduledReportRunner.
        services.AddScoped<IScheduledReportRunner, LoggingScheduledReportRunner>();

        if (!options.Enabled)
        {
            // The registry and the options are still registered so the host starts and can be
            // inspected; only the timers are absent.
            return services;
        }

        services.AddHostedService<NotificationDispatchWorker>();
        services.AddHostedService<InvitationReminderWorker>();
        services.AddHostedService<DigestWorker>();
        services.AddHostedService<ScheduledReportWorker>();
        services.AddHostedService<SurveyDraftRetentionWorker>();
        services.AddHostedService<WorkerHeartbeatMonitor>();

        return services;
    }
}
