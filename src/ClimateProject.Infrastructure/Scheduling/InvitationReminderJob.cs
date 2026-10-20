using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Scheduling;

/// <summary>
/// Nudges people who were invited to a survey or microclimate and have not responded.
///
/// <para>This is the direct replacement for legacy <c>api/cron/send-reminders</c>, which
/// <c>vercel.json</c> runs every 15 minutes in production today and which had no equivalent
/// anywhere in the new stack. Cutting over without it would stop reminders silently -- no
/// error, no alert, just a slow decline in response rates that nobody attributes to a
/// deployment for weeks. That regression is the reason #101 exists.</para>
///
/// <para><b>What it does not do: send.</b> It creates <c>pending</c> notification rows and
/// stops. Delivery, and with it the per-user email opt-out in
/// <c>NotificationDispatchPolicy</c>, belongs to <see cref="NotificationDelivery"/> and runs on
/// its own sweep. Two reasons. Consent is evaluated at delivery time by design, so a recipient
/// who opts out between the reminder being raised and being sent is still honoured. And a
/// reminder that went straight to the provider from here would be a second dispatch path with
/// its own copy of the consent rules -- the exact duplication #101 says to avoid.</para>
///
/// <para><b>Idempotency, in two independent layers.</b> Each reminder's notification id is
/// <c>uuidv5(namespace, invitationId:ordinal)</c>, so the same nudge computes the same primary
/// key from any instance at any time and a repeat insert violates <c>notifications_pkey</c>.
/// Independently, <c>reminder_count</c> and <c>last_reminder_sent</c> are advanced on the
/// invitation row in the same transaction, so the next sweep's
/// <see cref="ReminderSchedule.Evaluate"/> sees the nudge as already issued. #101 asks for send
/// state to be persisted rather than inferred from timestamps; the ordinal is that state, and
/// the timestamp is only used for spacing.</para>
/// </summary>
public static class InvitationReminderJob
{
    /// <summary>
    /// Invitations examined per sweep, per surface. Bounded so one sweep is one bounded
    /// transaction; the next tick picks up where this one stopped, because every invitation it
    /// acted on is no longer due.
    /// </summary>
    public const int DefaultBatchSize = 500;

    private const string LogCategory = "ClimateProject.Workers.InvitationReminders";

