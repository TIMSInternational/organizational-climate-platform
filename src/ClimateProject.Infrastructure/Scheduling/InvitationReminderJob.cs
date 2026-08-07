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

        var surveys = await SweepSurveysAsync(db, logger, nowUtc, batchSize, cancellationToken);
        var microclimates = await SweepMicroclimatesAsync(db, logger, nowUtc, batchSize, cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        return new ReminderSweepResult(
            surveys.Examined + microclimates.Examined,
            surveys.Raised + microclimates.Raised);
    }

    private static async Task<ReminderSweepResult> SweepSurveysAsync(
        ClimateProjectDbContext db,
        ILogger logger,
        DateTimeOffset nowUtc,
        int batchSize,
        CancellationToken cancellationToken)
    {
        // The cheap, SQL-expressible exclusions happen here; the rest of the rule is
        // ReminderSchedule's and runs in memory over what survives. Splitting it that way keeps
        // the interesting half unit-testable without a database, and keeps this query from
        // dragging a whole tenant's invitation history into the worker.
        //
        // Only `active` surveys: a scheduled survey is not open yet, and a closed one cannot
        // accept the response the reminder would be asking for.
        //
        // Two queries rather than one Join, deliberately. `Settings` is an OWNED type, and inside
        // a Join's inner query EF renders it as EF.Property<SurveySettings>(s, "Settings") and
        // then fails to translate the whole expression at run time -- it compiles, and it throws
        // InvalidOperationException the first time the sweep runs. In a plain Where over
        // DbSet<Survey> the same property is just a column on `surveys`, which translates fine.
        //
        // The first query is bounded by the number of *currently active* surveys with reminders
        // enabled (tens, not thousands), so materialising it is cheap; the batch bound that
        // matters stays on the invitations, which is the table that actually grows.
        var openSurveys = await db.Surveys
            .Where(survey =>
                survey.Status == SurveyStatuses.Active
                && survey.EndDate > nowUtc
                && survey.Settings.NotificationSendReminders)
            .ToListAsync(cancellationToken);

        if (openSurveys.Count == 0)
        {
            return new ReminderSweepResult(0, 0);
        }

        var surveysById = openSurveys.ToDictionary(survey => survey.Id);
        var openSurveyIds = surveysById.Keys.ToList();

        var candidates = (await db.SurveyInvitations
            .Where(invitation =>
                invitation.CompletedAt == null
                && invitation.ExpiresAt > nowUtc
                && openSurveyIds.Contains(invitation.SurveyId))
            .OrderBy(invitation => invitation.CreatedAt)
            .Take(batchSize)
            .ToListAsync(cancellationToken))
            .Select(invitation => new SurveyReminderRow(invitation, surveysById[invitation.SurveyId]))
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
                    row.Survey.EndDate,
                    row.Survey.Settings.NotificationSendReminders,
                    row.Survey.Settings.NotificationReminderFrequencyDays),
                nowUtc);

            if (!decision.ShouldSend)
            {
                logger.LogDebug(
                    "Survey invitation {InvitationId} not reminded: {Reason}", row.Invitation.Id, decision.Reason);
                continue;
            }

            if (!recipients.TryGetValue(row.Invitation.UserId, out var recipient))
            {
                // Unreachable while the user_id FK holds. Skipping rather than guessing: a
                // notification needs a company id and a language, and inventing either would
                // mean mailing someone we cannot describe.
                continue;
            }

            var title = LocalizedContent
                .Resolve(row.Survey.TitleEn, row.Survey.TitleEs, recipient.Preferences.Language, row.Survey.Language)
                .Text;

            planned.Add(new PlannedReminder(
                DeterministicNotificationId.ForReminder(row.Invitation.Id, decision.ReminderNumber),
                recipient,
                NotificationTypes.SurveyReminder,
                title,
                row.Survey.EndDate,
                decision.DueAt,
                () =>
                {
                    row.Invitation.ReminderCount = decision.ReminderNumber;
                    row.Invitation.LastReminderSent = decision.DueAt;
                    row.Invitation.UpdatedAt = nowUtc;
                }));
        }

        var raised = await RaiseAsync(db, planned, nowUtc, cancellationToken);
        return new ReminderSweepResult(candidates.Count, raised);
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
                // There is no `microclimate_reminder` in NotificationTypes, and there must not
                // be: the nine values are the legacy Mongoose enum verbatim and a unit test pins
                // them. `deadline_reminder` is documented as "nudges for anything still
                // outstanding", is gated by EmailReminders, and is the correct existing member.
                NotificationTypes.DeadlineReminder,
                title,
                row.Microclimate.Scheduling.EndTime,
                decision.DueAt,
                () =>
                {
                    row.Invitation.ReminderCount = decision.ReminderNumber;
                    row.Invitation.LastReminderSent = decision.DueAt;
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

                // Guarded by the caller's recipient filter: notifications.company_id is a
                // non-nullable FK, so a global-scope user (CompanyId null, i.e. a super admin --
                // see #191) cannot own one. They are also not survey respondents.
                CompanyId = reminder.Recipient.CompanyId!.Value,
                Type = reminder.Type,
                Channel = NotificationChannels.Email,
                Priority = NotificationPriorities.Medium,
                Status = NotificationStatuses.Pending,
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

    private sealed record SurveyReminderRow(SurveyInvitation Invitation, Survey Survey);

    private sealed record MicroclimateReminderRow(MicroclimateInvitation Invitation, Microclimate Microclimate);

    private sealed record PlannedReminder(
        Guid NotificationId,
        User Recipient,
        string Type,
        string? ContentTitle,
        DateTimeOffset ClosesAt,
        DateTimeOffset DueAt,
        Action MarkInvitation);
}

/// <summary>What one reminder sweep did.</summary>
/// <param name="Examined">Invitations the query returned as plausibly due.</param>
/// <param name="Raised">Reminder notifications actually created.</param>
public sealed record ReminderSweepResult(int Examined, int Raised);
