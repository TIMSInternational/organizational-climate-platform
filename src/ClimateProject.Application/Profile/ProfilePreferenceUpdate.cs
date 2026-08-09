using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Profile;

/// <summary>
/// Reading and writing the display half of <c>User.Preferences</c> (#136).
///
/// The notification half is not handled here at all -- it is delegated to
/// <c>NotificationPreferenceUpdate</c>, which already owns those six columns. One store,
/// one validator per field; see <see cref="ProfilePreferencesResponse"/>.
///
/// Pure functions over the domain type, so the rules are unit-testable without a database,
/// matching <c>NotificationPreferenceUpdate</c>.
/// </summary>
public static class ProfilePreferenceUpdate
{
    public const string ThemeLight = "light";
    public const string ThemeDark = "dark";

    /// <summary>Follow the operating system. Resolved in the browser, never stored resolved.</summary>
    public const string ThemeSystem = "system";

    /// <summary>
    /// Must stay equal to <c>web/src/theme/adminTheme.ts</c>'s <c>AdminThemeMode</c>. The
    /// browser is what actually applies the theme (it writes <c>data-admin-theme</c> on
    /// <c>&lt;html&gt;</c>); this column is where that choice follows the user to another
    /// device, so a value the server accepts and the client cannot render would be a
    /// preference that silently does nothing.
    ///
    /// Note <c>system</c> is stored as <c>system</c>, not collapsed to the resolved
    /// light/dark. Collapsing it would freeze the user's OS preference at the moment they
    /// chose it and stop it following later changes -- the same reasoning
    /// <c>adminTheme.ts</c> gives for resolving in JS rather than in CSS.
    /// </summary>
    public static readonly string[] ValidThemes = [ThemeLight, ThemeDark, ThemeSystem];

    /// <summary>
    /// The default in <c>UserConfiguration</c>'s DDL and in the CLR initializer on
    /// <c>UserPreferences.Theme</c>. A unit test asserts all three agree.
    /// </summary>
    public const string DefaultTheme = ThemeLight;

    /// <summary>Matches the <c>preferences_timezone</c> column width.</summary>
    public const int TimezoneMaxLength = 100;

    /// <summary>
    /// The one timezone that is always writable, whatever the host's tz database contains.
    /// It is also the column default, so a user must never be able to get into a state
    /// where they cannot restore it.
    /// </summary>
    public const string UtcTimezone = "UTC";

    public static bool IsValidTheme(string? value) =>
        value is not null && Array.IndexOf(ValidThemes, value) >= 0;

    /// <summary>
    /// True for an id the runtime can actually resolve -- IANA (<c>America/Bogota</c>) or
    /// Windows (<c>SA Pacific Standard Time</c>), because .NET converts between the two
    /// since .NET 6.
    ///
    /// Real resolution rather than a shape regex: the value is meant to be handed to
    /// <c>TimeZoneInfo</c> when a digest is scheduled, and "looks like a timezone" is not
    /// the property that matters there. <see cref="UtcTimezone"/> is accepted unconditionally
    /// so the column default stays writable even on a host with no tz database.
    /// </summary>
    public static bool IsValidTimezone(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > TimezoneMaxLength)
        {
            return false;
        }

        return value == UtcTimezone || TimeZoneInfo.TryFindSystemTimeZoneById(value, out _);
    }

    public static ProfileDisplayPreferences ToResponse(UserPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);

        return new ProfileDisplayPreferences(
            preferences.Language,
            preferences.Timezone,
            preferences.Theme,
            preferences.DashboardLayout);
    }

    /// <summary>
    /// Apply the display half of a partial update in place, or reject it whole.
    ///
    /// Validation runs to completion before the first assignment, so a request carrying one
    /// good field and one bad one leaves the stored preferences untouched -- the same
    /// all-or-nothing rule <c>NotificationPreferenceUpdate.TryApply</c> follows, and for the
    /// same reason: a half-applied settings change is not something the user can see or
    /// correct.
    ///
    /// <c>DashboardLayout</c> is never read and never written here. It is reported by
    /// <see cref="ToResponse"/> and owned by #133; see
    /// <see cref="ProfileDisplayPreferences"/>.
    /// </summary>
    public static bool TryApply(
        UserPreferences target,
        UpdateProfilePreferencesRequest request,
        out string? error)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(request);

        error = null;

        if (request.Language is not null && !ContentLanguages.IsLocale(request.Language))
        {
            // IsLocale, not IsValidLanguage: `both` is a property of authored content --
            // a survey written in two languages -- and is meaningless as a person's own
            // display language. See ContentLanguages.
            error = $"Invalid Language '{request.Language}'. Supported: "
                    + string.Join(", ", ContentLanguages.Locales);
            return false;
        }

        if (request.Theme is not null && !IsValidTheme(request.Theme))
        {
            error = $"Invalid Theme '{request.Theme}'. Supported: " + string.Join(", ", ValidThemes);
            return false;
        }

        if (request.Timezone is not null && !IsValidTimezone(request.Timezone))
        {
            error = $"Invalid Timezone '{request.Timezone}'. Expected an IANA or Windows time zone id.";
            return false;
        }

        target.Language = request.Language ?? target.Language;
        target.Theme = request.Theme ?? target.Theme;
        target.Timezone = request.Timezone ?? target.Timezone;

        return true;
    }
}