    public static async Task<ReminderSweepResult> RunAsync(
        ClimateProjectDbContext db,
        ILoggerFactory loggerFactory,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        ArgumentOutOfRangeException.ThrowIfLessThan(batchSize, 1);

        var logger = loggerFactory.CreateLogger(LogCategory);

        // SURVEYS ARE NO LONGER SWEPT. The survey reminder email was deleted on 2026-10-19
        // together with the invitation mail it reminded about: "the other ones that we
        // received, like as a reminder ... we never want to send that." Microclimates keep
        // theirs -- a different surface, a different ruling, and nobody asked for that one.
        //
        // This sweep could no longer have produced a survey reminder in any case: it only
        // ever examined invitations whose status was sent/opened/started, and `sent` had
        // exactly one producer, which is gone. Deleting the call makes that a property of
        // the code instead of a property of the data.
        var microclimates = await SweepMicroclimatesAsync(db, logger, nowUtc, batchSize, cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        return new ReminderSweepResult(microclimates.Examined, microclimates.Raised);
    }

    private static async Task<ReminderSweepResult> SweepMicroclimatesAsync(
        ClimateProjectDbContext db,
        ILogger logger,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        // A microclimate has no per-instance "send reminders" switch the way a survey's
        // SurveySettings does, and no reminder frequency either -- the only scheduling field is
        // MicroclimateScheduling.ReminderSchedule, a nullable free-text column nothing in the
        // repository reads or writes. So reminders are on by default here, at the survey
        // default cadence. Microclimates are short-lived by design (hours to days), which the
        // reminder cap and the "not past EndTime" bound keep this from abusing.
        // Same two-query shape, and for the same reason as the survey sweep above:
        // `Scheduling` is an owned type, and filtering through it inside a Join's inner query
        // produces an expression EF cannot translate at run time.
        var openMicroclimates = await db.Microclimates
            .Where(microclimate =>
                microclimate.Status == MicroclimateActive
                && microclimate.Scheduling.EndTime > nowUtc)
            .ToListAsync(cancellationToken);

        if (openMicroclimates.Count == 0)
        {
            return new ReminderSweepResult(0, 0);
        }

        var microclimatesById = openMicroclimates.ToDictionary(microclimate => microclimate.Id);
        var openMicroclimateIds = microclimatesById.Keys.ToList();

        var candidates = (await db.MicroclimateInvitations
            .Where(invitation =>
                invitation.CompletedAt == null
                && invitation.ExpiresAt > nowUtc
                && openMicroclimateIds.Contains(invitation.MicroclimateId))
            .OrderBy(invitation => invitation.CreatedAt)
            .Take(batchSize)
            .ToListAsync(cancellationToken))
            .Select(invitation =>
                new MicroclimateReminderRow(invitation, microclimatesById[invitation.MicroclimateId]))
            .ToList();

        if (candidates.Count == 0)
        {
            return new ReminderSweepResult(0, 0);
        }

        var recipients = await LoadRecipientsAsync(
            db, candidates.Select(row => row.Invitation.UserId), cancellationToken);

        var planned = new List<PlannedReminder>();
        foreach (var row in candidates)
        {
            var decision = ReminderSchedule.Evaluate(
                new ReminderCandidate(
                    row.Invitation.Id,
                    row.Invitation.Status,
                    row.Invitation.SentAt,
                    row.Invitation.CompletedAt,
                    row.Invitation.LastReminderSent,
                    row.Invitation.ReminderCount,
                    row.Invitation.ExpiresAt,
                    row.Microclimate.Scheduling.EndTime,
                    RemindersEnabled: true,
                    MicroclimateReminderFrequencyDays),
                nowUtc);

            if (!decision.ShouldSend)
            {
                logger.LogDebug(
                    "Microclimate invitation {InvitationId} not reminded: {Reason}", row.Invitation.Id, decision.Reason);
                continue;
            }

            if (!recipients.TryGetValue(row.Invitation.UserId, out var recipient))
            {
                continue;
            }

            var title = LocalizedContent
                .Resolve(
                    row.Microclimate.TitleEn,
                    row.Microclimate.TitleEs,
                    recipient.Preferences.Language,
                    row.Microclimate.Language)
                .Text;

            planned.Add(new PlannedReminder(
                DeterministicNotificationId.ForMicroclimateReminder(row.Invitation.Id, decision.ReminderNumber),
                recipient,
                row.Microclimate.CompanyId,
                // There is no `microclimate_reminder` in NotificationTypes, and there must not
                // be: the nine values are the legacy Mongoose enum verbatim and a unit test pins
                // them. `deadline_reminder` is documented as "nudges for anything still
                // outstanding", is gated by EmailReminders, and is the correct existing member.
                NotificationTypes.DeadlineReminder,
                title,
                row.Microclimate.Scheduling.EndTime,
                decision.DueAt,

                // No payload, and not an omission: `deadline_reminder` is not a link-carrying
                // type, the row this reminds about is a microclimate_invitations row, and
                // SurveyNotificationData names a survey_invitations id. Writing one here would
                // be a foreign key into the wrong table.
                Data: null,
                () =>
                {
                    row.Invitation.ReminderCount = decision.ReminderNumber;
                    // `now`, not decision.DueAt. DueAt is when the reminder BECAME due, which
                    // for a backlogged invitation is in the past -- and recording that as the
                    // last send makes the next one already due at the same instant, so every
                    // sweep fires another until it "catches up". That is a burst of reminders
                    // arriving at the recipient seconds apart, and it is what broke the
                    // acceptance criterion that a second tick sends nothing extra.
                    row.Invitation.LastReminderSent = nowUtc;
                    row.Invitation.UpdatedAt = nowUtc;
                }));
        }

        var raised = await RaiseAsync(db, planned, nowUtc, cancellationToken);
        return new ReminderSweepResult(candidates.Count, raised);
    }

    /// <summary>
    /// Add the notification rows and advance the invitation counters, skipping anything whose
    /// deterministic id already exists.
    ///
    /// The pre-check is an optimisation, not the guarantee: without it a duplicate would fail
    /// the whole batch's <c>SaveChanges</c> on a primary key violation rather than being quietly
    /// skipped. The guarantee is the primary key itself, which holds even if this query races.
    /// </summary>
    private static async Task<int> RaiseAsync(
        ClimateProjectDbContext db,
        List<PlannedReminder> planned,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        if (planned.Count == 0)
        {
            return 0;
        }

        var ids = planned.Select(reminder => reminder.NotificationId).ToList();
        var alreadyRaised = (await db.Notifications
                .Where(notification => ids.Contains(notification.Id))
                .Select(notification => notification.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var raised = 0;
        foreach (var reminder in planned)
        {
            if (alreadyRaised.Contains(reminder.NotificationId))
            {
                continue;
            }

            db.Notifications.Add(new Notification
            {
                Id = reminder.NotificationId,
                UserId = reminder.Recipient.Id,

                // The CONTENT's tenant, matching what SurveyDistributionEndpoints writes for the
                // same invitation. See the remarks on PlannedReminder.CompanyId for why the
                // recipient's own company is the wrong answer here.
                CompanyId = reminder.CompanyId,
                Type = reminder.Type,
                Channel = NotificationChannels.Email,
                Priority = NotificationPriorities.Medium,
                Status = NotificationStatuses.Pending,
                Data = reminder.Data,
                Title = ScheduledNotificationCopy.ReminderTitleFor(reminder.Recipient.Preferences.Language),
                Message = ScheduledNotificationCopy.ReminderBodyFor(
                    reminder.Recipient.Preferences.Language, reminder.ContentTitle, reminder.ClosesAt),

                // The instant the reminder became due, not the instant a tick noticed it. Two
                // instances racing compute the same value, and a late sweep records when the
                // nudge was owed rather than when the scheduler got round to it.
                ScheduledFor = reminder.DueAt,
                RetryCount = 0,
                MaxRetries = 3,
                CreatedAt = nowUtc,
                UpdatedAt = nowUtc,
            });

            reminder.MarkInvitation();
            raised++;
        }

        return raised;
    }

    private static async Task<Dictionary<Guid, User>> LoadRecipientsAsync(
        ClimateProjectDbContext db,
        IEnumerable<Guid> userIds,
        CancellationToken cancellationToken)
    {
        var ids = userIds.Distinct().ToList();

        return await db.Users
            .Where(user => ids.Contains(user.Id) && user.IsActive && user.CompanyId != null)
            .ToDictionaryAsync(user => user.Id, cancellationToken);
    }

    /// <summary>
    /// <c>MicroclimateValidation.ValidStatuses</c> is <c>["draft", "active", "closed"]</c> and
    /// exposes no per-value constant, so the literal is named here rather than repeated inline.
    /// </summary>
    private const string MicroclimateActive = "active";

    /// <summary>
    /// Cadence for microclimate reminders, matching <c>SurveySettings</c>'s own default. A
    /// microclimate has no equivalent stored setting; see the note in
    /// <see cref="SweepMicroclimatesAsync"/>.
    /// </summary>
    private const int MicroclimateReminderFrequencyDays = 3;

    private sealed record MicroclimateReminderRow(MicroclimateInvitation Invitation, Microclimate Microclimate);

    /// <param name="CompanyId">
    /// The tenant the reminder belongs to: the CONTENT's company (the survey's, the
    /// microclimate's), not the recipient's.
    ///
    /// <para>
    /// They are the same until somebody is re-homed, and then they disagree -- and the manual
    /// invite path in <c>SurveyDistributionEndpoints</c> has always written the content's, so
    /// writing the recipient's here meant the same invitation to the same person produced two
    /// different answers depending on which producer raised the row. That also decided whether
    /// the mailed link survived, because the sender scopes its token lookup by this column.
    /// One answer, and it is the one that matches <c>survey_invitations.company_id</c>.
    /// </para>
    /// </param>
    /// <param name="Data">
    /// The <c>notifications.data</c> payload, or null for a reminder that names no survey
    /// invitation. Carried here rather than derived in <c>RaiseAsync</c> because only the
    /// planning loops still hold the invitation the reminder is about -- and a reminder raised
    /// without it is a reminder that mails no link, which is the whole defect this payload
    /// exists to close.
    /// </param>
    private sealed record PlannedReminder(
        Guid NotificationId,
        User Recipient,
        Guid CompanyId,
        string Type,
        string? ContentTitle,
        DateTimeOffset ClosesAt,
        DateTimeOffset DueAt,
        string? Data,
        Action MarkInvitation);
}

/// <summary>What one reminder sweep did.</summary>
/// <param name="Examined">Invitations the query returned as plausibly due.</param>
/// <param name="Raised">Reminder notifications actually created.</param>
public sealed record ReminderSweepResult(int Examined, int Raised);
