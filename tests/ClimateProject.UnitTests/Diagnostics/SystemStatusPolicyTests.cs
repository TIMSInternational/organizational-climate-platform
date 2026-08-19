using ClimateProject.Application.Diagnostics;

namespace ClimateProject.UnitTests.Diagnostics;

/// <summary>
/// The decision logic behind <c>GET /admin/system/status</c>.
///
/// These are unit tests rather than integration tests on purpose: the property that matters
/// most here -- that a hung database can never come out healthy (#220) -- is a property of a
/// pure function, and pinning it without a container means it is checked on every build
/// rather than on every Docker-capable build.
/// </summary>
public class SystemStatusPolicyTests
{
    private static SystemDatabaseStatus Database(
        string status = SystemComponentStatuses.Ok,
        bool usesTransactionPoolerPort = false)
        => new(
            Status: status,
            LatencyMs: 12,
            Port: usesTransactionPoolerPort ? 6543 : 5432,
            UsesTransactionPoolerPort: usesTransactionPoolerPort,
            MaxPoolSize: 10,
            MaxPoolSizeDefaulted: true);

    private static SystemNotificationQueueStatus Queue(string status = SystemComponentStatuses.Ok)
        => new(Status: status, Pending: 0, Due: 0, DeadLettered: 0, OldestDueAgeSeconds: null);

    // -------------------------------------------------------------------------------------
    // #220: the timeout must not be swallowed.
    // -------------------------------------------------------------------------------------

    [Fact]
    public void A_database_timeout_is_unhealthy_never_ok()
    {
        // This is the single most important assertion in the file. The natural way to write a
        // status endpoint against a database that hangs for thirty seconds is to bound the
        // probe with a timeout and then treat "no exception escaped my handler" as success --
        // which reports a green dashboard for the exact production defect the endpoint exists
        // to surface. If someone reintroduces that, this fails.
        var status = SystemStatusPolicy.Evaluate(Database(SystemComponentStatuses.Timeout), Queue());

        Assert.Equal(SystemStatuses.Unhealthy, status);
    }

    [Fact]
    public void A_database_timeout_stays_unhealthy_even_with_every_other_component_healthy()
    {
        var status = SystemStatusPolicy.Evaluate(
            Database(SystemComponentStatuses.Timeout),
            Queue(SystemComponentStatuses.Ok));

        Assert.Equal(SystemStatuses.Unhealthy, status);
    }

    [Fact]
    public void An_unreachable_database_is_unhealthy()
    {
        Assert.Equal(
            SystemStatuses.Unhealthy,
            SystemStatusPolicy.Evaluate(Database(SystemComponentStatuses.Unreachable), Queue()));
    }

    [Fact]
    public void The_probe_budget_is_short_enough_to_report_the_220_hang_and_long_enough_to_measure_a_slow_database()
    {
        // The observed #220 hang is ~30 seconds. The budget must expire well inside that, or
        // the operator waits out the hang instead of being told about it...
        Assert.True(
            SystemStatusPolicy.ProbeTimeoutMs < 30_000,
            "The probe budget must expire well before the ~30s hang it exists to report.");

        // ...and it must sit above the slow threshold, or a merely slow database gets cut off
        // and mislabelled a timeout, escalating "degraded" to "unhealthy" on a healthy-ish box.
        Assert.True(
            SystemStatusPolicy.ProbeTimeoutMs > SystemStatusPolicy.SlowThresholdMs,
            "A slow-but-answering database must be measurable inside the probe budget.");
    }

    // -------------------------------------------------------------------------------------
    // Aggregation.
    // -------------------------------------------------------------------------------------

    [Fact]
    public void Everything_healthy_on_a_correctly_configured_port_is_ok()
    {
        Assert.Equal(SystemStatuses.Ok, SystemStatusPolicy.Evaluate(Database(), Queue()));
    }

    [Fact]
    public void A_slow_database_is_degraded_not_unhealthy()
    {
        // It is answering. Degraded means "look at this", not "take it out of rotation".
        Assert.Equal(
            SystemStatuses.Degraded,
            SystemStatusPolicy.Evaluate(Database(SystemComponentStatuses.Slow), Queue()));
    }

    [Fact]
    public void The_transaction_pooler_port_degrades_an_otherwise_perfect_instance()
    {
        // #220's misconfiguration is constant while its symptom is intermittent, so an
        // instance that happens to be answering fast right now is still misconfigured and
        // must say so rather than waiting for the next hang to prove it.
        var status = SystemStatusPolicy.Evaluate(
            Database(SystemComponentStatuses.Ok, usesTransactionPoolerPort: true),
            Queue());

        Assert.Equal(SystemStatuses.Degraded, status);
    }

    [Fact]
    public void A_notification_backlog_degrades()
    {
        Assert.Equal(
            SystemStatuses.Degraded,
            SystemStatusPolicy.Evaluate(Database(), Queue(SystemComponentStatuses.Backlog)));
    }

