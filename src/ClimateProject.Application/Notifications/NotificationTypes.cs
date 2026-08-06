namespace ClimateProject.Application.Notifications;

/// <summary>
/// What a notification is *about*. Same reasoning as <see cref="NotificationChannels"/>:
/// one canonical vocabulary, derived subsets, no independent literal lists.
///
/// The nine values are the legacy Mongoose <c>Notification.type</c> enum verbatim
/// (<c>docs/superpowers/plans/2026-07-31-notifications-schema.md</c>). Note the legacy
/// <c>NotificationTemplate.type</c> enum omits <see cref="UserInvitation"/>; both columns
/// share one unconstrained <c>varchar(32)</c>, so that difference is an application-layer
/// concern and is not represented here.
///
/// The type is what decides whether a per-user email opt-out applies -- see
/// <see cref="NotificationDispatchPolicy"/>, which owns that mapping so it lives in exactly
/// one place.
/// </summary>
public static class NotificationTypes
{
    public const string SurveyInvitation = "survey_invitation";
    public const string SurveyReminder = "survey_reminder";
    public const string SurveyCompletion = "survey_completion";
    public const string MicroclimateInvitation = "microclimate_invitation";

    /// <summary>
    /// "You have been invited to the platform." Transactional: a recipient who has not
    /// accepted yet has no preferences to consult, and suppressing it would make the
    /// account unreachable. Deliberately ungoverned -- see <see cref="NotificationDispatchPolicy"/>.
    /// </summary>
    public const string UserInvitation = "user_invitation";

    public const string ActionPlanAlert = "action_plan_alert";
    public const string DeadlineReminder = "deadline_reminder";
    public const string AiInsightAlert = "ai_insight_alert";

    /// <summary>Operational/administrative notices. Ungoverned, for the same reason as <see cref="UserInvitation"/>.</summary>
    public const string SystemNotification = "system_notification";

    public static readonly string[] All =
    [
        SurveyInvitation,
        SurveyReminder,
        SurveyCompletion,
        MicroclimateInvitation,
        UserInvitation,
        ActionPlanAlert,
        DeadlineReminder,
        AiInsightAlert,
        SystemNotification,
    ];

    public static bool IsKnown(string? type)
        => type is not null && Array.IndexOf(All, type) >= 0;
}
