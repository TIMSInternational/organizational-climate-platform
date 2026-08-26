using ClimateTracking.Application.ExternalApi;
using ClimateTracking.Application.Scheduling;
using ClimateTracking.Infrastructure.Scheduling;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace ClimateTracking.Workers;

/// <summary>
/// Options for the co-hosted background jobs. Bound from the <c>Workers</c> configuration
/// section.
/// </summary>
public sealed class TrackingWorkerOptions
{
    public const string SectionName = "Workers";

    /// <summary>
    /// Whether the jobs tick in this host. Default true, so production -- which sets nothing --
    /// gets the jobs. The integration suite sets it false: a test host that swept its own
    /// database and dialled a nonexistent climate-project on every boot would be racing the
    /// test it is hosting.
    /// </summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// Registers the tracking service's background jobs in one call.
///
/// <para>An extension method rather than inline wiring so the same two jobs can be hosted
/// either by <c>ClimateTracking.Workers</c>' own <c>Program.cs</c> or by the API host,
/// without the registration being written twice and drifting -- the drift that mattered here
/// being that the API host had NO registration at all, so a deployed tracking service served
/// HTTP and synced nothing: the <c>*_cache</c> tables stayed empty, so every nodo and persona
/// NAME in the plans list and in the <c>.xlsx</c> export rendered blank, and no
/// 30-day/15-day/vencimiento notification was ever sent.</para>
///
/// <para>#219 makes the API host the one that calls this, which is the deployment #275 chose
/// for climate-project: the API image IS the scheduler, and the standalone worker host is kept
/// as the documented opt-out. Not a preference -- App Runner requires the container to bind
/// the configured port and pass a health check, and <c>ClimateTracking.Workers</c> is a
/// <c>Host</c>, not a <c>WebApplication</c>, so it never binds one.</para>
///
/// <para>Assumes the caller has already registered <c>ClimateTrackingDbContext</c> and
/// <see cref="IClimateProjectClient"/>; both are shared with the API and neither should be
/// configured differently just because a worker is resolving it.</para>
/// </summary>
public static class WorkerServiceCollectionExtensions
{
    public static IServiceCollection AddClimateTrackingWorkers(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<TrackingWorkerOptions>()
            .Bind(configuration.GetSection(TrackingWorkerOptions.SectionName));

        // Scoped, because it takes a transaction on the scoped DbContext's connection and
        // holds it for exactly the life of one tick.
        services.AddScoped<IJobLease, PostgresAdvisoryJobLease>();

        // Read from the root, not from the Workers section, because that is the name the
        // CloudFormation service template passes as a plain environment variable
        // (CacheSyncIntervalMinutes) and the name ClimateTracking.Workers' own Program.cs has
        // always used. Renaming it here would silently restore the 15-minute default on a
        // deploy that thought it had configured something else.
        var cacheSyncIntervalMinutes = configuration.GetValue<double?>("CacheSyncIntervalMinutes") ?? 15;

        // Enabled is resolved INSIDE the factories -- i.e. when the host starts and the
        // service provider is built -- rather than read off `configuration` here. In the
        // integration suite this registration runs while Program.cs is still composing, which
        // is before WebApplicationFactory's in-memory overrides are applied (they land at
        // builder.Build()), so a value read here would ignore Workers:Enabled=false and tick
        // every job against every test database.
        services.AddSingleton<IHostedService>(sp => new CacheSyncWorker(
            sp.GetRequiredService<IServiceScopeFactory>(),
            sp.GetRequiredService<IClimateProjectClient>(),
            sp.GetRequiredService<ILogger<CacheSyncWorker>>(),
            TimeSpan.FromMinutes(cacheSyncIntervalMinutes),
            sp.GetRequiredService<IOptions<TrackingWorkerOptions>>().Value.Enabled));

        services.AddSingleton<IHostedService>(sp => new DailySemaforoWorker(
            sp.GetRequiredService<IServiceScopeFactory>(),
            sp.GetRequiredService<IClimateProjectClient>(),
            sp.GetRequiredService<ILogger<DailySemaforoWorker>>(),
            sp.GetRequiredService<IOptions<TrackingWorkerOptions>>().Value.Enabled));

        return services;
    }
}
