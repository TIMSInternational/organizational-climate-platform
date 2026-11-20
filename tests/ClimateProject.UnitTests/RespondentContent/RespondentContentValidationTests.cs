using ClimateProject.Application.Auth;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.RespondentContent;

public class RespondentContentValidationTests
{
    internal static Dictionary<string, Dictionary<string, string?>> Body(params (string Locale, string Key, string? Value)[] values)
    {
        var body = new Dictionary<string, Dictionary<string, string?>>(StringComparer.Ordinal);
        foreach (var (locale, key, value) in values)
        {
            if (!body.TryGetValue(locale, out var byKey))
            {
                body[locale] = byKey = new Dictionary<string, string?>(StringComparer.Ordinal);
            }

            byKey[key] = value;
        }

        return body;
    }

    [Fact]
    public void A_valid_body_becomes_trimmed_writes_and_blank_clears()
    {
        var refusal = RespondentContentValidation.Prepare(
            Body(("es", "next.entryPace", "  {count} preguntas, {minutes} min  "), ("en", "eyebrow", "   "), ("*", "display.textAlign", "start"), ("es", "closedTitle", null)),
            out var writes);

        Assert.Null(refusal);
        Assert.Equal(4, writes.Count);
        string? ValueOf(string locale, string key) => Assert.Single(writes, w => w.Locale == locale && w.Entry.Key == key).Value;
        Assert.Equal("{count} preguntas, {minutes} min", ValueOf("es", "next.entryPace"));
        Assert.Null(ValueOf("en", "eyebrow"));
        Assert.Equal("start", ValueOf("*", "display.textAlign"));
        Assert.Null(ValueOf("es", "closedTitle"));
    }

    [Fact]
    public void An_override_may_leave_a_placeholder_out()
        => Assert.Null(RespondentContentValidation.Prepare(Body(("es", "next.entryPace", "Pocas preguntas.")), out _));

    [Theory]
    [InlineData("fr", "eyebrow", "Enquête", RespondentContentRefusalReason.UnknownLocale)]
    [InlineData("es", "notAKey", "x", RespondentContentRefusalReason.UnknownKey)]
    [InlineData("es", "identifiedBody", "x", RespondentContentRefusalReason.UnknownKey)]
    [InlineData("*", "eyebrow", "x", RespondentContentRefusalReason.LocaleMismatch)]
    [InlineData("es", "display.textAlign", "start", RespondentContentRefusalReason.LocaleMismatch)]
    [InlineData("*", "display.textAlign", "center", RespondentContentRefusalReason.ValueNotAllowed)]
    [InlineData("es", "next.closesOn", "Cierra el {fecha}.", RespondentContentRefusalReason.UnknownPlaceholder)]
    [InlineData("es", "closedTitle", "Cerrada {date}", RespondentContentRefusalReason.UnknownPlaceholder)]
    [InlineData("en", "email.reminder.subject", "Reminder for {name}", RespondentContentRefusalReason.UnknownPlaceholder)]
    public void Each_problem_is_refused_with_its_reason_naming_where(string locale, string key, string value, RespondentContentRefusalReason reason)
    {
        var refusal = RespondentContentValidation.Prepare(Body(("es", "eyebrow", "Primero válido"), (locale, key, value)), out var writes);

        Assert.NotNull(refusal);
        Assert.Equal(reason, refusal.Reason);
        Assert.Equal(locale, refusal.Locale);
        if (reason != RespondentContentRefusalReason.UnknownLocale)
        {
            Assert.Equal(key, refusal.Key);
        }

        // Nothing comes back to apply, not even the valid entry before it.
        Assert.Empty(writes);
    }

    [Fact]
    public void An_unknown_placeholder_is_named()
    {
        var refusal = RespondentContentValidation.Prepare(Body(("es", "next.entryPace", "{count} preguntas en {horas} horas")), out _);

        Assert.Equal(RespondentContentRefusalReason.UnknownPlaceholder, refusal!.Reason);
        Assert.Equal("horas", refusal.Placeholder);
        Assert.Equal(["count", "minutes"], refusal.Allowed);
    }

    [Fact]
    public void The_maximum_is_inclusive_and_counted_after_trimming()
    {
        Assert.True(RespondentContentRegistry.TryGet("eyebrow", out var entry));
        var atLimit = new string('a', entry.MaxLength);

        Assert.Null(RespondentContentValidation.Prepare(Body(("es", "eyebrow", "  " + atLimit + "  ")), out _));

        var refusal = RespondentContentValidation.Prepare(Body(("es", "eyebrow", atLimit + "b")), out _);
        Assert.Equal(RespondentContentRefusalReason.TooLong, refusal!.Reason);
        Assert.Equal(entry.MaxLength, refusal.MaxLength);
    }

    [Fact]
    public void An_empty_or_missing_body_is_nothing_to_write()
    {
        Assert.Null(RespondentContentValidation.Prepare(null, out var none));
        Assert.Empty(none);
        Assert.Null(RespondentContentValidation.Prepare(new Dictionary<string, Dictionary<string, string?>> { ["es"] = null! }, out var empty));
        Assert.Empty(empty);
    }
}

