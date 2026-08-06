using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// The self-service view of <c>User.Notifications</c>: **five** of the six stored
/// preferences.
///
/// <c>PushNotifications</c> is stored (consent fidelity -- dropping the column would lose
/// the legacy value on import, and re-adding it later would default everyone to a value they
/// never chose) but deliberately absent here, because this repo has no push infrastructure
/// and no device-token storage, so the API must not advertise a channel it cannot deliver
/// on. Expose it in the same change that ships push delivery, once #82 decides on the PWA.
///
/// Two tests pin the split from both ends: <c>NotificationPreferenceTests</c> asserts six
/// columns are stored, and <c>NotificationPreferenceUpdateTests</c> asserts this record
/// exposes exactly five and never names push. Neither is the one to "fix" if they seem to
/// disagree -- they are the two halves of the same decision.
/// </summary>
public sealed record NotificationPreferencesResponse(
    bool EmailSurveys,
    bool EmailMicroclimates,
    bool EmailActionPlans,
    bool EmailReminders,
    string DigestFrequency);

/// <summary>
/// A partial update. **Every field is nullable, and that is a consent requirement, not a
/// convenience.**
///
/// With non-nullable <c>bool</c>s, a client that sent only <c>{"digestFrequency":"daily"}</c>
/// would deserialise the four opt-ins as <c>false</c> and silently unsubscribe the user from
/// everything; with the record's own defaults filling in, it would silently *re*-subscribe
/// someone who had opted out. Null means "not mentioned, leave exactly as stored", which is
/// the only reading that cannot change a choice the user did not make in this request.
/// </summary>
public sealed record UpdateNotificationPreferencesRequest(
    bool? EmailSurveys = null,
    bool? EmailMicroclimates = null,
    bool? EmailActionPlans = null,
    bool? EmailReminders = null,
    string? DigestFrequency = null);

/// <summary>
/// Reading and writing the exposed five. Pure functions over the domain type so the consent
/// semantics are unit-testable without a database.
/// </summary>
public static class NotificationPreferenceUpdate
{
    public static NotificationPreferencesResponse ToResponse(NotificationPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);

        return new NotificationPreferencesResponse(
            preferences.EmailSurveys,
            preferences.EmailMicroclimates,
            preferences.EmailActionPlans,
            preferences.EmailReminders,
            preferences.DigestFrequency);
    }

    /// <summary>
    /// Apply a partial update in place, or reject it whole.
    ///
    /// Validation runs to completion **before** the first assignment, so a request carrying
    /// one good field and one bad one leaves the stored preferences entirely untouched. A
    /// half-applied consent change is not something a user can see or correct.
    ///
    /// <c>PushNotifications</c> is never read and never written here -- the stored value
    /// survives every self-service update untouched, which is exactly what "stored for
    /// consent fidelity" has to mean.
    /// </summary>
    public static bool TryApply(
        NotificationPreferences target,
        UpdateNotificationPreferencesRequest request,
        out string? error)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(request);

        error = null;

        if (request.DigestFrequency is not null
            && !NotificationPreferenceValidation.IsValidDigestFrequency(request.DigestFrequency))
        {
            // The vocabulary is read from NotificationPreferenceValidation rather than
            // re-listed, per its own doc comment: a second literal list is precisely how the
            // question-type vocabularies drifted apart.
            error = $"Invalid DigestFrequency '{request.DigestFrequency}'. Supported: "
                    + string.Join(", ", NotificationPreferenceValidation.ValidDigestFrequencies);
            return false;
        }

        target.EmailSurveys = request.EmailSurveys ?? target.EmailSurveys;
        target.EmailMicroclimates = request.EmailMicroclimates ?? target.EmailMicroclimates;
        target.EmailActionPlans = request.EmailActionPlans ?? target.EmailActionPlans;
        target.EmailReminders = request.EmailReminders ?? target.EmailReminders;
        target.DigestFrequency = request.DigestFrequency ?? target.DigestFrequency;

        return true;
    }
}
