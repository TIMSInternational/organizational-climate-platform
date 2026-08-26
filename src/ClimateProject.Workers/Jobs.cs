using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ClimateProject.Workers;

/// <summary>
/// Drains due notifications through the shared dispatch path.
///
/// <para>This is the worker #101 describes as "the thing that should be calling that logic on a
/// timer". It calls <see cref="NotificationDelivery.ProcessDueAsync"/> -- the same method
/// <c>POST /notifications/process</c> calls -- rather than reimplementing dispatch, so consent
/// suppression, retry accounting and status bookkeeping cannot drift between the manual and the
/// scheduled path.</para>
///
/// <para>Swept across every tenant (<c>companyId: null</c>), which the HTTP endpoint reserves
/// for super admins. That is not a privilege escalation: the endpoint's restriction exists
/// because a cross-tenant sweep is not something one company's admin should be able to trigger,
/// and this caller is the platform itself, acting on rows it already owns, with no user
/// identity involved at all.</para>
/// </summary>
public sealed class NotificationDispatchWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<NotificationDispatchWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.NotificationDispatch,
        options.Value.NotificationDispatchInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.NotificationBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var sender = services.GetRequiredService<INotificationSender>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await NotificationDelivery.ProcessDueAsync(
            db, sender, loggerFactory, companyId: null, nowUtc, _batchSize, cancellationToken);

        if (result.Attempted > 0)
        {
            logger.LogInformation(
                "Notification dispatch sweep attempted {Attempted}: {Sent} sent, {Suppressed} suppressed by " +
                "recipient preference, {Failed} failed.",
                result.Attempted,
                result.Sent,
                result.Suppressed,
                result.Failed);
        }
    }
}

/// <summary>
/// Raises reminders for outstanding survey and microclimate invitations. See
/// <see cref="InvitationReminderJob"/> for the rules and for what this replaces.
/// </summary>
public sealed class InvitationReminderWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<InvitationReminderWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.InvitationReminders,
        options.Value.InvitationReminderInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.ReminderBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await InvitationReminderJob.RunAsync(db, loggerFactory, nowUtc, _batchSize, cancellationToken);

        if (result.Raised > 0)
        {
            logger.LogInformation(
                "Reminder sweep examined {Examined} outstanding invitations and raised {Raised} reminders.",
                result.Examined,
                result.Raised);
        }
    }
}

/// <summary>
/// Builds per-user digests, in each recipient's own timezone and only for those who asked for
/// one. See <see cref="DigestJob"/>.
/// </summary>
public sealed class DigestWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<DigestWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.Digests,
        options.Value.DigestInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _pageSize = options.Value.DigestPageSize;
    private readonly int _maxUsersPerRun = options.Value.DigestMaxUsersPerRun;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await DigestJob.RunAsync(
            db, loggerFactory, nowUtc, _pageSize, _maxUsersPerRun, cancellationToken);

        if (result.DigestsRaised > 0)
        {
            logger.LogInformation(
                "Digest sweep examined {UsersExamined} subscribed users and raised {DigestsRaised} digests.",
                result.UsersExamined,
                result.DigestsRaised);
        }
    }
}

/// <summary>
/// Fires recurring report schedules and advances them. See <see cref="ScheduledReportJob"/>.
/// </summary>
public sealed class ScheduledReportWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<ScheduledReportWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.ScheduledReports,
        options.Value.ScheduledReportInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.ScheduledReportBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var runner = services.GetRequiredService<IScheduledReportRunner>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await ScheduledReportJob.RunAsync(
            db, runner, loggerFactory, nowUtc, _batchSize, cancellationToken);

        if (result.Fired > 0 || result.SchedulesCleared > 0)
        {
            logger.LogInformation(
                "Scheduled report sweep fired {Fired} occurrences and cleared {SchedulesCleared} invalid schedules.",
                result.Fired,
                result.SchedulesCleared);
        }
    }
}