/// <summary>The status half of who may write (the 403 is <c>CanAdminister</c>'s).</summary>
public class RespondentContentPermissionsTests
{
    [Theory]
    [InlineData(Roles.CompanyAdmin, SurveyStatuses.Draft, RespondentContentSurveyLock.None)]
    [InlineData(Roles.CompanyAdmin, SurveyStatuses.Scheduled, RespondentContentSurveyLock.None)]
    [InlineData(Roles.CompanyAdmin, SurveyStatuses.Active, RespondentContentSurveyLock.None)]
    [InlineData(Roles.CompanyAdmin, SurveyStatuses.Closed, RespondentContentSurveyLock.Locked)]
    [InlineData(Roles.CompanyAdmin, SurveyStatuses.Archived, RespondentContentSurveyLock.Archived)]
    [InlineData(Roles.SuperAdmin, SurveyStatuses.Draft, RespondentContentSurveyLock.None)]
    [InlineData(Roles.SuperAdmin, SurveyStatuses.Active, RespondentContentSurveyLock.None)]
    [InlineData(Roles.SuperAdmin, SurveyStatuses.Closed, RespondentContentSurveyLock.None)]
    [InlineData(Roles.SuperAdmin, SurveyStatuses.Archived, RespondentContentSurveyLock.Archived)]
    public void A_super_admin_writes_in_any_status_but_archived_a_company_admin_only_while_live(string role, string status, RespondentContentSurveyLock expected)
        => Assert.Equal(expected, RespondentContentPermissions.SurveyLock(role, status));

    [Fact]
    public void A_company_level_is_written_by_a_super_admin_or_that_companys_admin()
    {
        var company = Guid.NewGuid();
        Assert.True(RespondentContentPermissions.CanEditCompany(Roles.SuperAdmin, null, company));
        Assert.True(RespondentContentPermissions.CanEditCompany(Roles.CompanyAdmin, company.ToString(), company));
        Assert.False(RespondentContentPermissions.CanEditCompany(Roles.CompanyAdmin, Guid.NewGuid().ToString(), company));
        Assert.False(RespondentContentPermissions.CanEditCompany(Roles.CompanyAdmin, null, company));
        Assert.False(RespondentContentPermissions.CanEditCompany(Roles.Leader, company.ToString(), company));
        Assert.False(RespondentContentPermissions.CanEditCompany(Roles.Employee, company.ToString(), company));
    }

    [Theory]
    [InlineData("es", new[] { "es" })]
    [InlineData("en", new[] { "en" })]
    [InlineData("both", new[] { "es", "en" })]
    [InlineData(null, new[] { "es", "en" })]
    public void The_required_locales_follow_the_language(string? language, string[] expected)
        => Assert.Equal(expected, RespondentContentPermissions.RequiredLocales(language));

    /// <summary>
    /// A survey-level text may be SET only in a language the survey offers; clearing one is
    /// allowed anywhere, and a display choice is not a language at all.
    /// </summary>
    [Fact]
    public void A_text_is_set_only_in_a_language_the_survey_offers_and_cleared_in_any()
    {
        string[] spanishOnly = ["es"];
        Assert.Null(RespondentContentValidation.Prepare(
            RespondentContentValidationTests.Body(("es", "anonymousBody", "Párrafo"), ("en", "eyebrow", ""), ("*", "display.textAlign", "start")), out var allowed));
        Assert.Null(RespondentContentValidation.RefuseLocalesNotOffered(allowed, spanishOnly));

        Assert.Null(RespondentContentValidation.Prepare(RespondentContentValidationTests.Body(("es", "eyebrow", "Clima"), ("en", "thankYouTitle", "Thanks")), out var refusedWrites));
        var refusal = RespondentContentValidation.RefuseLocalesNotOffered(refusedWrites, spanishOnly);
        Assert.NotNull(refusal);
        Assert.Equal(RespondentContentRefusalReason.LocaleNotOffered, refusal.Reason);
        Assert.Equal("en", refusal.Locale);
        Assert.Equal("thankYouTitle", refusal.Key);
        Assert.Equal(spanishOnly, refusal.Allowed);

        Assert.Null(RespondentContentValidation.RefuseLocalesNotOffered(refusedWrites, ["es", "en"]));
    }

    /// <summary>
    /// The four keys whose survey level is a publish-gate column are marked, and only they: the
    /// editor has to say that one of them set in one language must be set in all of the survey's.
    /// </summary>
    [Fact]
    public void Exactly_the_legacy_keys_require_every_locale()
    {
        var marked = RespondentContentEntryDto.All.Where(e => e.RequiresEveryLocale).Select(e => e.Key).Order(StringComparer.Ordinal);
        Assert.Equal(
            ["anonymousBody", "email.personalLink.message", "email.personalLink.subject", "thankYouTitle"],
            marked);
    }
}
