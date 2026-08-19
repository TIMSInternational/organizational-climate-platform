using ClimateProject.Application.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ClimateProject.IntegrationTests.Diagnostics;

/// <summary>
/// The #275 gate: background jobs must stay deployed with the API.
/// </summary>
/// <remarks>
/// <para>
/// #275's third acceptance criterion asks for a check that fails if the workers stop being
/// deployed, "so this cannot silently regress". That wording is deliberate — the whole
/// incident behind #275 was that <c>Dockerfile.workers</c> was referenced by no workflow, so
/// six jobs had never executed in production and nothing anywhere said so. Removing the
/// co-host is a one-line change (<c>AddClimateProjectScheduling</c> in <c>Program.cs</c>, or
/// the <c>ClimateProject.Workers</c> ProjectReference) and would otherwise be invisible until
/// somebody noticed invitations had quietly stopped going out weeks later.
/// </para>
/// <para>
/// Asserted against the API host's own service collection rather than against
/// <c>AddClimateProjectScheduling</c> in isolation, because a unit test on the extension would
/// still pass if the API simply stopped calling it — which is precisely the regression.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class WorkerHostingRegistrationTests
{
    private readonly PostgresContainerFixture _postgres;

    public WorkerHostingRegistrationTests(PostgresContainerFixture postgres) => _postgres = postgres;

    /// <summary>
    /// One hosted service per job in <see cref="WorkerJobs.All"/>, plus the staleness monitor.
    /// </summary>
    [Fact]
    public void Every_scheduled_job_is_hosted_inside_the_api_process()
    {
        var hosted = _postgres.App.Services
            .GetServices<IHostedService>()
            .Select(service => service.GetType().Name)
            .ToList();

        string[] expected =
        [
            "NotificationDispatchWorker",
            "InvitationReminderWorker",
            "DigestWorker",
            "ScheduledReportWorker",
            "SurveyDraftRetentionWorker",
            "RetentionCleanupWorker",
            "WorkerHeartbeatMonitor",
        ];

        foreach (var worker in expected)
        {
            Assert.Contains(worker, hosted);
        }
    }

    /// <summary>
    /// The count is pinned separately so that adding a job to <see cref="WorkerJobs.All"/>
    /// without hosting it fails here rather than shipping unrun.
    /// </summary>
    [Fact]
    public void A_job_added_to_the_registry_without_a_host_fails_this_check()
    {
        var hostedWorkerCount = _postgres.App.Services
            .GetServices<IHostedService>()
            .Count(service => service.GetType().Name.EndsWith("Worker", StringComparison.Ordinal));

        Assert.Equal(WorkerJobs.All.Length, hostedWorkerCount);
    }

    /// <summary>
    /// <c>GET /admin/system/status</c> injects this; an unregistered singleton would 500 the
    /// diagnostics endpoint rather than fail visibly here.
    /// </summary>
    [Fact]
    public void The_heartbeat_registry_is_resolvable_for_the_status_endpoint()
    {
        Assert.NotNull(_postgres.App.Services.GetService<WorkerHeartbeats>());
    }
}
