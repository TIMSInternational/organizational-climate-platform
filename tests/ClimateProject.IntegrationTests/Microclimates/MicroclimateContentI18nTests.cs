using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

// #195 end to end: authoring in two languages, the publish gate, locale-resolved reads,
// and the one property the whole options redesign exists for -- the same answer given
// in Spanish and in English is ONE stored value.
[Collection("Postgres")]
public class MicroclimateContentI18nTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"i18n-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateContentI18nTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "I18n Co",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        // The company language is the default every survey inherits, which is why
        // 'both' is an opt-in rather than something every survey has to opt out of.
        company.Settings.Language = "es";
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> AdminTokenAsync(HttpClient client)
    {
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private static LocalizedInput Both(string en, string es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = en, ["es"] = es });

    private async Task<HttpClient> AuthenticatedClientAsync()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await AdminTokenAsync(client));
        return client;
    }

    private static CreateMicroclimateRequest BilingualRequest(
        Guid companyId,
        LocalizedInput title,
        List<CreateQuestionInput>? questions = null)
        => new(
            Title: title,
            Description: null,
            CompanyId: companyId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(2),
            TargetParticipantCount: 5,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: questions,
            Timezone: null,
            Language: ContentLanguages.Both);

    [Fact]
    public async Task Language_defaults_to_the_companys_own_so_a_bare_string_is_attributed_not_guessed()
    {
        var client = await AuthenticatedClientAsync();

        var response = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: "Pulso semanal",
            Description: null,
            CompanyId: _companyId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(2),
            TargetParticipantCount: 5,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<MicroclimateDetail>();

        Assert.Equal("es", created!.Language);
        Assert.Equal("Pulso semanal", created.Title);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var stored = await db.Microclimates.SingleAsync(m => m.Id == created.Id);

        // Filed under Spanish because the company is Spanish -- not dropped into the
        // English column, which is the count-reconciling, content-mangled failure the
        // ETL rules on #154 exist to avoid.
        Assert.Equal("Pulso semanal", stored.TitleEs);
        Assert.Null(stored.TitleEn);
    }

    [Fact]
    public async Task A_bare_string_is_rejected_when_the_microclimate_is_authored_in_both_languages()
    {
        var client = await AuthenticatedClientAsync();

        var response = await client.PostAsJsonAsync("/microclimates", BilingualRequest(_companyId, "Weekly pulse"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("both languages", body);
    }

    [Fact]
    public async Task Reads_resolve_to_the_requested_locale_and_report_a_fallback()
    {
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [new CreateQuestionInput(Both("How are you?", "¿Cómo estás?"), "open_ended", null, true, 0)])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        var spanish = await (await client.GetAsync($"/microclimates/{created!.Id}?lang=es")).Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("Pulso semanal", spanish!.Title);
        Assert.Equal("¿Cómo estás?", spanish.Questions.Single().Text);
        Assert.Equal("es", spanish.ResolvedLocale);
        Assert.Empty(spanish.FallbackFields);

        var english = await (await client.GetAsync($"/microclimates/{created.Id}?lang=en")).Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("Weekly pulse", english!.Title);
        Assert.Equal("How are you?", english.Questions.Single().Text);

        // Now knock out one half and confirm the fallback SELF-REPORTS rather than
        // quietly substituting the other language.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var question = await db.MicroclimateQuestions.FirstAsync(q => q.MicroclimateId == created.Id);
            question.TextEs = null;
            await db.SaveChangesAsync();
        }

        var degraded = await (await client.GetAsync($"/microclimates/{created.Id}?lang=es")).Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("How are you?", degraded!.Questions.Single().Text);
        Assert.Contains("questions[0].text", degraded.FallbackFields);
    }

    [Fact]
    public async Task Publishing_a_both_microclimate_is_blocked_until_every_translation_exists()
    {
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [new CreateQuestionInput(LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "How are you?" }), "open_ended", null, true, 0)])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        var blocked = await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.BadRequest, blocked.StatusCode);

        var body = await blocked.Content.ReadAsStringAsync();
        // Explicit about which field in which language -- #108's AC requires validation
        // to "be honest about what publishing does".
        Assert.Contains("questions[0].text", body);
        Assert.Contains("es", body);

        // Saving a half-translated question must still work: autosave runs every 5-10s
        // and side-by-side editing means half-translated is the normal draft state.
        var save = await client.PutAsJsonAsync($"/microclimates/{created.Id}",
            new UpdateMicroclimateRequest(Both("Weekly pulse", "Pulso semanal"), null, null, null));
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var question = await db.MicroclimateQuestions.FirstAsync(q => q.MicroclimateId == created.Id);
            question.TextEs = "¿Cómo estás?";
            await db.SaveChangesAsync();
        }

        var published = await client.PutAsJsonAsync($"/microclimates/{created.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
    }

    [Fact]
    public async Task A_single_language_microclimate_publishes_without_a_second_translation()
    {
        // The gate stays out of the way of the common case. If it did not, 'both' being
        // the default would make every single-language survey unpublishable.
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: "Pulso semanal",
            Description: null,
            CompanyId: _companyId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(2),
            TargetParticipantCount: 5,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: [new CreateQuestionInput("¿Cómo estás?", "open_ended", null, true, 0)])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        var published = await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.OK, published.StatusCode);
    }

    [Fact]
    public async Task The_same_answer_from_an_es_session_and_an_en_session_stores_one_identical_value()
    {
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [
                new CreateQuestionInput(
                    Both("How satisfied are you?", "¿Qué tan satisfecho estás?"),
                    "multiple_choice",
                    [
                        new CreateQuestionOptionInput("strongly_agree", Both("Strongly agree", "Muy de acuerdo")),
                        new CreateQuestionOptionInput("disagree", Both("Disagree", "En desacuerdo")),
                    ],
                    true,
                    0),
            ])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var englishView = await (await client.GetAsync($"/microclimates/{created.Id}?lang=en")).Content.ReadFromJsonAsync<MicroclimateDetail>();
        var spanishView = await (await client.GetAsync($"/microclimates/{created.Id}?lang=es")).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var englishOption = englishView!.Questions.Single().Options!.First();
        var spanishOption = spanishView!.Questions.Single().Options!.First();

        // Different labels...
        Assert.Equal("Strongly agree", englishOption.Label);
        Assert.Equal("Muy de acuerdo", spanishOption.Label);
        // ...one value. Before the options child table, these two respondents stored
        // two unrelated strings and every distribution, chart, benchmark and export
        // split in half with no error and with row counts that reconciled exactly.
        Assert.Equal(englishOption.Value, spanishOption.Value);
        Assert.Equal("strongly_agree", englishOption.Value);

        var questionId = englishView.Questions.Single().Id;
        var anonymous = _factory.CreateClient();

        var fromSpanish = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = spanishOption.Value }, "es"));
        Assert.Equal(HttpStatusCode.Created, fromSpanish.StatusCode);

        var fromEnglish = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = englishOption.Value }, "en"));
        Assert.Equal(HttpStatusCode.Created, fromEnglish.StatusCode);

        // And submitting the LABEL is refused, so a client that renders the label and
        // posts it back cannot silently reintroduce the split.
        var byLabel = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "Muy de acuerdo" }, "es"));
        Assert.Equal(HttpStatusCode.BadRequest, byLabel.StatusCode);
    }

    [Fact]
    public async Task Open_text_words_are_counted_per_respondent_language()
    {
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [new CreateQuestionInput(Both("How are you?", "¿Cómo estás?"), "open_ended", null, true, 0)])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var questionId = created.Questions.Single().Id;

        var anonymous = _factory.CreateClient();
        await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "trabajo" }, "es"));
        await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "work" }, "en"));

        var results = await (await client.GetAsync($"/microclimates/{created.Id}/live-results")).Content.ReadFromJsonAsync<LiveResultsDetail>();

        var spanishWord = Assert.Single(results!.WordCloud, w => w.Text == "trabajo");
        var englishWord = Assert.Single(results.WordCloud, w => w.Text == "work");
        Assert.Equal("es", spanishWord.Language);
        Assert.Equal("en", englishWord.Language);
    }

    [Fact]
    public async Task An_unrecognised_respondent_language_is_rejected_rather_than_bucketed_as_english()
    {
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [new CreateQuestionInput(Both("How are you?", "¿Cómo estás?"), "open_ended", null, true, 0)])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var anonymous = _factory.CreateClient();
        var response = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string>
            {
                [created.Questions.Single().Id] = "bem",
            }, "pt"));

        // A mislabelled bucket is worse than a rejected submission: it is invisible
        // afterwards.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_option_with_duplicate_values_is_a_400_naming_the_question()
    {
        var client = await AuthenticatedClientAsync();

        var response = await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [
                new CreateQuestionInput(
                    Both("Pick one", "Elige uno"),
                    "multiple_choice",
                    [
                        new CreateQuestionOptionInput("agree", Both("Agree", "De acuerdo")),
                        new CreateQuestionOptionInput("agree", Both("Also agree", "También de acuerdo")),
                    ],
                    true,
                    0),
            ]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("duplicate option value", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_option_value_is_derived_from_its_label_when_the_caller_does_not_supply_one()
    {
        // Single-language authors never see a value. Deriving it from the label is the
        // same rule the migration applies to existing text[] options, which is what
        // keeps already-stored response_value rows matching.
        var client = await AuthenticatedClientAsync();

        var created = await (await client.PostAsJsonAsync("/microclimates", BilingualRequest(
            _companyId,
            Both("Weekly pulse", "Pulso semanal"),
            [
                new CreateQuestionInput(
                    Both("Pick one", "Elige uno"),
                    "multiple_choice",
                    [
                        new CreateQuestionOptionInput(null, Both("Agree", "De acuerdo")),
                        new CreateQuestionOptionInput(null, Both("Disagree", "En desacuerdo")),
                    ],
                    true,
                    0),
            ])))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        var options = created!.Questions.Single().Options!;
        Assert.Equal(["Agree", "Disagree"], options.Select(o => o.Value));
    }
}