/// <summary>
/// Reclaims survey drafts that <see cref="SurveyDraftRetention"/> has expired.
///
/// <para>The scheduled caller <c>DELETE /surveys/drafts/expired</c> never had (#272). It runs
/// <see cref="SurveyDraftRetentionJob.PurgeAsync"/> -- the same method that route runs -- so
/// the scheduled sweep and the manual one cannot come to disagree about which rows are
/// expired. The route stays for manual use.</para>
///
/// <para><b>Running since #275.</b> These jobs are co-hosted in the API --
/// <c>Program.cs</c> calls <c>AddClimateProjectScheduling</c> -- so the API image
/// <c>deploy-prod.yml</c> already builds is the scheduler, and this sweep ticks in
/// production. #272 made the sweep something a scheduler can run; #275 made it tick.</para>
///
/// <para>Cross-tenant, like every other job here, which the HTTP route reserves for super
/// admins. Not an escalation: the restriction exists because one company's admin should not
/// be able to trigger a deployment-wide sweep, and this caller is the platform itself with no
/// user identity involved -- and unlike the other jobs, this one reads no row content at all,
/// only <c>expires_at</c>.</para>
/// </summary>
public sealed class SurveyDraftRetentionWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<SurveyDraftRetentionWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.SurveyDraftRetention,
        options.Value.SurveyDraftRetentionInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.SurveyDraftRetentionBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await SurveyDraftRetentionJob.RunAsync(
            db, loggerFactory, nowUtc, _batchSize, cancellationToken);

        if (result.MoreRemaining)
        {
            // Only worth a line when the cap actually bit: it means a backlog is draining over
            // several ticks, which is expected on first deploy and worth noticing if it
            // persists for days.
            logger.LogInformation(
                "Survey draft retention sweep reclaimed its full batch of {Deleted}; more expired drafts remain for " +
                "the next tick.",
                result.Deleted);
        }
    }
}

/// <summary>
/// The storage-limitation sweep (GDPR Art. 5(1)(e)) on a timer. Runs
/// <see cref="RetentionCleanupJob.RunAsync"/> -- the same entry point
/// <c>POST /gdpr/retention-cleanup</c> runs -- so the scheduled sweep and the manual one
/// cannot come to disagree about what has expired (#144).
///
/// <para><b>Here rather than in a scheduler of its own.</b> #144 asks for retention cleanup to
/// be scheduled and says it belongs alongside #101's jobs. It takes the same advisory lease as
/// every other job in this file, so it stays single-flight across however many instances are
/// running -- which matters more here than elsewhere, because two concurrent sweeps would both
/// be issuing deletes.</para>
///
/// <para><b>Capped per tick.</b> Each category deletes at most
/// <c>Scheduling:RetentionCleanupBatchSize</c> rows, so a first sweep over an accumulated
/// backlog drains over several ticks rather than becoming one enormous transaction held under
/// the lease. The HTTP route passes no cap, on the same reasoning
/// <c>DELETE /surveys/drafts/expired</c> uses: a human asking for the sweep by hand is asking
/// it to finish.</para>
///
/// <para><b>Running since #275</b>, co-hosted in the API exactly as
/// <see cref="SurveyDraftRetentionWorker"/> records. Before that, the only thing that swept
/// was a super admin calling the route.</para>
///
/// <para><b>Daily.</b> Every window here is measured in days or months -- a year of
/// notifications, ninety days past an invitation's expiry -- so nothing observable depends on
/// the sweep being prompt. Daily keeps each run's work small without asking the database a
/// question whose answer changes once a day.</para>
/// </summary>
public sealed class RetentionCleanupWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<RetentionCleanupWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.RetentionCleanup,
        options.Value.RetentionCleanupInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.RetentionCleanupBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await RetentionCleanupJob.RunAsync(
            db, loggerFactory, nowUtc, _batchSize, cancellationToken);

        foreach (var category in result.Categories.Where(c => c.MoreRemaining))
        {
            // Only worth a line when the cap actually bit. A category reporting a backlog day
            // after day means rows arrive faster than the retention window lets them go, which
            // is a policy question rather than a scheduling one.
            logger.LogInformation(
                "Retention cleanup took its full batch of {Deleted} from {Category}; more rows remain for the " +
                "next tick.",
                category.Deleted,
                category.Category);
        }
    }
}