    [Fact]
    public void An_undetermined_component_is_never_reported_as_ok()
    {
        // "We could not look" is not evidence of health.
        Assert.Equal(
            SystemStatuses.Degraded,
            SystemStatusPolicy.Evaluate(Database(), Queue(SystemComponentStatuses.Unknown)));
    }

    [Fact]
    public void Evaluate_rejects_null_components()
    {
        Assert.Throws<ArgumentNullException>(() => SystemStatusPolicy.Evaluate(null!, Queue()));
        Assert.Throws<ArgumentNullException>(() => SystemStatusPolicy.Evaluate(Database(), null!));
    }

    // -------------------------------------------------------------------------------------
    // Component classification.
    // -------------------------------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(12)]
    [InlineData(SystemStatusPolicy.SlowThresholdMs - 1)]
    public void A_round_trip_under_the_threshold_is_ok(int latencyMs)
    {
        Assert.Equal(SystemComponentStatuses.Ok, SystemStatusPolicy.ClassifyDatabaseLatency(latencyMs));
    }

    [Theory]
    [InlineData(SystemStatusPolicy.SlowThresholdMs)]
    [InlineData(SystemStatusPolicy.SlowThresholdMs + 1)]
    [InlineData(4_000)]
    public void A_round_trip_at_or_over_the_threshold_is_slow(int latencyMs)
    {
        Assert.Equal(SystemComponentStatuses.Slow, SystemStatusPolicy.ClassifyDatabaseLatency(latencyMs));
    }

    [Fact]
    public void An_empty_queue_is_ok()
    {
        Assert.Equal(SystemComponentStatuses.Ok, SystemStatusPolicy.ClassifyQueue(null));
    }

    [Fact]
    public void A_queue_whose_oldest_due_row_is_young_is_ok()
    {
        Assert.Equal(
            SystemComponentStatuses.Ok,
            SystemStatusPolicy.ClassifyQueue(SystemStatusPolicy.BacklogAgeThresholdSeconds - 1));
    }

    [Fact]
    public void A_queue_whose_oldest_due_row_has_aged_past_the_threshold_is_a_backlog()
    {
        Assert.Equal(
            SystemComponentStatuses.Backlog,
            SystemStatusPolicy.ClassifyQueue(SystemStatusPolicy.BacklogAgeThresholdSeconds));
    }

    [Fact]
    public void A_dispatcher_that_has_never_delivered_anything_says_so()
    {
        // Distinguishable from "ran a long time ago" on purpose: a fresh deployment and an
        // abandoned one look identical if both are reported as merely stale.
        Assert.Equal(
            SystemComponentStatuses.NeverRun,
            SystemStatusPolicy.ClassifyDispatcher(null, DateTimeOffset.UtcNow));
    }

    [Fact]
    public void A_dispatcher_that_delivered_recently_is_ok()
    {
        var now = DateTimeOffset.UtcNow;

        Assert.Equal(
            SystemComponentStatuses.Ok,
            SystemStatusPolicy.ClassifyDispatcher(now.AddMinutes(-5), now));
    }

    [Fact]
    public void A_dispatcher_that_has_not_delivered_in_over_an_hour_is_stale()
    {
        var now = DateTimeOffset.UtcNow;
        var lastDispatch = now.AddSeconds(-SystemStatusPolicy.StaleDispatchThresholdSeconds - 1);

        Assert.Equal(
            SystemComponentStatuses.Stale,
            SystemStatusPolicy.ClassifyDispatcher(lastDispatch, now));
    }

    [Fact]
    public void A_stale_dispatcher_alone_does_not_degrade_the_platform()
    {
        // A deployment that has legitimately never needed to send a notification would
        // otherwise report degraded from the moment it is installed, and an alert that is
        // always on is an alert nobody reads. The queue's own backlog is the actionable
        // signal; the dispatcher timestamp is the context that explains it.
        Assert.Equal(SystemStatuses.Ok, SystemStatusPolicy.Evaluate(Database(), Queue()));
    }

    // -------------------------------------------------------------------------------------
    // HTTP mapping.
    // -------------------------------------------------------------------------------------

    [Fact]
    public void Unhealthy_is_served_as_503_so_a_status_code_alone_cannot_hide_a_dead_database()
    {
        Assert.Equal(503, SystemStatusPolicy.HttpStatusFor(SystemStatuses.Unhealthy));
    }

    [Theory]
    [InlineData(SystemStatuses.Ok)]
    [InlineData(SystemStatuses.Degraded)]
    public void Ok_and_degraded_are_served_as_200(string aggregateStatus)
    {
        Assert.Equal(200, SystemStatusPolicy.HttpStatusFor(aggregateStatus));
    }

    // -------------------------------------------------------------------------------------
    // #275 / #101: a silently dead scheduled job must not read as a healthy platform.
    // -------------------------------------------------------------------------------------

