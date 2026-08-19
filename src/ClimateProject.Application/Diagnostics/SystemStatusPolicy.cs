namespace ClimateProject.Application.Diagnostics;

/// <summary>The aggregate verdict vocabulary for <c>GET /admin/system/status</c>.</summary>
public static class SystemStatuses
{
    /// <summary>Every component behaved and nothing is misconfigured.</summary>
    public const string Ok = "ok";

    /// <summary>Serving traffic, but something a human should look at. HTTP 200.</summary>
    public const string Degraded = "degraded";

    /// <summary>A dependency this service cannot work without did not answer. HTTP 503.</summary>
    public const string Unhealthy = "unhealthy";

    public static readonly string[] All = [Ok, Degraded, Unhealthy];
}

/// <summary>Per-component status vocabulary. Locale-independent tokens, never prose.</summary>
public static class SystemComponentStatuses
{
    /// <summary>Component answered within its budget.</summary>
    public const string Ok = "ok";

    /// <summary>Answered, but slower than <see cref="SystemStatusPolicy.SlowThresholdMs"/>.</summary>
    public const string Slow = "slow";

    /// <summary>
    /// Did not answer inside <see cref="SystemStatusPolicy.ProbeTimeoutMs"/>. Distinct from
    /// <see cref="Unreachable"/> on purpose: a refused connection and a hang have the same
    /// severity but very different causes, and #220 is specifically a hang.
    /// </summary>
    public const string Timeout = "timeout";

    /// <summary>Failed outright — refused, authentication rejected, driver error.</summary>
    public const string Unreachable = "unreachable";

    /// <summary>Work is due and the oldest of it has aged past <see cref="SystemStatusPolicy.BacklogAgeThresholdSeconds"/>.</summary>
    public const string Backlog = "backlog";

    /// <summary>Nothing has ever dispatched successfully.</summary>
    public const string NeverRun = "never-run";

    /// <summary>Something dispatched, but longer ago than <see cref="SystemStatusPolicy.StaleDispatchThresholdSeconds"/>.</summary>
    public const string Stale = "stale";

    /// <summary>
    /// A scheduled job that is still ticking inside its cadence but whose last tick threw.
    /// Distinct from <see cref="Stale"/>: the job is alive and erroring, which points at the
    /// work rather than at the scheduler.
    /// </summary>
    public const string Failing = "failing";

    /// <summary>
    /// Could not be determined, because the probe it depends on failed first. Deliberately
    /// not <see cref="Ok"/>: "we could not look" and "we looked and it was fine" are
    /// different answers and only one of them is reassuring.
    /// </summary>
    public const string Unknown = "unknown";
}

/// <summary>
/// The pure decision logic behind <c>GET /admin/system/status</c>: thresholds, per-component
/// classification, and the roll-up to a single verdict.
/// </summary>
/// <remarks>
/// <para>
/// This lives in Application, away from the endpoint, for one reason: it is the part that
/// must not be wrong, and it is the part that can be exhaustively unit-tested without a
/// database, a container or a host. The endpoint's job is reduced to gathering facts; the
/// judgement about what those facts mean is here.
/// </para>
/// <para>
/// <strong>The rule that matters most (#220).</strong> A database probe that hangs must come
/// out <see cref="SystemStatuses.Unhealthy"/>. The failure mode this endpoint is most likely
/// to be built into by accident is the opposite one: wrap the probe in a timeout, catch the
/// timeout, and report "ok" because no exception escaped. That would turn a live production
/// defect — roughly half of all <c>/ready</c> probes hanging for thirty seconds against the
/// 6543 transaction pooler — into a green dashboard. <see cref="Evaluate"/> maps
/// <see cref="SystemComponentStatuses.Timeout"/> to
/// <see cref="SystemStatuses.Unhealthy"/> with no escape hatch, and a unit test pins it.
/// </para>
/// </remarks>
public static class SystemStatusPolicy
{
    /// <summary>
    /// A <c>SELECT 1</c> at or above this many milliseconds is reported
    /// <see cref="SystemComponentStatuses.Slow"/>. A healthy round-trip to Supabase from
    /// App Runner is tens of milliseconds; a second means something is queueing.
    /// </summary>
    public const int SlowThresholdMs = 1_000;

