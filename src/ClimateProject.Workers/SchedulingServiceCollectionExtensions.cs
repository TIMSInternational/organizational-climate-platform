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
/// jobs can be hosted either by the standalone worker process or by the API process, without
/// the registration being written twice and drifting. #275 made that choice: the API host
/// calls this method and co-hosts the jobs, so deploying the API deploys the scheduler. The
/// advisory lease is what makes that a free choice -- the jobs behave identically whether they
/// run in one dedicated instance or in all twenty-five API instances.</para>
///
/// <para><b>Every job is registered; <c>Scheduling:Enabled</c> decides whether they tick.</b>
/// The switch is consulted by each worker at startup, from <c>IOptions</c>, rather than here at
/// registration -- deliberately. This method runs while <c>Program.cs</c> is still composing,
/// and in the API's integration tests that is <em>before</em> <c>WebApplicationFactory</c>'s
/// in-memory configuration overrides are applied (they land at <c>builder.Build()</c>; see the
/// long note at the top of the API's <c>Program.cs</c>). A registration-time branch on
/// <c>Enabled</c> would therefore ignore the test suite's <c>Scheduling:Enabled=false</c> and
/// tick every job in <see cref="WorkerJobs.All"/> against every test database. Binding lazily
/// and branching in the worker reads the configuration as it stands when the host actually
/// starts.</para>
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

        // Validated twice, on purpose:
        //
        // 1. Eagerly, against the configuration as it stands right now. For the standalone
        //    worker host and for anything composing from a finished IConfiguration this is
        //    #189's fail-at-startup guard in its strongest form -- the host is refused before
        //    it is even built. (A unit test pins this: a zero interval must throw HERE.)
        var snapshot = new WorkerSchedulingOptions();
        configuration.GetSection(WorkerSchedulingOptions.SectionName).Bind(snapshot);
        snapshot.Validate();

        // 2. Lazily, against the configuration the host actually starts with, because in the
        //    API's tests the two differ (see the class remarks). ValidateOnStart materialises
        //    the options inside host start, so a bad value that only arrives via a late
        //    override still fails the host rather than a background thread.
        services.AddOptions<WorkerSchedulingOptions>()
            .Bind(configuration.GetSection(WorkerSchedulingOptions.SectionName))
            .PostConfigure(options => options.Validate())
            .ValidateOnStart();

        services.AddSingleton<WorkerHeartbeats>();

        // Scoped, because it takes a transaction on the scoped DbContext's connection and holds
        // it for exactly the life of one tick.
        services.AddScoped<IJobLease, PostgresAdvisoryJobLease>();

        // The #91 seam, filled by the host. This default is the logging stub so that a host
        // with no way to deliver a report never pretends to have delivered one; the API host
        // overrides this registration (later registration wins) with a factory that selects
        // the real generating-and-delivering runner whenever a mail provider is configured --
        // the same selection rule INotificationSender uses. See the API's Program.cs.
        services.AddScoped<IScheduledReportRunner, LoggingScheduledReportRunner>();

        services.AddHostedService<NotificationDispatchWorker>();
        services.AddHostedService<InvitationReminderWorker>();
        services.AddHostedService<DigestWorker>();
        services.AddHostedService<ScheduledReportWorker>();
        services.AddHostedService<SurveyDraftRetentionWorker>();
        services.AddHostedService<RetentionCleanupWorker>();
        services.AddHostedService<SurveyLifecycleWorker>();
        services.AddHostedService<WorkerHeartbeatMonitor>();

        return services;
    }
}