/// <summary>
/// Opens a survey on its start date and closes it on its end date. See
/// <see cref="SurveyLifecycleJob"/> for which transitions it may make and, at greater length,
/// for the ones it refuses.
///
/// <para><b>The one job here that writes a status.</b> Every other worker in this file raises a
/// notification or deletes an expired row -- work whose worst failure is a duplicate mail or a
/// row that lives a day longer. This one changes the lifecycle state of live customer data, so
/// the conservatism is in <see cref="SurveyLifecycleSchedule"/> rather than here: this class
/// does nothing but hand the sweep a clock and a cap, exactly like its five siblings.</para>
///
/// <para><b>Cross-tenant, like every job here.</b> No company id, because a scheduler that only
/// advanced one tenant's surveys would be the wrong thing -- and unlike the sweeps that borrow
/// a SuperAdmin-gated route's behaviour, this one has no HTTP equivalent to borrow from at all.
/// <c>PUT /surveys/{id}/status</c> is a human moving one survey they administer; this is the
/// platform honouring dates that were already agreed.</para>
/// </summary>
public sealed class SurveyLifecycleWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<SurveyLifecycleWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.SurveyLifecycle,
        options.Value.SurveyLifecycleInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.SurveyLifecycleBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await SurveyLifecycleJob.RunAsync(
            db, loggerFactory, nowUtc, _batchSize, cancellationToken);

        if (result.MoreRemaining)
        {
            // Only worth a line when the cap actually bit, and here that means surveys are
            // waiting another five minutes to open or close. Expected exactly once -- on the
            // first tick after this job is deployed, working through the backlog of surveys
            // that have been past their end date since before anything closed them.
            logger.LogInformation(
                "Survey lifecycle sweep took its full batch (opened {Opened}, closed {Closed}); more surveys are " +
                "due a transition on the next tick.",
                result.Opened,
                result.Closed);
        }
    }
}

/// <summary>
/// Closes a microclimate on its end time. See <see cref="MicroclimateLifecycleJob"/> for the one
/// transition it makes and, at greater length, for the one it refuses.
///
/// <para><b>The second job here that writes a status, and the one whose write cannot be
/// undone.</b> <c>closed</c> is terminal in <c>MicroclimateStatuses</c> -- no outgoing edges at
/// all -- so unlike a survey, which can be duplicated and re-run, a microclimate closed in error
/// is finished. The conservatism therefore lives in
/// <see cref="ClimateProject.Application.Microclimates.MicroclimateLifecycleSchedule"/> rather
/// than here: this class does nothing but hand the sweep a clock and a cap, exactly like its
/// siblings.</para>
///
/// <para><b>Cross-tenant, like every job here.</b> No company id: a scheduler that advanced one
/// tenant's microclimates would leave every other company's sessions collecting answers past
/// their deadline with nothing reporting a problem. The four HTTP routes that change a
/// microclimate's status are all a human moving one session they administer; this is the
/// platform honouring a deadline that was already agreed.</para>
/// </summary>
public sealed class MicroclimateLifecycleWorker(
    IServiceScopeFactory scopeFactory,
    WorkerHeartbeats heartbeats,
    IOptions<WorkerSchedulingOptions> options,
    ILogger<MicroclimateLifecycleWorker> logger)
    : ScheduledJobWorker(
        WorkerJobs.MicroclimateLifecycle,
        options.Value.MicroclimateLifecycleInterval,
        options.Value.Enabled,
        scopeFactory,
        heartbeats,
        logger)
{
    private readonly int _batchSize = options.Value.MicroclimateLifecycleBatchSize;

    protected override async Task RunOnceAsync(
        IServiceProvider services,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<ClimateProjectDbContext>();
        var loggerFactory = services.GetRequiredService<ILoggerFactory>();

        var result = await MicroclimateLifecycleJob.RunAsync(
            db, loggerFactory, nowUtc, _batchSize, cancellationToken);

        if (result.MoreRemaining)
        {
            // Only worth a line when the cap actually bit, and here that means microclimates are
            // accepting answers past their deadline for another five minutes -- answers that
            // cannot be unpicked afterwards. Expected exactly once, on the first tick after this
            // job is deployed, working through every session that has been past its end time
            // since before anything closed one.
            logger.LogInformation(
                "Microclimate lifecycle sweep took its full batch (closed {Closed}); more sessions are due to " +
                "close on the next tick.",
                result.Closed);
        }
    }
}