    /// <summary>
    /// Total budget for every database round-trip this endpoint makes.
    /// </summary>
    /// <remarks>
    /// Deliberately far below the ~30 second hang observed in #220, so that the hang is
    /// *reported* rather than waited out: an operator opening this endpoint gets an answer in
    /// five seconds, and that answer is <see cref="SystemStatuses.Unhealthy"/>. Also
    /// deliberately far above <see cref="SlowThresholdMs"/>, so a merely slow database is
    /// still measured and classified rather than cut off and mislabelled a timeout. A unit
    /// test asserts both relationships.
    /// </remarks>
    public const int ProbeTimeoutMs = 5_000;

    /// <summary>
    /// Once the oldest due notification has been waiting this long, the queue is a
    /// <see cref="SystemComponentStatuses.Backlog"/>. Fifteen minutes is chosen to be well
    /// clear of any plausible sweep interval, so a normally-running dispatcher never trips it.
    /// </summary>
    public const int BacklogAgeThresholdSeconds = 900;

    /// <summary>
    /// A dispatcher that has not delivered anything in this long is reported
    /// <see cref="SystemComponentStatuses.Stale"/>.
    /// </summary>
    public const int StaleDispatchThresholdSeconds = 3_600;

    /// <summary>Classifies a successful database round-trip by how long it took.</summary>
    public static string ClassifyDatabaseLatency(long latencyMs)
        => latencyMs >= SlowThresholdMs ? SystemComponentStatuses.Slow : SystemComponentStatuses.Ok;

    /// <summary>
    /// Classifies the notification queue from the age of its oldest due row.
    /// </summary>
    /// <remarks>
    /// Depth alone is not the signal — a tenant legitimately enqueueing ten thousand
    /// invitations is not a fault. Age is: work that is due and still sitting there means
    /// nothing is draining it. Dead-lettered rows are counted and reported but deliberately
    /// do not affect this status; a handful of permanently-bad addresses is normal and would
    /// otherwise pin the whole platform to "degraded" forever, which is how alerts get
    /// ignored.
    /// </remarks>
    public static string ClassifyQueue(long? oldestDueAgeSeconds)
        => oldestDueAgeSeconds >= BacklogAgeThresholdSeconds
            ? SystemComponentStatuses.Backlog
            : SystemComponentStatuses.Ok;

    /// <summary>
    /// How many of its own intervals a job may go without succeeding before it is
    /// <see cref="SystemComponentStatuses.Stale"/>.
    /// </summary>
    /// <remarks>
    /// Deliberately the same tolerance <c>WorkerHeartbeats.StaleJobs</c> applies, and
    /// relative to each job's own interval for the reason recorded there: dispatch runs every
    /// few minutes and the digest sweep hourly, so one flat threshold is necessarily either
    /// deaf to the fast job or screaming about the slow one.
    /// </remarks>
    public const double StaleJobIntervalTolerance = 3.0;

    /// <summary>
    /// Classifies one scheduled job from its own heartbeat.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Takes primitives rather than a <c>WorkerHeartbeat</c> so that the diagnostics policy
    /// does not depend on the scheduling namespace — the dependency belongs the other way
    /// round, and this keeps the rule unit-testable without constructing a scheduler.
    /// </para>
    /// <para>
    /// A job that has never succeeded is measured from when it was registered, so it becomes
    /// stale on the same schedule as one that succeeded once and stopped. Ordered worst-first:
    /// a job that is both stale and failing is reported stale, because "not running" outranks
    /// "running badly".
    /// </para>
    /// <para>
    /// A non-positive interval cannot express a cadence, so staleness is not evaluated
    /// against it. <c>WorkerSchedulingOptions.Validate</c> refuses zero intervals at startup;
    /// this guard exists for the transient beat <c>WorkerHeartbeats.Record</c> creates when a
    /// job reports before it registers, which would otherwise read as instantly stale.
    /// </para>
    /// </remarks>
    public static string ClassifyJob(
        TimeSpan interval,
        DateTimeOffset registeredAtUtc,
        DateTimeOffset? lastSuccessUtc,
        int consecutiveFailures,
        DateTimeOffset nowUtc)
    {
        if (interval > TimeSpan.Zero)
        {
            var measuredFrom = lastSuccessUtc ?? registeredAtUtc;
            if (nowUtc - measuredFrom >= interval * StaleJobIntervalTolerance)
            {
                return SystemComponentStatuses.Stale;
            }
        }

        if (consecutiveFailures > 0) return SystemComponentStatuses.Failing;

        return lastSuccessUtc is null
            ? SystemComponentStatuses.NeverRun
            : SystemComponentStatuses.Ok;
    }

