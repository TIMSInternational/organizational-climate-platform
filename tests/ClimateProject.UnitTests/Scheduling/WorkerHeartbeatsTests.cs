using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// Liveness. #101: "a silently dead worker is the whole risk" -- so the check that detects one
/// has to be exercisable without waiting the hours it describes.
/// </summary>
public class WorkerHeartbeatsTests
{
    private static readonly DateTimeOffset Start = new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);

    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);

    private static WorkerHeartbeats Registered()
    {
        var heartbeats = new WorkerHeartbeats();
        heartbeats.Register(WorkerJobs.InvitationReminders, Interval, Start);
        return heartbeats;
    }

    [Fact]
    public void A_job_that_has_never_run_becomes_stale_on_the_same_schedule_as_one_that_stopped()
    {
        // A worker that throws on its very first tick is the case a naive "compare last-run
        // times" check misses entirely: there is no last run to compare.
        var heartbeats = Registered();

        Assert.Empty(heartbeats.StaleJobs(Start + (Interval * 2)));
        Assert.Single(heartbeats.StaleJobs(Start + (Interval * 4)));
    }

    [Fact]
    public void A_recent_success_is_not_stale()
    {
        var heartbeats = Registered();
        heartbeats.RecordSuccess(WorkerJobs.InvitationReminders, Start + Interval);

        Assert.Empty(heartbeats.StaleJobs(Start + (Interval * 3)));
    }

    [Fact]
    public void A_job_that_stopped_succeeding_becomes_stale()
    {
        var heartbeats = Registered();
        heartbeats.RecordSuccess(WorkerJobs.InvitationReminders, Start);

        var stale = heartbeats.StaleJobs(Start + (Interval * 4));

        Assert.Single(stale);
        Assert.Equal(WorkerJobs.InvitationReminders, stale[0].JobName);
        Assert.Equal(Start, stale[0].LastSuccessUtc);
    }

    [Fact]
    public void Losing_the_lease_is_not_a_success_and_does_not_reset_staleness()
    {
        // On a 25-instance cluster, 24 instances lose the lease on every tick. If a skip counted
        // as healthy, all 24 would look fine while the one instance actually doing the work was
        // wedged -- which is the exact scenario this monitor exists for.
        var heartbeats = Registered();

        for (var tick = Start; tick <= Start + (Interval * 6); tick += Interval)
        {
            heartbeats.RecordSkipped(WorkerJobs.InvitationReminders, tick);
        }

        Assert.Single(heartbeats.StaleJobs(Start + (Interval * 6)));
    }

    [Fact]
    public void A_job_that_keeps_throwing_is_stale_and_reports_how_many_times()
    {
        var heartbeats = Registered();
        heartbeats.RecordFailure(WorkerJobs.InvitationReminders, Start + Interval);
        heartbeats.RecordFailure(WorkerJobs.InvitationReminders, Start + (Interval * 2));
        heartbeats.RecordFailure(WorkerJobs.InvitationReminders, Start + (Interval * 3));

        var stale = heartbeats.StaleJobs(Start + (Interval * 4));

        Assert.Single(stale);
        Assert.Equal(3, stale[0].ConsecutiveFailures);
        Assert.Null(stale[0].LastSuccessUtc);
        Assert.Equal(Start + (Interval * 3), stale[0].LastAttemptUtc);
    }

    [Fact]
    public void A_success_clears_the_failure_count_but_a_skip_does_not()
    {
        var heartbeats = Registered();
        heartbeats.RecordFailure(WorkerJobs.InvitationReminders, Start + Interval);
        heartbeats.RecordSkipped(WorkerJobs.InvitationReminders, Start + (Interval * 2));

        Assert.Equal(1, heartbeats.Snapshot()[0].ConsecutiveFailures);

        heartbeats.RecordSuccess(WorkerJobs.InvitationReminders, Start + (Interval * 3));

        Assert.Equal(0, heartbeats.Snapshot()[0].ConsecutiveFailures);
    }

    [Fact]
    public void Staleness_is_relative_to_each_jobs_own_interval()
    {
        // A flat threshold is necessarily either deaf to the one-minute job or screaming about
        // the hourly one.
        var heartbeats = new WorkerHeartbeats();
        heartbeats.Register(WorkerJobs.NotificationDispatch, TimeSpan.FromMinutes(1), Start);
        heartbeats.Register(WorkerJobs.Digests, TimeSpan.FromHours(1), Start);

        var stale = heartbeats.StaleJobs(Start.AddMinutes(10));

        Assert.Single(stale);
        Assert.Equal(WorkerJobs.NotificationDispatch, stale[0].JobName);
    }

    [Fact]
    public void The_snapshot_is_ordered_and_covers_every_registered_job()
    {
        var heartbeats = new WorkerHeartbeats();
        foreach (var job in WorkerJobs.All)
        {
            heartbeats.Register(job, Interval, Start);
        }

        var snapshot = heartbeats.Snapshot();

        Assert.Equal(WorkerJobs.All.Length, snapshot.Count);
        Assert.Equal(
            WorkerJobs.All.OrderBy(name => name, StringComparer.Ordinal),
            snapshot.Select(beat => beat.JobName));
    }

    [Fact]
    public void A_non_positive_tolerance_is_refused()
        => Assert.Throws<ArgumentOutOfRangeException>(() => Registered().StaleJobs(Start, tolerance: 0));
}
