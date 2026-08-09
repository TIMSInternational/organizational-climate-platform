using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Profile;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Profile;

/// <summary>
/// The display half of the profile preferences contract (#136).
///
/// Two properties are pinned here:
///
/// 1. **A partial update changes nothing it was not asked to change**, the same rule
///    <c>NotificationPreferenceUpdateTests</c> pins for the notification half.
/// 2. **A rejected request writes nothing at all** -- validation completes before the first
///    assignment, so one bad field cannot leave a half-applied settings change behind.
/// </summary>
public class ProfilePreferenceUpdateTests
{
    private static UserPreferences Stored() => new()
    {
        Language = "en",
        Timezone = "UTC",
        Theme = "light",
        DashboardLayout = "default",
    };

    [Fact]
    public void An_empty_request_changes_nothing()
    {
        var preferences = Stored();
        preferences.Language = "es";
        preferences.Theme = "dark";
        preferences.Timezone = "America/Bogota";

        Assert.True(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(), out var error));

        Assert.Null(error);
        Assert.Equal("es", preferences.Language);
        Assert.Equal("dark", preferences.Theme);
        Assert.Equal("America/Bogota", preferences.Timezone);
    }

    [Fact]
    public void Each_field_can_be_changed_on_its_own()
    {
        var preferences = Stored();

        Assert.True(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(Theme: "dark"), out _));

        Assert.Equal("dark", preferences.Theme);
        Assert.Equal("en", preferences.Language);
        Assert.Equal("UTC", preferences.Timezone);
    }

    [Theory]
    [InlineData("en")]
    [InlineData("es")]
    public void Both_shipped_locales_are_accepted(string locale)
    {
        var preferences = Stored();

        Assert.True(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(Language: locale), out _));

        Assert.Equal(locale, preferences.Language);
    }

    [Fact]
    public void Both_is_a_content_language_and_not_a_display_language()
    {
        // ContentLanguages.ValidLanguages includes `both` because a survey can be authored
        // in two languages. A *person* cannot read in two languages at once, so the display
        // preference must not accept it -- see ContentLanguages' own remarks on the split.
        var preferences = Stored();

        Assert.False(
            ProfilePreferenceUpdate.TryApply(
                preferences,
                new UpdateProfilePreferencesRequest(Language: ContentLanguages.Both),
                out var error));

        Assert.Contains("both", error);
        Assert.Equal("en", preferences.Language);
    }

    [Theory]
    [InlineData("light")]
    [InlineData("dark")]
    [InlineData("system")]
    public void Every_theme_the_browser_can_render_is_accepted(string theme)
    {
        var preferences = Stored();

        Assert.True(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(Theme: theme), out _));

        Assert.Equal(theme, preferences.Theme);
    }

    [Fact]
    public void An_unknown_theme_is_rejected_and_nothing_is_written()
    {
        var preferences = Stored();

        Assert.False(
            ProfilePreferenceUpdate.TryApply(
                preferences,
                new UpdateProfilePreferencesRequest(Language: "es", Theme: "solarized"),
                out var error));

        Assert.Contains("solarized", error);
        // The language was valid and came first in the request. It must still be untouched:
        // an all-or-nothing write is the whole point.
        Assert.Equal("en", preferences.Language);
        Assert.Equal("light", preferences.Theme);
    }

    [Fact]
    public void A_real_timezone_is_accepted_and_a_made_up_one_is_not()
    {
        var preferences = Stored();

        Assert.True(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(Timezone: "America/Bogota"), out _));
        Assert.Equal("America/Bogota", preferences.Timezone);

        Assert.False(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(Timezone: "Mars/Olympus_Mons"), out var error));
        Assert.Contains("Mars/Olympus_Mons", error);
        Assert.Equal("America/Bogota", preferences.Timezone);
    }

    [Fact]
    public void Utc_is_always_writable_because_it_is_the_column_default()
    {
        var preferences = Stored();
        preferences.Timezone = "America/Bogota";

        Assert.True(ProfilePreferenceUpdate.TryApply(preferences, new UpdateProfilePreferencesRequest(Timezone: ProfilePreferenceUpdate.UtcTimezone), out _));

        Assert.Equal("UTC", preferences.Timezone);
    }

    [Fact]
    public void A_timezone_longer_than_the_column_is_rejected()
    {
        var preferences = Stored();

        Assert.False(
            ProfilePreferenceUpdate.TryApply(
                preferences,
                new UpdateProfilePreferencesRequest(Timezone: new string('x', ProfilePreferenceUpdate.TimezoneMaxLength + 1)),
                out _));
    }

    /// <summary>
    /// #133 owns dashboard customization and has not decided whether it ships. Reporting the
    /// stored value is fine; minting a vocabulary for it here is not, so there is no way to
    /// write it through this request at all.
    /// </summary>
    [Fact]
    public void DashboardLayout_is_reported_but_has_no_way_in()
    {
        Assert.DoesNotContain(
            typeof(UpdateProfilePreferencesRequest).GetProperties(),
            p => p.Name.Contains("Dashboard", StringComparison.OrdinalIgnoreCase));

        var preferences = Stored();
        preferences.DashboardLayout = "compact";

        Assert.Equal("compact", ProfilePreferenceUpdate.ToResponse(preferences).DashboardLayout);
    }

    /// <summary>
    /// The single-store criterion (#136/#103/#133), asserted structurally: the notification
    /// half of the profile preferences response is the notification API's own record type,
    /// not a look-alike. A second record with the same five fields is exactly how two stores
    /// start.
    /// </summary>
    [Fact]
    public void The_notification_half_is_the_notification_api_record_itself()
    {
        var notifications = typeof(ProfilePreferencesResponse).GetProperty(
            nameof(ProfilePreferencesResponse.Notifications));

        Assert.NotNull(notifications);
        Assert.Equal(typeof(NotificationPreferencesResponse), notifications!.PropertyType);

        var requestHalf = typeof(UpdateProfilePreferencesRequest).GetProperty(
            nameof(UpdateProfilePreferencesRequest.Notifications));

        Assert.NotNull(requestHalf);
        Assert.Equal(typeof(UpdateNotificationPreferencesRequest), requestHalf!.PropertyType);
    }

    /// <summary>
    /// The CLR initializer, the DDL default and this constant must agree, for the same
    /// reason <c>NotificationPreferenceValidation.DefaultDigestFrequency</c> must: a user who
    /// has never touched their settings has to see one value, not three.
    /// </summary>
    [Fact]
    public void The_default_theme_matches_the_domain_initializer()
    {
        Assert.Equal(ProfilePreferenceUpdate.DefaultTheme, new UserPreferences().Theme);
        Assert.Contains(ProfilePreferenceUpdate.DefaultTheme, ProfilePreferenceUpdate.ValidThemes);
    }
}