    private static SystemJobStatus Job(string status, string name = "notification-dispatch")
        => new(
            JobName: name,
            IntervalSeconds: 300,
            LastAttemptAt: null,
            LastSuccessAt: null,
            ConsecutiveFailures: 0,
            Status: status);

    private static readonly DateTimeOffset Now = new(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_job_that_succeeded_within_its_cadence_is_ok()
    {
        var status = SystemStatusPolicy.ClassifyJob(
            interval: TimeSpan.FromMinutes(5),
            registeredAtUtc: Now.AddHours(-2),
            lastSuccessUtc: Now.AddMinutes(-4),
            consecutiveFailures: 0,
            nowUtc: Now);

        Assert.Equal(SystemComponentStatuses.Ok, status);
    }

    [Fact]
    public void A_job_silent_for_more_than_three_intervals_is_stale()
    {
        // The failure #101 names: the job stopped, and because it emits nothing when it stops,
        // absence is the only available signal.
        var status = SystemStatusPolicy.ClassifyJob(
            interval: TimeSpan.FromMinutes(5),
            registeredAtUtc: Now.AddHours(-2),
            lastSuccessUtc: Now.AddMinutes(-16),
            consecutiveFailures: 0,
            nowUtc: Now);

        Assert.Equal(SystemComponentStatuses.Stale, status);
    }

    [Fact]
    public void A_job_that_never_succeeded_goes_stale_on_the_clock_that_starts_at_registration()
    {
        // A worker that throws on its very first tick is exactly what a "compare last-run
        // times" check misses, because it has no last run to compare.
        var status = SystemStatusPolicy.ClassifyJob(
            interval: TimeSpan.FromMinutes(5),
            registeredAtUtc: Now.AddMinutes(-16),
            lastSuccessUtc: null,
            consecutiveFailures: 3,
            nowUtc: Now);

        Assert.Equal(SystemComponentStatuses.Stale, status);
    }

    [Fact]
    public void A_job_still_inside_its_cadence_but_erroring_is_failing_not_ok()
    {
        var status = SystemStatusPolicy.ClassifyJob(
            interval: TimeSpan.FromMinutes(5),
            registeredAtUtc: Now.AddHours(-2),
            lastSuccessUtc: Now.AddMinutes(-4),
            consecutiveFailures: 2,
            nowUtc: Now);

        Assert.Equal(SystemComponentStatuses.Failing, status);
    }

    [Fact]
    public void A_freshly_registered_job_is_never_run_rather_than_stale()
    {
        var status = SystemStatusPolicy.ClassifyJob(
            interval: TimeSpan.FromMinutes(5),
            registeredAtUtc: Now.AddSeconds(-30),
            lastSuccessUtc: null,
            consecutiveFailures: 0,
            nowUtc: Now);

        Assert.Equal(SystemComponentStatuses.NeverRun, status);
    }

    [Fact]
    public void A_zero_interval_is_not_measured_for_staleness()
    {
        // WorkerHeartbeats.Record creates a transient beat with a zero interval when a job
        // reports before it registers. Multiplying that by the tolerance gives zero, so a
        // naive implementation calls every such beat stale the instant it appears.
        var status = SystemStatusPolicy.ClassifyJob(
            interval: TimeSpan.Zero,
            registeredAtUtc: Now.AddDays(-7),
            lastSuccessUtc: Now.AddDays(-7),
            consecutiveFailures: 0,
            nowUtc: Now);

        Assert.Equal(SystemComponentStatuses.Ok, status);
    }

    [Fact]
    public void A_stale_job_degrades_the_platform_even_when_every_other_component_is_green()
    {
        // The queue only shows a backlog once work is *due*. A dispatcher that died an hour
        // after the last notification therefore looks perfect until the next one is scheduled,
        // which is the window this check closes.
        var status = SystemStatusPolicy.Evaluate(
            Database(), Queue(), [Job(SystemComponentStatuses.Stale)]);

        Assert.Equal(SystemStatuses.Degraded, status);
    }

    [Fact]
    public void A_failing_job_degrades_the_platform()
    {
        var status = SystemStatusPolicy.Evaluate(
            Database(), Queue(), [Job(SystemComponentStatuses.Failing)]);

        Assert.Equal(SystemStatuses.Degraded, status);
    }

    [Fact]
    public void Healthy_jobs_leave_the_verdict_alone()
    {
        var status = SystemStatusPolicy.Evaluate(
            Database(),
            Queue(),
            [Job(SystemComponentStatuses.Ok), Job(SystemComponentStatuses.NeverRun, "digests")]);

        Assert.Equal(SystemStatuses.Ok, status);
    }

    [Fact]
    public void A_database_timeout_still_outranks_a_stale_job()
    {
        // Ordering: the worst component wins. A stale job must never downgrade an unhealthy
        // verdict to degraded.
        var status = SystemStatusPolicy.Evaluate(
            Database(SystemComponentStatuses.Timeout),
            Queue(),
            [Job(SystemComponentStatuses.Stale)]);

        Assert.Equal(SystemStatuses.Unhealthy, status);
    }
}
