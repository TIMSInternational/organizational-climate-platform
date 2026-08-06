namespace ClimateProject.Application.Scheduling;

/// <summary>
/// Whether an outstanding survey or microclimate invitation is owed a reminder right now.
///
/// Pure and static, over a clock passed in, for the same reason
/// <c>NotificationDispatchPolicy</c> is: this is the rule most expensive to get wrong -- both
/// directions of wrong are visible to end users, one as silence and the other as nagging --
/// and a rule that can only be exercised by waiting real time is a rule that is not
/// exercised. Every case below is a unit test with no Docker and no clock skew.
/// </summary>
public static class ReminderSchedule
{
    /// <summary>
    /// How many reminders one invitation may ever receive, when the survey does not say.
    ///
    /// A cap exists at all because the frequency alone does not bound anything: a survey left
    /// open for a quarter with a 3-day reminder cadence would mail a non-responder thirty
    /// times, and the thirtieth reminder does not persuade anyone who ignored the first
    /// three. Legacy had no cap, which is one of the reasons response-rate work kept running
    /// into unsubscribes.
    /// </summary>
    public const int DefaultMaxReminders = 3;

    /// <summary>
    /// Floor on the reminder interval. <c>SurveySettings.NotificationReminderFrequencyDays</c>
    /// is a plain <c>int</c> with no validation behind it, so it can hold 0 or a negative
    /// number -- and at 0 the "has enough time passed" test is satisfied on every tick, which
    /// would mail every non-responder every 15 minutes until the cap. Clamping here rather
    /// than trusting the column is the difference between a bad setting and an incident.
    /// </summary>
    public const int MinimumFrequencyDays = 1;

    /// <summary>
    /// Decide. See <see cref="ReminderDecision"/> for how the answer is shaped and
    /// <see cref="ReminderCandidate"/> for what has to be known to give it.
    /// </summary>
    public static ReminderDecision Evaluate(ReminderCandidate candidate, DateTimeOffset nowUtc)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        if (!candidate.RemindersEnabled)
        {
            return ReminderDecision.Skip("Reminders are switched off for this survey.");
        }

        // "Outstanding" is the whole premise of a reminder. A completed response is the one
        // state where a reminder is not merely unnecessary but actively wrong: it tells
        // someone who did the thing that they did not.
        if (candidate.CompletedAt is not null)
        {
            return ReminderDecision.Skip("The recipient has already responded.");
        }

        if (!InvitationIsOutstanding(candidate.Status))
        {
            return ReminderDecision.Skip($"Invitation status '{candidate.Status}' is not outstanding.");
        }

        // Never invited, so there is nothing to be reminded *of*. Sending the first contact
        // as a reminder would be incoherent, and it would also let this job paper over a
        // broken distribution run instead of leaving it visible.
        if (candidate.SentAt is null)
        {
            return ReminderDecision.Skip("The invitation has not been sent yet.");
        }

        // Past the close, a reminder is worse than nothing: it points at a survey that will
        // refuse the response it asks for. Both bounds are checked because they are set
        // independently -- the token can outlive the survey window and vice versa.
        if (nowUtc >= candidate.ExpiresAt)
        {
            return ReminderDecision.Skip("The invitation has expired.");
        }

        if (nowUtc >= candidate.ClosesAt)
        {
            return ReminderDecision.Skip("The survey window has closed.");
        }

        var maxReminders = candidate.MaxReminders ?? DefaultMaxReminders;
        if (candidate.ReminderCount >= maxReminders)
        {
            return ReminderDecision.Skip($"Already sent the maximum of {maxReminders} reminders.");
        }

        var frequencyDays = Math.Max(MinimumFrequencyDays, candidate.FrequencyDays);

        // The clock starts at the last thing the recipient actually received. Anchoring on
        // SentAt for the first reminder rather than on "now minus frequency" is what stops a
        // freshly distributed survey from reminding everybody the same afternoon it went out.
        var since = candidate.LastReminderSent ?? candidate.SentAt.Value;
        var dueAt = since.AddDays(frequencyDays);
        if (nowUtc < dueAt)
        {
            return ReminderDecision.Skip($"Not due until {dueAt:O}.");
        }

