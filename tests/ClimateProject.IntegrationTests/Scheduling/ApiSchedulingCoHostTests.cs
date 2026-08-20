using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.Workers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// One API host, scheduling registered but switched off, shared by every test in
/// <see cref="ApiSchedulingCoHostTests"/>. A class fixture for the reason
/// <see cref="ConfiguredEmailHostFixture"/> is one: xUnit constructs the class per test
/// method, and host boots are the hazard the "AppHost" collection exists to contain.
///
/// <para>Never dialled: the connection string points nowhere, and the whole point of the
/// heartbeat assertion below is that with <c>Scheduling:Enabled=false</c> no job ever opens a
/// connection to find that out.</para>
/// </summary>
public sealed class CoHostedApiFixture : IDisposable
{
    public WebApplicationFactory<Program> Factory { get; } = new WebApplicationFactory<Program>()
        .WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Complete valid configuration, same reasoning as ConfiguredEmailHostFixture.
                ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                ["TrackingJwtSecret"] = "integration-test-tracking-jwt-secret-32-bytes-min",
                ["InternalApiKey"] = "integration-test-internal-api-key",
                ["GoogleClientId"] = "test-google-client-id",

                // Email deliberately UNCONFIGURED: this host is the unconfigured arm of the
                // #91 runner selection. The configured arm lives in
                // EmailDeliveryRegistrationTests, whose fixture is already a configured host.
                ["Scheduling:Enabled"] = "false",
            })));

    public void Dispose() => Factory.Dispose();
}

/// <summary>
/// Does #275 actually take effect, and does it stay harmless where it must?
///
/// <para>Three claims, each of which could silently be false while every other test stays
/// green: that the API host really registers and constructs every job in
/// <see cref="WorkerJobs.All"/> plus the monitor (a missing
/// <c>AddClimateProjectScheduling</c> call deploys an API that schedules nothing, with no error
/// anywhere); that <c>Scheduling:Enabled=false</c> -- the value every test host in this suite
/// runs on -- really stops the jobs from ticking (the override only works because the workers
/// read it lazily, so an eager read would ignore it and this suite would acquire a background
/// writer per job overnight); and that unconfigured mail keeps the logging report runner
/// selected, so a host that cannot send the "report ready" mail never claims to have delivered
/// one.</para>
///
/// <para>The heartbeat assertions are deterministic, not racy: a <c>BackgroundService</c>'s
/// <c>ExecuteAsync</c> runs synchronously up to its first <c>await</c>, and both the disabled
/// early-return and the enabled path's <c>WorkerHeartbeats.Register</c> sit before any await
/// -- so by the time <c>StartAsync</c> has returned, a disabled host has deterministically
/// registered nothing and an enabled one would deterministically have registered them all.
/// (That is also what makes removing the factory's <c>Scheduling:Enabled=false</c> fail
/// <c>SharedHostTests</c> reliably rather than intermittently.)</para>
/// </summary>
[Collection("AppHost")]
public class ApiSchedulingCoHostTests(CoHostedApiFixture fixture) : IClassFixture<CoHostedApiFixture>
{
    /// <summary>
    /// Asserted against <see cref="WorkerJobs.All"/> rather than a literal count, so adding a
    /// job to the registry and forgetting to host it fails here instead of shipping a name
    /// nothing ticks. The count itself is pinned separately by
    /// <c>WorkerHostingRegistrationTests</c>.
    /// </summary>
    [Fact]
    public void The_api_host_constructs_every_scheduled_job_and_the_heartbeat_monitor()
    {
        // GetServices constructs every hosted service with its full dependency chain, so a
        // registration whose collaborators cannot resolve inside the API host fails HERE,
        // not inside a background thread's catch-and-retry where nothing fails a build.
        var hostedServices = fixture.Factory.Services.GetServices<IHostedService>().ToList();

        var jobNames = hostedServices.OfType<ScheduledJobWorker>().Select(job => job.JobName).ToList();
        Assert.Equal(WorkerJobs.All.Order(StringComparer.Ordinal), jobNames.Order(StringComparer.Ordinal));

        Assert.Single(hostedServices.OfType<WorkerHeartbeatMonitor>());
    }

    [Fact]
    public void Scheduling_disabled_means_no_job_ever_starts_ticking()
    {
        // The host is started (touching Services boots it), every job's ExecuteAsync has run,
        // and the registry the first tick would have written to is empty. This is the property
        // the whole integration suite leans on -- see AuthWebApplicationFactory.
        var heartbeats = fixture.Factory.Services.GetRequiredService<WorkerHeartbeats>();

        Assert.Empty(heartbeats.Snapshot());
    }

    [Fact]
    public void Unconfigured_mail_keeps_the_logging_report_runner_selected()
    {
        // The #91 selection rule's unconfigured arm: generating a scheduled report and letting
        // a stub sender mark its notice "sent" would record a delivery that never happened, so
        // with no provider the runner must stay the stub that claims nothing. The configured
        // arm is asserted in EmailDeliveryRegistrationTests against its configured host.
        using var scope = fixture.Factory.Services.CreateScope();

        Assert.IsType<LoggingScheduledReportRunner>(scope.ServiceProvider.GetRequiredService<IScheduledReportRunner>());
    }

    /// <summary>
    /// The production default, pinned: co-hosting means a deployed API must tick with no
    /// extra configuration, so <c>Enabled</c> defaults to true and every environment that
    /// wants silence -- this suite -- has to say so explicitly.
    /// </summary>
    [Fact]
    public void Scheduling_is_enabled_by_default_so_the_deployed_api_ticks_without_extra_configuration()
        => Assert.True(new WorkerSchedulingOptions().Enabled);
}
