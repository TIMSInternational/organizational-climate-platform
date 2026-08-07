using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
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