    /// <summary>
    /// Classifies the dispatcher from the most recent successful delivery.
    /// </summary>
    /// <remarks>
    /// Informational only — <see cref="Evaluate"/> never degrades the platform on this alone,
    /// because a deployment that has legitimately never sent a notification would otherwise
    /// report degraded from the moment it is installed. The queue's own
    /// <see cref="SystemComponentStatuses.Backlog"/> is the actionable signal; this is the
    /// context that explains it.
    /// </remarks>
    public static string ClassifyDispatcher(DateTimeOffset? lastDispatchAt, DateTimeOffset now)
    {
        if (lastDispatchAt is null) return SystemComponentStatuses.NeverRun;

        return (now - lastDispatchAt.Value).TotalSeconds >= StaleDispatchThresholdSeconds
            ? SystemComponentStatuses.Stale
            : SystemComponentStatuses.Ok;
    }

    /// <summary>
    /// Rolls the component observations up into the single verdict reported as
    /// <see cref="SystemStatusResponse.Status"/>.
    /// </summary>
    /// <remarks>
    /// Ordered worst-first and written as a straight sequence of guards so that adding a
    /// component cannot accidentally mask a more severe one.
    /// </remarks>
    public static string Evaluate(
        SystemDatabaseStatus database,
        SystemNotificationQueueStatus queue,
        IReadOnlyList<SystemJobStatus>? jobs = null)
    {
        ArgumentNullException.ThrowIfNull(database);
        ArgumentNullException.ThrowIfNull(queue);

        // A hang and a refusal are both "this instance cannot serve traffic". No timeout is
        // ever swallowed into a healthy answer -- see the type-level remarks (#220).
        if (database.Status is SystemComponentStatuses.Timeout or SystemComponentStatuses.Unreachable)
        {
            return SystemStatuses.Unhealthy;
        }

        // Slow now is the leading indicator of timing out shortly.
        if (database.Status == SystemComponentStatuses.Slow) return SystemStatuses.Degraded;

        // The connection string points at Supavisor's transaction pooler. The service still
        // works most of the time, which is exactly why this has to be surfaced rather than
        // waited for: the symptom is intermittent, the misconfiguration is constant.
        if (database.UsesTransactionPoolerPort) return SystemStatuses.Degraded;

        if (queue.Status == SystemComponentStatuses.Backlog) return SystemStatuses.Degraded;

        // A stopped or erroring scheduled job degrades the platform even while every other
        // component is green, which is the whole point of #101: the queue only shows a
        // backlog once work is *due*, so a dispatcher that died an hour after the last
        // notification looks perfect until the next one is scheduled. `jobs` is null only for
        // a caller that observed no scheduler at all; an empty list means one was observed and
        // had nothing registered, which is not evidence of health either.
        if (jobs is not null && jobs.Any(job =>
                job.Status is SystemComponentStatuses.Stale or SystemComponentStatuses.Failing))
        {
            return SystemStatuses.Degraded;
        }

        // Anything we could not determine is not evidence of health.
        if (database.Status == SystemComponentStatuses.Unknown
            || queue.Status == SystemComponentStatuses.Unknown)
        {
            return SystemStatuses.Degraded;
        }

        return SystemStatuses.Ok;
    }

    /// <summary>
    /// The HTTP status code an aggregate verdict is served with.
    /// </summary>
    /// <remarks>
    /// 503 for <see cref="SystemStatuses.Unhealthy"/> matches <c>/ready</c>, so an operator
    /// tool that only looks at status codes still cannot be told a hung database is fine.
    /// <see cref="SystemStatuses.Degraded"/> is 200 on purpose: the service *is* answering,
    /// and a diagnostics page that 503s is a diagnostics page clients start ignoring.
    /// </remarks>
    public static int HttpStatusFor(string aggregateStatus)
        => aggregateStatus == SystemStatuses.Unhealthy ? 503 : 200;
}
