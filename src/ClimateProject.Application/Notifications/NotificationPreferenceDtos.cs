namespace ClimateProject.Application.Notifications;

/// <summary>
/// The caller's own notification preferences (#103).
///
/// **Five fields, not six.** <c>NotificationPreferences.PushNotifications</c> is stored on
/// the user but is deliberately absent from this DTO: there is no push infrastructure and
/// no device-token storage anywhere in this repo, so exposing the toggle would advertise a
/// delivery channel that cannot deliver. A preference the product silently ignores is worse
/// than an absent one. Wire it in here in the same change that ships push delivery, once
/// #82 settles the PWA question -- see <see cref="Domain.Entities.NotificationPreferences"/>.
/// </summary>
public sealed record NotificationPreferencesResponse(
    bool EmailSurveys,
    bool EmailMicroclimates,
    bool EmailActionPlans,
    bool EmailReminders,
    string DigestFrequency);

/// <summary>
/// A full replacement of the five exposed preferences.
///
/// Every field is nullable and every field is *required* -- an omitted one is a 400, not a
/// default. That looks redundant next to a plain <c>bool</c> until you notice what a plain
/// <c>bool</c> does with a missing key: <c>System.Text.Json</c> leaves it at <c>false</c>,
/// which for four opt-out flags means a partial payload silently unsubscribes the user from
/// mail they never asked to stop receiving. Four of these five are consent state (see
/// <see cref="Domain.Entities.UserConsent"/>, which sits beside them for that reason), and
/// consent state must never be inferred from silence.
///
/// PATCH-style merge semantics were considered and rejected for the same reason in reverse:
/// with a merge, a client that renders a stale value and submits it cannot be told apart
/// from one that means to leave the field alone. Replacement makes the request say exactly
/// what the user saw and confirmed.
/// </summary>
public sealed record UpdateNotificationPreferencesRequest(
    bool? EmailSurveys,
    bool? EmailMicroclimates,
    bool? EmailActionPlans,
    bool? EmailReminders,
    string? DigestFrequency);