        // The ordinal, not a date, is the reminder's identity -- see
        // DeterministicNotificationId.ForReminder.
        return ReminderDecision.Send(candidate.ReminderCount + 1, dueAt);
    }

    /// <summary>
    /// Invitation statuses that still represent an unanswered ask.
    ///
    /// <c>survey_invitations.status</c> is an unconstrained <c>varchar(20)</c> defaulting to
    /// <c>pending</c>, and no code in the repository writes any other value yet, so this is an
    /// allow-list rather than a deny-list: an unrecognised status means "we do not know what
    /// this row is", and the safe reading of that is to leave the recipient alone.
    /// </summary>
    public static bool InvitationIsOutstanding(string? status)
        => string.Equals(status, InvitationOutstanding, StringComparison.Ordinal)
           || string.Equals(status, InvitationSent, StringComparison.Ordinal)
           || string.Equals(status, InvitationOpened, StringComparison.Ordinal)
           || string.Equals(status, InvitationStarted, StringComparison.Ordinal);

    /// <summary>The DDL default, and the only value anything writes today.</summary>
    public const string InvitationOutstanding = "pending";

    /// <summary>Delivered, not yet opened.</summary>
    public const string InvitationSent = "sent";

    /// <summary>Opened, not yet begun.</summary>
    public const string InvitationOpened = "opened";

    /// <summary>Begun but not submitted -- a partial. Still outstanding, and the group most worth reminding.</summary>
    public const string InvitationStarted = "started";
}

/// <summary>
/// Everything <see cref="ReminderSchedule.Evaluate"/> needs, flattened off the entity so the
/// rule can be tested without a <c>DbContext</c> and so the same rule serves survey and
/// microclimate invitations, whose columns are identical but whose types are not.
/// </summary>
/// <param name="InvitationId">Half of the reminder's deterministic notification id.</param>
/// <param name="Status">The invitation's status. See <see cref="ReminderSchedule.InvitationIsOutstanding"/>.</param>
/// <param name="SentAt">When the invitation itself went out. Null means it never did.</param>
/// <param name="CompletedAt">When the recipient submitted. Non-null ends reminders for good.</param>
/// <param name="LastReminderSent">When the previous reminder went out, if any.</param>
/// <param name="ReminderCount">How many reminders have already gone out. Also the ordinal base.</param>
/// <param name="ExpiresAt">When the invitation token stops working.</param>
/// <param name="ClosesAt">When the survey or microclimate stops accepting responses.</param>
/// <param name="RemindersEnabled"><c>SurveySettings.NotificationSendReminders</c>.</param>
/// <param name="FrequencyDays"><c>SurveySettings.NotificationReminderFrequencyDays</c>, clamped on use.</param>
/// <param name="MaxReminders">Per-survey override; null uses <see cref="ReminderSchedule.DefaultMaxReminders"/>.</param>
public sealed record ReminderCandidate(
    Guid InvitationId,
    string? Status,
    DateTimeOffset? SentAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? LastReminderSent,
    int ReminderCount,
    DateTimeOffset ExpiresAt,
    DateTimeOffset ClosesAt,
    bool RemindersEnabled,
    int FrequencyDays,
    int? MaxReminders = null);

/// <summary>
/// The answer, with its reason attached.
///
/// The reason is carried on the *skip* as well as the send because "why did this person not
/// get reminded" is the question this job actually gets asked, and reconstructing it after
/// the fact from four nullable timestamps is exactly the kind of archaeology that makes
/// people distrust a scheduler. It is logged at debug and never stored.
/// </summary>
/// <param name="ShouldSend">Whether to send.</param>
/// <param name="ReminderNumber">The ordinal of the reminder to send; 0 when not sending.</param>
/// <param name="DueAt">
/// The instant the reminder became due. Written to <c>Notification.ScheduledFor</c> in
/// preference to "now", so the stored row says when it was owed rather than when a tick
/// happened to notice -- and so two instances racing would compute the same value.
/// </param>
/// <param name="Reason">Why not, when not sending.</param>
public sealed record ReminderDecision(bool ShouldSend, int ReminderNumber, DateTimeOffset DueAt, string? Reason)
{
    public static ReminderDecision Send(int reminderNumber, DateTimeOffset dueAt)
        => new(true, reminderNumber, dueAt, null);

    public static ReminderDecision Skip(string reason)
        => new(false, 0, default, reason);
}
