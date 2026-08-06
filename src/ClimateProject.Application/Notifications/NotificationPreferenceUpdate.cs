using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// Validation and projection for the self-service preferences endpoint (#103).
///
/// Pulled out of <c>NotificationPreferenceEndpoints</c> so the rules that matter here --
/// "an omitted flag is an error, not a false", "push is never read from or written by the
/// public API" -- are covered by the unit suite, which needs no Postgres container.
/// </summary>
public static class NotificationPreferenceUpdate
{
    public static IReadOnlyList<string> Validate(UpdateNotificationPreferencesRequest request)
    {
        var errors = new List<string>();

        if (request.EmailSurveys is null) errors.Add("emailSurveys is required");
        if (request.EmailMicroclimates is null) errors.Add("emailMicroclimates is required");
        if (request.EmailActionPlans is null) errors.Add("emailActionPlans is required");
        if (request.EmailReminders is null) errors.Add("emailReminders is required");

        if (request.DigestFrequency is null)
        {
            errors.Add("digestFrequency is required");
        }
        else if (!NotificationPreferenceValidation.IsValidDigestFrequency(request.DigestFrequency))
        {
            errors.Add(
                "digestFrequency must be one of: "
                + string.Join(", ", NotificationPreferenceValidation.ValidDigestFrequencies));
        }

        return errors;
    }

    /// <summary>
    /// Writes the five exposed preferences onto <paramref name="target"/>, exactly as
    /// submitted.
    ///
    /// <see cref="NotificationPreferences.PushNotifications"/> is untouched on purpose: it
    /// is stored consent state that this API neither shows nor accepts, so a round-trip
    /// through the preferences page must leave whatever the ETL imported (#154) intact.
    /// Callers must have run <see cref="Validate"/> first; the nulls are unreachable here.
    /// </summary>
    public static void Apply(NotificationPreferences target, UpdateNotificationPreferencesRequest request)
    {
        ArgumentNullException.ThrowIfNull(target);

        if (Validate(request).Count > 0)
        {
            throw new ArgumentException("Request must be validated before it is applied.", nameof(request));
        }

        target.EmailSurveys = request.EmailSurveys!.Value;
        target.EmailMicroclimates = request.EmailMicroclimates!.Value;
        target.EmailActionPlans = request.EmailActionPlans!.Value;
        target.EmailReminders = request.EmailReminders!.Value;
        target.DigestFrequency = request.DigestFrequency!;
    }

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
}
