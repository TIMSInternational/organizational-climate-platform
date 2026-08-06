using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// Whether a given notification may actually be delivered to a given recipient.
///
/// This is where the six preferences carried across in #192 stop being a stored blob and
/// start meaning something. Four of them are email opt-outs that live users have already
/// exercised, and the repo's own stated position is that "a preference the product silently
/// ignores is worse than an absent one" -- so an opt-out that dispatch did not consult would
/// be exactly that. Suppression happens at *delivery* time rather than at create time, so a
/// notification scheduled a week out honours the preference the recipient holds when it is
/// actually sent, not the one they held when an admin queued it.
///
/// Pure and static on purpose: no DbContext, no clock, no I/O. That makes the consent rule
/// unit-testable without Docker, which matters because it is the rule most expensive to get
/// wrong.
/// </summary>
public static class NotificationDispatchPolicy
{
    /// <summary>
    /// The notification types an email opt-out governs, paired with the preference that
    /// governs each. Everything not in this map is transactional and always delivered --
    /// see <see cref="Ungoverned"/> for why that is not an oversight.
    /// </summary>
    private static readonly Dictionary<string, string> GovernedByPreference = new(StringComparer.Ordinal)
    {
        [NotificationTypes.SurveyInvitation] = nameof(NotificationPreferences.EmailSurveys),
        [NotificationTypes.SurveyReminder] = nameof(NotificationPreferences.EmailSurveys),
        [NotificationTypes.SurveyCompletion] = nameof(NotificationPreferences.EmailSurveys),
        [NotificationTypes.MicroclimateInvitation] = nameof(NotificationPreferences.EmailMicroclimates),
        [NotificationTypes.ActionPlanAlert] = nameof(NotificationPreferences.EmailActionPlans),
        [NotificationTypes.DeadlineReminder] = nameof(NotificationPreferences.EmailReminders),
    };

    /// <summary>
    /// Types no email preference gates, derived from <see cref="NotificationTypes.All"/> so
    /// a newly added type shows up here rather than being silently dropped.
    ///
    /// <c>user_invitation</c> is transactional: the recipient has not accepted yet, so there
    /// is no preference row expressing a choice, and suppressing it would leave the account
    /// permanently unreachable. <c>system_notification</c> and <c>ai_insight_alert</c> are
    /// operational rather than marketing, and no legacy preference ever covered them --
    /// inventing a gate for them here would be inventing a consent decision the user never
    /// made. If the product later wants these opt-outable, that is a new stored preference
    /// (and a migration), not a re-use of one of these four.
    /// </summary>
    public static readonly string[] Ungoverned =
        [.. NotificationTypes.All.Where(type => !GovernedByPreference.ContainsKey(type))];

    /// <summary>
    /// The preference name gating email of this type, or null when nothing gates it.
    /// Exposed so tests and future callers read the mapping from here rather than restating it.
    /// </summary>
    public static string? GoverningPreference(string? type)
        => type is not null && GovernedByPreference.TryGetValue(type, out var preference) ? preference : null;

    /// <summary>
    /// Decide whether this notification may be handed to <see cref="INotificationSender"/>.
    ///
    /// Only <see cref="NotificationChannels.Email"/> is gated. The stored preferences are
    /// all named <c>Email*</c> and legacy only ever applied them to mail; extending them to
    /// the in-app inbox would suppress notifications the user can only ever see by opening
    /// the product, which no one opted out of.
    /// </summary>
    public static NotificationDispatchDecision Decide(
        string? channel,
        string? type,
        NotificationPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);

        if (!string.Equals(channel, NotificationChannels.Email, StringComparison.Ordinal))
        {
            return NotificationDispatchDecision.Deliver;
        }

        var governing = GoverningPreference(type);
        if (governing is null)
        {
            return NotificationDispatchDecision.Deliver;
        }

        var optedIn = governing switch
        {
            nameof(NotificationPreferences.EmailSurveys) => preferences.EmailSurveys,
            nameof(NotificationPreferences.EmailMicroclimates) => preferences.EmailMicroclimates,
            nameof(NotificationPreferences.EmailActionPlans) => preferences.EmailActionPlans,
            nameof(NotificationPreferences.EmailReminders) => preferences.EmailReminders,

            // Unreachable while GovernedByPreference only names the four above. Fail
            // CLOSED rather than defaulting to "deliver": if someone adds a mapping here
            // and forgets this switch, the safe wrong answer is not sending a mail, not
            // sending one the recipient may have opted out of.
            _ => false,
        };

        return optedIn
            ? NotificationDispatchDecision.Deliver
            : NotificationDispatchDecision.Suppress(
                $"Recipient has turned off {governing}; email of type '{type}' not delivered.");
    }
}

/// <summary>
/// The outcome of <see cref="NotificationDispatchPolicy.Decide"/>. A suppressed notification
/// is persisted with status <see cref="NotificationStatuses.Cancelled"/> and its
/// <see cref="SuppressionReason"/> in <c>FailureReason</c> -- the row is kept rather than
/// dropped so that "we honoured your opt-out" is auditable, which is the point of modelling
/// consent explicitly at all.
/// </summary>
public sealed record NotificationDispatchDecision(bool ShouldDeliver, string? SuppressionReason)
{
    public static readonly NotificationDispatchDecision Deliver = new(true, null);

    public static NotificationDispatchDecision Suppress(string reason) => new(false, reason);
}
