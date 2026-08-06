using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// #195 proven end to end on its first real consumer: authoring in two languages, the
/// publish gate, locale-resolved reads that self-report their fallbacks, and the
/// non-negotiable constraint that no read DTO is En/Es-shaped.
/// </summary>
[Collection("Postgres")]
public class SurveyContentI18nTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _spanishCompanyId;

    public SurveyContentI18nTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"si18n-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        // The company language is the default every survey inherits, which is what makes
        // 'both' an opt-in rather than something every survey opts out of.
        _spanishCompanyId = await _harness.SeedCompanyAsync("Empresa ES", language: ContentLanguages.Spanish);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _spanishCompanyId);

    // ------------------------------------------------------------------
    // The load-bearing constraint
    // ------------------------------------------------------------------

    [Fact]
    public async Task No_read_payload_carries_an_En_or_Es_shaped_property()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("How satisfied are you?", "Que tan satisfecho estas?"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("agree", SurveyTestHarness.Both("Agree", "De acuerdo")),
                        new CreateSurveyQuestionOptionInput("disagree", SurveyTestHarness.Both("Disagree", "En desacuerdo")),
                    ],
                    ScaleLabelMin: SurveyTestHarness.Both("Poor", "Malo"),
                    ScaleLabelMax: SurveyTestHarness.Both("Excellent", "Excelente"),
                    CommentPrompt: SurveyTestHarness.Both("Explain:", "Explica:"),
                    Order: 0),
            ]));

        // Published so /surveys/my actually carries a row -- an empty array would pass the
        // recursive check without ever inspecting a survey.
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        foreach (var url in new[] { $"/surveys/{created.Id}", "/surveys", "/surveys/my" })
        {
            using var document = JsonDocument.Parse(await client.GetStringAsync(url));
            AssertNoLocaleSuffixedProperties(document.RootElement, url);
        }
    }

    // A third language must be a migration plus a column pair, not a rewrite of every page
    // that renders a survey. That property survives only while nothing on the read side is
    // named after a locale.
    private static void AssertNoLocaleSuffixedProperties(JsonElement element, string path)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    Assert.False(
                        property.Name.EndsWith("En", StringComparison.Ordinal)
                        || property.Name.EndsWith("Es", StringComparison.Ordinal)
                        || property.Name.EndsWith("_en", StringComparison.Ordinal)
                        || property.Name.EndsWith("_es", StringComparison.Ordinal),
                        $"{path}: read payload exposes locale-shaped property '{property.Name}'");
                    AssertNoLocaleSuffixedProperties(property.Value, $"{path}.{property.Name}");
                }

                break;

            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    AssertNoLocaleSuffixedProperties(item, path);
                }

                break;
        }
    }

    // ------------------------------------------------------------------
    // Authoring
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_bare_string_is_attributed_to_the_companys_own_language()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_spanishCompanyId, title: LocalizedInput.FromBare("Pulso semanal")));

        Assert.Equal(ContentLanguages.Spanish, created.Language);

        var stored = await _harness.WithDbAsync(db => db.Surveys.FirstAsync(s => s.Id == created.Id));
        Assert.Equal("Pulso semanal", stored.TitleEs);
        Assert.Null(stored.TitleEn);
    }

    [Fact]
    public async Task A_bare_string_is_rejected_for_a_survey_authored_in_both_languages()
    {
        var client = await AdminAsync();

        var response = await client.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: LocalizedInput.FromBare("Which column does this belong in?"),
            language: ContentLanguages.Both));

        // Guessing would file English text in the Spanish column: count-reconciling,
        // content-mangled, and invisible afterwards.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("both languages", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unsupported_locale_key_is_named_in_the_error()
    {
        var client = await AdminAsync();
        var title = LocalizedInput.FromLocales(new Dictionary<string, string?> { ["pt"] = "Pulso da equipe" });

        var response = await client.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(_spanishCompanyId, title: title));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("pt", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_invalid_content_language_is_rejected()
    {
        var client = await AdminAsync();

        var response = await client.PostAsJsonAsync(
            "/surveys", SurveyTestHarness.MinimalRequest(_spanishCompanyId, language: "fr"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_question_omitting_its_comment_prompt_keeps_the_per_language_database_default()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_spanishCompanyId));

        var question = await _harness.WithDbAsync(db => db.Questions.FirstAsync(q => q.SurveyId == created.Id));

        // The single shared column this replaced carried an English string as its DDL
        // default, so a Spanish-only survey got an English prompt out of the schema itself.
        Assert.Equal("Please explain your answer:", question.CommentPromptEn);
        Assert.Equal("Por favor explica tu respuesta:", question.CommentPromptEs);
        Assert.Equal("Por favor explica tu respuesta:", Assert.Single(created.Questions).CommentPrompt);
    }

    // ------------------------------------------------------------------
    // The publish gate
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_half_translated_both_language_survey_can_be_saved_but_not_published()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "How are you feeling?" }),
                    "open_ended",
                    Order: 0),
            ]));

        // Saving a half-translated draft has to work: side-by-side editing presupposes it.
        Assert.Equal(SurveyStatuses.Draft, created.Status);

        var publish = await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.BadRequest, publish.StatusCode);
        var body = await publish.Content.ReadAsStringAsync();
        Assert.Contains("questions[0].text", body, StringComparison.Ordinal);
        Assert.Contains("\"locale\":\"es\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unlabelled_option_blocks_publication_because_it_is_unanswerable()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("Pick one", "Elige una"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("agree", SurveyTestHarness.Both("Agree", "De acuerdo")),
                        new CreateSurveyQuestionOptionInput("disagree", LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Disagree" })),
                    ],
                    Order: 0),
            ]));

        var publish = await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.BadRequest, publish.StatusCode);
        Assert.Contains("options[1].label", await publish.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_fully_translated_both_language_survey_publishes()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    SurveyTestHarness.Both("How are you feeling?", "Como te sientes?"),
                    "open_ended",
                    Order: 0),
            ]));

        var publish = await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);
    }

    [Fact]
    public async Task A_single_language_survey_publishes_without_any_translation_at_all()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: LocalizedInput.FromBare("Pulso semanal"),
            questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("Como te sientes?"), "open_ended", Order: 0)]));

        var publish = await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active);

        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);
    }

    [Fact]
    public async Task Archiving_an_untranslated_draft_is_not_blocked_by_the_publish_gate()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Abandoned", "Abandonada"),
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Never finished" }),
                    "open_ended",
                    Order: 0),
            ]));

        // Filing away an abandoned draft publishes nothing. A gate that demanded a full
        // set of translations in order to throw something away would block cleanup rather
        // than protect respondents.
        var archive = await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Archived);

        Assert.Equal(HttpStatusCode.OK, archive.StatusCode);
    }

    [Fact]
    public async Task An_invitation_string_authored_in_only_one_language_blocks_publication_of_a_both_survey()
    {
        var client = await AdminAsync();
        var request = SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both,
            questions: [new CreateSurveyQuestionInput(SurveyTestHarness.Both("How are you?", "Como estas?"), "open_ended", Order: 0)])
            with
        {
            Settings = new SurveySettingsInput(
                InvitationCustomSubject: LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Your voice matters" })),
        };
        var created = await SurveyTestHarness.CreateSurveyAsync(client, request);

        var publish = await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active);

        // These two settings are emailed to respondents, so a missing half mails part of
        // the audience in the wrong language.
        Assert.Equal(HttpStatusCode.BadRequest, publish.StatusCode);
        Assert.Contains("settings.invitationCustomSubject", await publish.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Locale-resolved reads
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_read_serves_the_requested_locale_and_says_which_one_it_served()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both,
            questions: [new CreateSurveyQuestionInput(SurveyTestHarness.Both("How are you?", "Como estas?"), "open_ended", Order: 0)]));

        var english = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}?lang=en");
        Assert.Equal("Team pulse", english!.Title);
        Assert.Equal("en", english.ResolvedLocale);
        Assert.Empty(english.FallbackFields);

        var spanish = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}?lang=es-CO");
        Assert.Equal("Pulso de equipo", spanish!.Title);
        Assert.Equal("es", spanish.ResolvedLocale);
        Assert.Empty(spanish.FallbackFields);
        Assert.Equal("Como estas?", Assert.Single(spanish.Questions).Text);
    }

    [Fact]
    public async Task A_spanish_only_survey_read_without_a_locale_renders_in_spanish_not_english()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_spanishCompanyId, title: LocalizedInput.FromBare("Pulso semanal")));

        var fetched = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}");

        Assert.Equal("Pulso semanal", fetched!.Title);
        Assert.Equal(ContentLanguages.Spanish, fetched.ResolvedLocale);
    }

    [Fact]
    public async Task Every_fallback_self_reports_rather_than_silently_substituting()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_spanishCompanyId, title: LocalizedInput.FromBare("Pulso semanal")));

        var fetched = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}?lang=en");

        // The English reader gets the Spanish text -- and is told so, which is what makes
        // "no untranslated strings" checkable rather than hoped for.
        Assert.Equal("Pulso semanal", fetched!.Title);
        Assert.Equal(ContentLanguages.Spanish, fetched.ResolvedLocale);
        Assert.Contains("title", fetched.FallbackFields);
    }

    [Fact]
    public async Task The_listing_resolves_titles_for_the_requested_locale_too()
    {
        var client = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _spanishCompanyId,
            title: SurveyTestHarness.Both("Team pulse", "Pulso de equipo"),
            language: ContentLanguages.Both));

        var english = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?lang=en");
        var spanish = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?lang=es");

        Assert.Equal("Team pulse", english!.Surveys.Single(s => s.Id == created.Id).Title);
        Assert.Equal("Pulso de equipo", spanish!.Surveys.Single(s => s.Id == created.Id).Title);
    }
}
