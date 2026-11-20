using ClimateProject.Application.RespondentContent;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.RespondentContent;

/// <summary>
/// The chain, without a database: survey row → survey legacy column → company row → absent
/// (the product default), per locale, display keys from <c>*</c>.
/// </summary>
public class RespondentContentResolverTests
{
    private static RespondentContentValue V(string key, string locale, string value) => new(key, locale, value);

    [Fact]
    public void The_survey_beats_the_company_and_the_company_beats_nothing()
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("demographics.intro", "es", "De la empresa"), V("identity.intro", "es", "Empresa: quién")],
            SurveyValues: [V("demographics.intro", "es", "De la encuesta")],
            SurveySettings: new SurveySettings());

        var content = RespondentContentResolver.Resolve(sources, "es");

        Assert.Equal("De la encuesta", content["demographics.intro"]);
        Assert.Equal("Empresa: quién", content["identity.intro"]);
        // Overrides only: nothing set means the key is absent, and the screen uses its catalogue.
        Assert.False(content.ContainsKey("closedTitle"));
    }

    /// <summary>A Spanish override is never shown to an English reader, at any level.</summary>
    [Fact]
    public void A_reader_gets_only_their_own_locales_words()
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("demographics.intro", "es", "De la empresa")],
            SurveyValues: [V("identity.intro", "es", "De la encuesta")],
            SurveySettings: new SurveySettings { RespondentIntroEs = "Párrafo propio", ClosingMessageEn = "Thanks, team" });

        var english = RespondentContentResolver.Resolve(sources, "en");

        Assert.Equal(["thankYouTitle"], english.Keys.Order(StringComparer.Ordinal));
        Assert.Equal("Thanks, team", english["thankYouTitle"]);
        Assert.DoesNotContain(english.Values, v => v.Contains("empresa", StringComparison.OrdinalIgnoreCase) || v.Contains("Párrafo", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("fr")]
    [InlineData("*")]
    public void A_locale_that_is_not_a_text_locale_gets_display_keys_only(string? locale)
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("demographics.intro", "es", "De la empresa"), V("display.textAlign", "*", "start")],
            SurveyValues: [],
            SurveySettings: new SurveySettings { RespondentIntroEs = "Párrafo" });

        var content = RespondentContentResolver.Resolve(sources, locale);

        Assert.Equal(["display.textAlign"], content.Keys);
    }

    /// <summary>
    /// The four keys that had survey columns read them between the survey's table row and the
    /// company's row: a survey column beats the company, and a company row shows through a blank one.
    /// </summary>
    [Fact]
    public void A_legacy_column_sits_between_the_survey_row_and_the_company_row()
    {
        var company = new[]
        {
            V("anonymousBody", "es", "Empresa: anónima"),
            V("thankYouTitle", "es", "Empresa: gracias"),
            V("email.personalLink.subject", "es", "Empresa: asunto"),
        };
        var settings = new SurveySettings
        {
            RespondentIntroEs = "Encuesta: anónima",
            ClosingMessageEs = "   ",
            InvitationCustomSubjectEs = null,
        };

        var content = RespondentContentResolver.Resolve(new RespondentContentSources(company, [], settings), "es");

        Assert.Equal("Encuesta: anónima", content["anonymousBody"]);
        Assert.Equal("Empresa: gracias", content["thankYouTitle"]);
        Assert.Equal("Empresa: asunto", content["email.personalLink.subject"]);

        var withRow = RespondentContentResolver.Resolve(
            new RespondentContentSources(company, [V("anonymousBody", "es", "Encuesta: fila")], settings), "es");
        Assert.Equal("Encuesta: fila", withRow["anonymousBody"]);
    }

    [Fact]
    public void Display_keys_come_from_star_survey_first_whatever_the_locale()
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("display.textAlign", "*", "start")],
            SurveyValues: [V("display.textAlign", "*", "justify")],
            SurveySettings: null);

        Assert.Equal("justify", RespondentContentResolver.Resolve(sources, "es")["display.textAlign"]);
        Assert.Equal("justify", RespondentContentResolver.Resolve(sources, "en")["display.textAlign"]);
        Assert.Equal(
            "start",
            RespondentContentResolver.Resolve(sources with { SurveyValues = [] }, "en")["display.textAlign"]);
    }

    /// <summary>What the registry would not read is skipped as if absent, so the next level shows.</summary>
    [Fact]
    public void Unknown_keys_wrong_locales_bad_display_values_and_blanks_are_skipped()
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("closedTitle", "es", "Cerrada (empresa)"), V("display.textAlign", "*", "start")],
            SurveyValues:
            [
                V("closedTitle", "es", "  "),
                V("display.textAlign", "*", "center"),
                V("display.textAlign", "es", "justify"),
                V("closedTitle", "*", "Nunca"),
                V("identifiedBody", "es", "Oculta que se guardan nombres"),
            ],
            SurveySettings: null);

        var content = RespondentContentResolver.Resolve(sources, "es");

        Assert.Equal("Cerrada (empresa)", content["closedTitle"]);
        Assert.Equal("start", content["display.textAlign"]);
        Assert.False(content.ContainsKey("identifiedBody"));
    }

    [Fact]
    public void A_respondent_payload_carries_screens_and_display_never_emails()
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("email.reminder.subject", "es", "Recordatorio"), V("eyebrow", "es", "Encuesta de clima"), V("display.textAlign", "*", "start")],
            SurveyValues: [],
            SurveySettings: new SurveySettings { InvitationCustomMessageEs = "Mensaje" });

        var content = RespondentContentResolver.Resolve(sources, "es", RespondentContentKinds.RespondentPayload);

        Assert.Equal(["display.textAlign", "eyebrow"], content.Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void By_locale_every_locale_is_present_texts_under_their_locale_display_under_star()
    {
        var sources = new RespondentContentSources(
            CompanyValues: [V("eyebrow", "en", "Climate survey"), V("display.textAlign", "*", "start")],
            SurveyValues: [V("eyebrow", "es", "Encuesta de clima")],
            SurveySettings: new SurveySettings());

        var byLocale = RespondentContentResolver.ResolveByLocale(sources);

        Assert.Equal(["*", "en", "es"], byLocale.Keys.Order(StringComparer.Ordinal));
        Assert.Equal("Encuesta de clima", byLocale["es"]["eyebrow"]);
        Assert.Equal("Climate survey", byLocale["en"]["eyebrow"]);
        Assert.False(byLocale["es"].ContainsKey("display.textAlign"));
        Assert.Equal("start", byLocale["*"]["display.textAlign"]);
        Assert.Single(byLocale["*"]);
    }

    [Fact]
    public void Grouping_stored_values_keeps_every_locale_and_drops_what_the_registry_would_not_read()
    {
        var grouped = RespondentContentResolver.GroupByLocale(
        [
            V("eyebrow", "es", "Encuesta"),
            V("nope", "es", "x"),
            V("display.textAlign", "*", "start"),
            V("eyebrow", "*", "x"),
        ]);

        Assert.Equal(["*", "en", "es"], grouped.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(["eyebrow"], grouped["es"].Keys);
        Assert.Empty(grouped["en"]);
        Assert.Equal(["display.textAlign"], grouped["*"].Keys);
    }
}
