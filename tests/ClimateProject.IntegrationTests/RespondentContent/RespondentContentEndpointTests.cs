using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Reports;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.RespondentContent;

/// <summary>
/// What a client reads, edited rather than coded (ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>), end to end: the two routes, the chain as
/// the respondent payloads carry it, who may write, and that a refused body writes nothing.
/// </summary>
[Collection("Postgres")]
public class RespondentContentEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyA;
    private Guid _companyB;

    public RespondentContentEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"content-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyA = await _harness.SeedCompanyAsync("Textos A", language: "es");
        _companyB = await _harness.SeedCompanyAsync("Textos B", language: "es");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Task<HttpClient> AdminAsync(Guid companyId) => _harness.ClientAsync(Roles.CompanyAdmin, companyId);

    /// <summary>A TIMS operator: a super admin with no company of their own.</summary>
    private Task<HttpClient> OperatorAsync() => _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

    private static UpdateRespondentContentRequest Body(params (string Locale, string Key, string? Value)[] values)
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

        return new UpdateRespondentContentRequest(body);
    }

    private static string CompanyRoute(Guid companyId) => $"/admin/companies/{companyId}/respondent-content";

    private static string SurveyRoute(Guid surveyId) => $"/surveys/{surveyId}/respondent-content";

    private static async Task<RespondentContentView> OkViewAsync(HttpResponseMessage response)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"Expected 200, got {(int)response.StatusCode}: {raw}");
        return JsonSerializer.Deserialize<RespondentContentView>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    private static async Task<JsonElement> RefusalAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"Expected {(int)status}, got {(int)response.StatusCode}: {raw}");
        var body = JsonDocument.Parse(raw).RootElement.Clone();
        Assert.Equal(code, body.GetProperty("code").GetString());
        return body;
    }

    /// <summary>An active survey a visitor with no account answers through its link.</summary>
    private async Task<SurveyDetail> LinkSurveyAsync(HttpClient admin, Guid companyId, string language = "es")
    {
        var both = language == ContentLanguages.Both;
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: both ? SurveyTestHarness.Both("Climate", "Clima") : LocalizedInput.FromBare("Clima"),
            CompanyId: companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(
                    both ? SurveyTestHarness.Both("I trust my lead", "Confío en mi jefatura") : LocalizedInput.FromBare("Confío en mi jefatura"),
                    "likert",
                    ScaleMin: 1,
                    ScaleMax: 5,
                    Required: true,
                    Order: 0),
            ],
            Language: language,
            Settings: new SurveySettingsInput(Anonymous: true, SelfDeclaredDemographics: false)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await SurveyTestHarness.OpenPublicLinkAsync(admin, survey.Id);
        return survey;
    }

    private async Task<SurveyRespondView> RespondViewAsync(Guid surveyId, string lang)
    {
        var http = await _factory.CreateClient().GetAsync($"/surveys/{surveyId}/respond?lang={lang}");
        var raw = await http.Content.ReadAsStringAsync();
        Assert.True(http.IsSuccessStatusCode, raw);
        return JsonSerializer.Deserialize<SurveyRespondView>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    private Task<List<RespondentContentOverride>> RowsAsync(Guid companyId)
        => _harness.WithDbAsync(db => db.RespondentContentOverrides.AsNoTracking().Where(o => o.CompanyId == companyId).ToListAsync());

    private Task<SurveySettings> SettingsAsync(Guid surveyId)
        => _harness.WithDbAsync(async db => (await db.Surveys.AsNoTracking().FirstAsync(s => s.Id == surveyId)).Settings);

    // ------------------------------------------------------------------
    // The chain, as the respondent payloads carry it
    // ------------------------------------------------------------------

    /// <summary>
    /// survey → company → default, per locale, on the respond view an anonymous link visitor gets:
    /// the survey's words beat the company's, the company's show where the survey says nothing, a
    /// key nobody set is absent, and an English reader gets none of the Spanish words.
    /// </summary>
    [Fact]
    public async Task The_respond_view_carries_the_effective_overrides_survey_first_per_locale()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA, ContentLanguages.Both);

        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(
            ("es", "demographics.intro", "Empresa: sobre usted"),
            ("es", "identity.intro", "Empresa: quién responde"),
            ("*", "display.textAlign", "start"))));
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(
            ("es", "demographics.intro", "Encuesta: sobre usted"))));

        var spanish = await RespondViewAsync(survey.Id, "es");
        Assert.Equal("es", spanish.ResolvedLocale);
        Assert.NotNull(spanish.Content);
        Assert.Equal("Encuesta: sobre usted", spanish.Content["demographics.intro"]);
        Assert.Equal("Empresa: quién responde", spanish.Content["identity.intro"]);
        Assert.Equal("start", spanish.Content["display.textAlign"]);
        Assert.False(spanish.Content.ContainsKey("closedTitle"));

        // Nothing in English was set: an English reader gets the display choice and no words.
        var english = await RespondViewAsync(survey.Id, "en");
        Assert.Equal("en", english.ResolvedLocale);
        Assert.Equal(["display.textAlign"], english.Content!.Keys);

        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("en", "demographics.intro", "Survey: about you"))));
        english = await RespondViewAsync(survey.Id, "en");
        Assert.Equal("Survey: about you", english.Content!["demographics.intro"]);
        Assert.False(english.Content.ContainsKey("identity.intro"));
    }

    /// <summary>
    /// The four keys that had survey columns: the survey PUT writes the column (never the table),
    /// the existing settings route and this one read the same value, and a cleared column lets the
    /// company's words show through.
    /// </summary>
    [Fact]
    public async Task A_legacy_key_is_written_to_its_survey_column_and_the_company_shows_through_when_it_is_cleared()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);

        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(("es", "thankYouTitle", "Gracias, de parte de la empresa"))));
        var view = await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(
            ("es", "anonymousBody", "Párrafo propio de la encuesta"),
            ("es", "email.personalLink.subject", "Su encuesta de {company}"))));

        var settings = await SettingsAsync(survey.Id);
        Assert.Equal("Párrafo propio de la encuesta", settings.RespondentIntroEs);
        Assert.Equal("Su encuesta de {company}", settings.InvitationCustomSubjectEs);
        Assert.DoesNotContain(await RowsAsync(_companyA), r => r.SurveyId == survey.Id);

        Assert.Equal("Párrafo propio de la encuesta", view.SurveyValues!["es"]["anonymousBody"]);
        Assert.Equal("Gracias, de parte de la empresa", view.CompanyValues["es"]["thankYouTitle"]);
        Assert.Equal("Gracias, de parte de la empresa", view.Effective["es"]["thankYouTitle"]);
        Assert.Equal("Su encuesta de {company}", view.Effective["es"]["email.personalLink.subject"]);

        var respond = await RespondViewAsync(survey.Id, "es");
        Assert.Equal("Párrafo propio de la encuesta", respond.Content!["anonymousBody"]);
        Assert.Equal("Párrafo propio de la encuesta", respond.RespondentIntro);
        Assert.Equal("Gracias, de parte de la empresa", respond.Content["thankYouTitle"]);
        // An email's words never ride on a respondent payload.
        Assert.False(respond.Content.ContainsKey("email.personalLink.subject"));

        // The existing «Textos para quien responde» route writes the same column this one reads.
        (await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(ClosingMessage: LocalizedInput.FromBare("Gracias, de parte de la encuesta")))))
            .EnsureSuccessStatusCode();
        view = await OkViewAsync(await admin.GetAsync(SurveyRoute(survey.Id)));
        Assert.Equal("Gracias, de parte de la encuesta", view.SurveyValues!["es"]["thankYouTitle"]);
        Assert.Equal("Gracias, de parte de la encuesta", view.Effective["es"]["thankYouTitle"]);

        // Cleared here, the column is empty and the company's words are back.
        view = await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "thankYouTitle", ""))));
        Assert.Null((await SettingsAsync(survey.Id)).ClosingMessageEs);
        Assert.False(view.SurveyValues!["es"].ContainsKey("thankYouTitle"));
        Assert.Equal("Gracias, de parte de la empresa", (await RespondViewAsync(survey.Id, "es")).Content!["thankYouTitle"]);
    }

    /// <summary>
    /// One answer per text: the old <c>respondentIntro</c> / <c>closingMessage</c> fields are the
    /// content map's <c>anonymousBody</c> / <c>thankYouTitle</c>, from the same chain, in the
    /// payload's locale only -- so an English reader of a two-language survey whose paragraph
    /// exists only in Spanish gets neither the Spanish words nor a "fallback" notice for them.
    /// </summary>
    [Fact]
    public async Task The_old_intro_and_thank_you_fields_are_the_contents_value_and_never_another_languages()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA, ContentLanguages.Both);
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(
            ("es", "anonymousBody", "Párrafo solo en español"),
            ("es", "thankYouTitle", "Gracias solo en español"))));

        var english = await RespondViewAsync(survey.Id, "en");
        Assert.Equal("en", english.ResolvedLocale);
        Assert.Null(english.RespondentIntro);
        Assert.Null(english.ClosingMessage);
        Assert.DoesNotContain("settings.respondentIntro", english.FallbackFields);
        Assert.DoesNotContain("settings.closingMessage", english.FallbackFields);
        Assert.False(english.Content!.ContainsKey("anonymousBody"));

        // The company's English words reach both fields at once.
        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(
            ("en", "anonymousBody", "The company's paragraph"),
            ("en", "thankYouTitle", "The company thanks you"))));
        english = await RespondViewAsync(survey.Id, "en");
        Assert.Equal("The company's paragraph", english.RespondentIntro);
        Assert.Equal(english.Content!["anonymousBody"], english.RespondentIntro);
        Assert.Equal("The company thanks you", english.ClosingMessage);
        Assert.Equal(english.Content["thankYouTitle"], english.ClosingMessage);

        var spanish = await RespondViewAsync(survey.Id, "es");
        Assert.Equal("Párrafo solo en español", spanish.RespondentIntro);
        Assert.Equal(spanish.Content!["anonymousBody"], spanish.RespondentIntro);
        Assert.Equal("Gracias solo en español", spanish.ClosingMessage);
    }

    /// <summary>
    /// The respond view is built without a respondent, a session or a write
    /// (<c>SurveyResponseEndpoints.BuildRespondViewAsync</c>), on a survey in any status -- what a
    /// preview of the respond flow needs -- and it is the same view the respond GET serves.
    /// </summary>
    [Fact]
    public async Task The_respond_view_builds_for_a_draft_without_a_session_and_writes_nothing()
    {
        var admin = await AdminAsync(_companyA);
        var live = await LinkSurveyAsync(admin, _companyA);
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(live.Id), Body(("es", "eyebrow", "Encuesta de la casa"))));
        var draft = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyA));

        var served = await RespondViewAsync(live.Id, "es");
        var (built, draftView, before, after) = await _harness.WithDbAsync(async db =>
        {
            var liveSurvey = await db.Surveys.AsNoTracking().FirstAsync(s => s.Id == live.Id);
            var draftSurvey = await db.Surveys.AsNoTracking().FirstAsync(s => s.Id == draft.Id);
            var count = await db.Responses.CountAsync(r => r.SurveyId == live.Id || r.SurveyId == draft.Id);
            var a = await SurveyResponseEndpoints.BuildRespondViewAsync(db, liveSurvey, "es", RespondReader.LinkVisitor, inProgress: null, CancellationToken.None);
            var b = await SurveyResponseEndpoints.BuildRespondViewAsync(db, draftSurvey, "es", RespondReader.LinkVisitor, inProgress: null, CancellationToken.None);
            return (a, b, count, await db.Responses.CountAsync(r => r.SurveyId == live.Id || r.SurveyId == draft.Id));
        });

        Assert.Equal(before, after);
        Assert.Equal(SurveyStatuses.Draft, draft.Status);
        Assert.Equal(draft.Id, draftView.Id);
        Assert.Null(draftView.InProgress);
        Assert.Equal(JsonSerializer.Serialize(served), JsonSerializer.Serialize(built));
        Assert.Equal("Encuesta de la casa", built.Content!["eyebrow"]);
    }

    /// <summary>A person of company A with a personal invitation to <paramref name="surveyId"/>, in <paramref name="status"/>.</summary>
    private async Task<string> SeedInvitationAsync(Guid surveyId, string status = SurveyInvitationStatuses.Pending)
    {
        var token = SurveyAccessTokens.Mint();
        await _harness.WithDbAsync(async db =>
        {
            var person = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyA,
                Email = $"{Guid.NewGuid():N}@invitee.test",
                Name = "Invitada",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(person);
            db.SurveyInvitations.Add(new SurveyInvitation
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                UserId = person.Id,
                CompanyId = _companyA,
                Email = person.Email,
                InvitationToken = token,
                Status = status,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(14),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        return token;
    }

    /// <summary>
    /// The «Encuesta cerrada» card is drawn from the respond GET's 400, with no view loaded: the
    /// 400 a signed-in member of the audience gets carries the effective words for it, survey
    /// over company, in the payload's locale.
    /// </summary>
    [Fact]
    public async Task A_closed_surveys_refusal_carries_the_words_its_card_reads()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(
            ("es", "closedTitle", "La encuesta de la empresa cerró"),
            ("es", "closedBody", "Gracias por su interés."))));
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(
            ("es", "closedTitle", "Esta encuesta cerró el viernes"),
            ("*", "display.textAlign", "start"))));
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Closed);

        var employee = await _harness.ClientAsync(Roles.Employee, _companyA);
        var http = await employee.GetAsync($"/surveys/{survey.Id}/respond?lang=en");
        var raw = await http.Content.ReadAsStringAsync();
        Assert.True(http.StatusCode == HttpStatusCode.BadRequest, $"Expected 400, got {(int)http.StatusCode}: {raw}");
        var body = JsonSerializer.Deserialize<RespondentCardRefusal>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        // An es-only survey asked for in English is in Spanish, and says so.
        Assert.Equal("es", body.ResolvedLocale);
        Assert.Equal("Esta encuesta cerró el viernes", body.Content["closedTitle"]);
        Assert.Equal("Gracias por su interés.", body.Content["closedBody"]);
        Assert.Equal("start", body.Content["display.textAlign"]);
        Assert.Equal("This survey is not currently accepting responses", body.Message);
    }

    /// <summary>
    /// The 401 a visitor with no account gets on the same closed survey stays fail-closed: no
    /// words, no locale -- nothing that says whose survey the id was.
    /// </summary>
    [Fact]
    public async Task A_link_visitor_on_a_closed_survey_gets_a_refusal_that_carries_nothing()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(("es", "closedTitle", "La encuesta de la empresa cerró"))));
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Closed);

        var http = await _factory.CreateClient().GetAsync($"/surveys/{survey.Id}/respond?lang=es");
        var raw = await http.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, http.StatusCode);
        var body = JsonDocument.Parse(raw).RootElement;
        Assert.False(body.TryGetProperty("content", out _), raw);
        Assert.False(body.TryGetProperty("resolvedLocale", out _), raw);
        Assert.DoesNotContain("cerró", raw, StringComparison.Ordinal);
    }

    /// <summary>
    /// The personal-link landing draws «ya respondida» from its 409 `already_completed`, with
    /// nothing else loaded: the 409 carries the words for it.
    /// </summary>
    [Fact]
    public async Task A_completed_invitations_refusal_carries_the_words_its_card_reads()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(
            ("es", "alreadyCompletedTitle", "Ya respondió, gracias"),
            ("es", "alreadyCompletedBody", "Sus respuestas ya están registradas."))));
        var token = await SeedInvitationAsync(survey.Id, SurveyInvitationStatuses.Completed);

        var http = await _factory.CreateClient().GetAsync($"/survey-invitations/{token}?lang=es");
        var raw = await http.Content.ReadAsStringAsync();
        Assert.True(http.StatusCode == HttpStatusCode.Conflict, $"Expected 409, got {(int)http.StatusCode}: {raw}");
        var body = JsonSerializer.Deserialize<RespondentCardRefusal>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Assert.Equal("already_completed", body.Reason);
        Assert.Equal("es", body.ResolvedLocale);
        Assert.Equal("Ya respondió, gracias", body.Content["alreadyCompletedTitle"]);
        Assert.Equal("Sus respuestas ya están registradas.", body.Content["alreadyCompletedBody"]);
    }

    [Fact]
    public async Task The_personal_link_landing_carries_the_same_content()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        var token = SurveyAccessTokens.Mint();
        await _harness.WithDbAsync(async db =>
        {
            var person = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyA,
                Email = $"{Guid.NewGuid():N}@invitee.test",
                Name = "Invitada",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(person);
            db.SurveyInvitations.Add(new SurveyInvitation
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                UserId = person.Id,
                CompanyId = _companyA,
                Email = person.Email,
                InvitationToken = token,
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(14),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(("es", "invitationEyebrow", "Su invitación personal"))));
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "beginSurvey", "Comenzar"), ("*", "display.textAlign", "start"))));

        var http = await _factory.CreateClient().GetAsync($"/survey-invitations/{token}");
        var raw = await http.Content.ReadAsStringAsync();
        Assert.True(http.IsSuccessStatusCode, raw);
        var detail = JsonSerializer.Deserialize<SurveyInvitationTokenDetail>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Assert.Equal("es", detail.ResolvedLocale);
        Assert.Equal("Su invitación personal", detail.Content!["invitationEyebrow"]);
        Assert.Equal("Comenzar", detail.Content["beginSurvey"]);
        Assert.Equal("start", detail.Content["display.textAlign"]);
    }

    // ------------------------------------------------------------------
    // Who may write
    // ------------------------------------------------------------------

    [Fact]
    public async Task Another_companys_admin_and_an_employee_are_refused_both_levels()
    {
        var adminA = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(adminA, _companyA);
        var adminB = await AdminAsync(_companyB);
        var employeeA = await _harness.ClientAsync(Roles.Employee, _companyA);
        var body = Body(("es", "eyebrow", "Encuesta de clima"));

        foreach (var caller in new[] { adminB, employeeA })
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await caller.GetAsync(CompanyRoute(_companyA))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await caller.PutAsJsonAsync(CompanyRoute(_companyA), body)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await caller.GetAsync(SurveyRoute(survey.Id))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await caller.PutAsJsonAsync(SurveyRoute(survey.Id), body)).StatusCode);
        }

        Assert.Empty(await RowsAsync(_companyA));

        // Their own company is theirs.
        var own = await OkViewAsync(await adminB.PutAsJsonAsync(CompanyRoute(_companyB), body));
        Assert.Equal("Encuesta de clima", own.CompanyValues["es"]["eyebrow"]);
        Assert.Equal(["es"], own.RequiredLocales);
    }

    /// <summary>
    /// "Although it's already published, it can still be edited by the super admin": a closed
    /// survey refuses its company admin and admits a TIMS operator, whose write -- with no company
    /// of their own -- is still filed under the survey's company.
    /// </summary>
    [Fact]
    public async Task A_closed_survey_refuses_its_company_admin_and_admits_a_super_admin_audited_to_the_company()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Closed);

        var refused = await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "closedTitle", "Cerrada")));
        await RefusalAsync(refused, HttpStatusCode.Conflict, AdminRefusals.RespondentContentLocked);
        Assert.False((await OkViewAsync(await admin.GetAsync(SurveyRoute(survey.Id)))).Editable);
        Assert.Empty(await RowsAsync(_companyA));

        var timsOperator = await OperatorAsync();
        var view = await OkViewAsync(await timsOperator.PutAsJsonAsync(SurveyRoute(survey.Id), Body(
            ("es", "closedTitle", "Esta encuesta ya cerró"), ("es", "anonymousBody", "Párrafo corregido"))));
        Assert.True(view.Editable);
        Assert.Equal("Esta encuesta ya cerró", view.SurveyValues!["es"]["closedTitle"]);
        Assert.Equal("Párrafo corregido", (await SettingsAsync(survey.Id)).RespondentIntroEs);

        var audit = await _harness.WithDbAsync(db => db.AuditLogs.AsNoTracking()
            .Where(a => a.Action == "surveys.respondent-content.update" && a.ResourceId == survey.Id.ToString() && a.Success)
            .ToListAsync());
        var row = Assert.Single(audit);
        Assert.Equal(_companyA, row.CompanyId);
        Assert.Contains("es.closedTitle", row.Details, StringComparison.Ordinal);
        // A status, never the words.
        Assert.DoesNotContain("Esta encuesta ya cerró", row.Details, StringComparison.Ordinal);
        Assert.DoesNotContain("Párrafo corregido", row.Details, StringComparison.Ordinal);

        // The survey's own history says its texts changed.
        var history = await _harness.WithDbAsync(db => db.SurveyAuditLogs.AsNoTracking()
            .Where(l => l.SurveyId == survey.Id && l.Action == SurveyAuditActions.Updated)
            .Select(l => l.Changes)
            .ToListAsync());
        Assert.Contains(history, c => c != null && c.Contains("respondentContent", StringComparison.Ordinal) && c.Contains("settings.respondentIntro", StringComparison.Ordinal));
    }

    /// <summary>
    /// An es-only survey is always served in Spanish, so an English text set on it would be read
    /// by nobody -- and on a legacy key would block it from ever leaving draft. Refused, writing
    /// nothing; clearing one is allowed. The company level, which has no single survey language,
    /// takes both.
    /// </summary>
    [Fact]
    public async Task A_survey_refuses_a_text_in_a_language_it_is_not_written_in()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);

        var body = await RefusalAsync(
            await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "eyebrow", "Clima"), ("en", "anonymousBody", "Our paragraph"))),
            HttpStatusCode.BadRequest,
            AdminRefusals.RespondentContentLocaleNotOffered);
        Assert.Equal("en", body.GetProperty("locale").GetString());
        Assert.Equal("anonymousBody", body.GetProperty("key").GetString());
        Assert.Equal(["es"], body.GetProperty("allowed").EnumerateArray().Select(a => a.GetString()));
        Assert.Null((await SettingsAsync(survey.Id)).RespondentIntroEn);
        Assert.Empty(await RowsAsync(_companyA));

        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("en", "anonymousBody", ""), ("es", "eyebrow", "Clima"))));
        var view = await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(("en", "eyebrow", "Climate"))));
        Assert.Equal("Climate", view.CompanyValues["en"]["eyebrow"]);
        Assert.Contains(view.Entries, e => e.Key == "anonymousBody" && e.RequiresEveryLocale);
        Assert.Contains(view.Entries, e => e.Key == "eyebrow" && !e.RequiresEveryLocale);
    }

    [Fact]
    public async Task An_archived_survey_refuses_everybody()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Archived);

        foreach (var caller in new[] { admin, await OperatorAsync() })
        {
            await RefusalAsync(
                await caller.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "closedTitle", "Archivada"))),
                HttpStatusCode.Conflict,
                AdminRefusals.RespondentContentArchived);
        }

        Assert.Empty(await RowsAsync(_companyA));
    }

    [Fact]
    public async Task A_super_admin_writes_any_companys_level_and_the_row_is_filed_under_that_company()
    {
        var timsOperator = await OperatorAsync();

        var view = await OkViewAsync(await timsOperator.PutAsJsonAsync(CompanyRoute(_companyB), Body(("es", "identity.intro", "Solo registramos que usted respondió."))));

        Assert.Equal("Solo registramos que usted respondió.", view.Effective["es"]["identity.intro"]);
        var audit = await _harness.WithDbAsync(db => db.AuditLogs.AsNoTracking()
            .Where(a => a.Action == "admin.companies.respondent-content.update" && a.ResourceId == _companyB.ToString())
            .ToListAsync());
        Assert.Equal(_companyB, Assert.Single(audit).CompanyId);
    }

    // ------------------------------------------------------------------
    // Validation: everything before the first write
    // ------------------------------------------------------------------

    public static TheoryData<string, string, string?, string> BadEntries() => new()
    {
        { "es", "notAKey", "x", AdminRefusals.RespondentContentUnknownKey },
        { "fr", "eyebrow", "Enquête", AdminRefusals.RespondentContentUnknownLocale },
        { "*", "eyebrow", "Encuesta", AdminRefusals.RespondentContentLocaleMismatch },
        { "es", "eyebrow", new string('a', RespondentContentRegistry.LabelMaxLength + 1), AdminRefusals.RespondentContentTooLong },
        { "es", "next.closesOn", "Cierra el {fecha}.", AdminRefusals.RespondentContentUnknownPlaceholder },
        { "*", "display.textAlign", "center", AdminRefusals.RespondentContentValueNotAllowed },
    };

    /// <summary>
    /// A valid entry first, then a bad one: the 400 names the bad one, and neither the table nor
    /// the survey's column holds the valid one -- nothing half-applied, at either level.
    /// </summary>
    [Theory]
    [MemberData(nameof(BadEntries))]
    public async Task A_refused_body_writes_nothing_at_either_level(string locale, string key, string? value, string code)
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);

        var company = await RefusalAsync(
            await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(("es", "closedTitle", "Válido"), (locale, key, value))),
            HttpStatusCode.BadRequest,
            code);
        Assert.Equal(locale, company.GetProperty("locale").GetString());

        var surveyLevel = await RefusalAsync(
            await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "anonymousBody", "Válido"), ("es", "demographics.intro", "Válido"), (locale, key, value))),
            HttpStatusCode.BadRequest,
            code);
        if (code != AdminRefusals.RespondentContentUnknownLocale)
        {
            Assert.Equal(key, surveyLevel.GetProperty("key").GetString());
        }

        if (code == AdminRefusals.RespondentContentUnknownPlaceholder)
        {
            Assert.Equal("fecha", surveyLevel.GetProperty("placeholder").GetString());
        }

        Assert.Empty(await RowsAsync(_companyA));
        Assert.Null((await SettingsAsync(survey.Id)).RespondentIntroEs);
    }

    // ------------------------------------------------------------------
    // Duplicar, and deleting what owns the rows
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Duplicar_copies_the_surveys_own_wording_on_both_paths(bool includeAudience)
    {
        var admin = await AdminAsync(_companyA);
        var survey = await LinkSurveyAsync(admin, _companyA);
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(
            ("es", "demographics.intro", "A la medida"), ("es", "anonymousBody", "Párrafo"), ("*", "display.textAlign", "start"))));

        var copied = await admin.PostAsJsonAsync($"/surveys/{survey.Id}/duplicate", new DuplicateSurveyRequest(IncludeAudience: includeAudience));
        copied.EnsureSuccessStatusCode();
        var copy = (await copied.Content.ReadFromJsonAsync<SurveyDetail>())!;

        var view = await OkViewAsync(await admin.GetAsync(SurveyRoute(copy.Id)));
        Assert.Equal("A la medida", view.SurveyValues!["es"]["demographics.intro"]);
        Assert.Equal("Párrafo", view.SurveyValues["es"]["anonymousBody"]);
        Assert.Equal("start", view.SurveyValues["*"]["display.textAlign"]);
        // The source keeps its own rows.
        Assert.Equal(2, (await RowsAsync(_companyA)).Count(r => r.SurveyId == survey.Id));
    }

    [Fact]
    public async Task Deleting_a_survey_takes_its_wording_and_its_authorized_list()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyA, language: "es"));
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "eyebrow", "Encuesta propia"))));
        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(_companyA), Body(("es", "eyebrow", "Encuesta de la empresa"))));
        await _harness.WithDbAsync(async db =>
        {
            db.SurveyAuthorizedPeople.Add(new SurveyAuthorizedPerson
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                Email = SurveyAuthorizedPerson.NormaliseEmail("  Ana@Cliente.test "),
                AddedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/surveys/{survey.Id}")).StatusCode);

        var rows = await RowsAsync(_companyA);
        Assert.DoesNotContain(rows, r => r.SurveyId == survey.Id);
        Assert.Contains(rows, r => r.SurveyId == null && r.Key == "eyebrow");
        Assert.False(await _harness.WithDbAsync(db => db.SurveyAuthorizedPeople.AnyAsync(p => p.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task Deleting_a_company_takes_its_wording_its_surveys_wording_and_their_authorized_lists()
    {
        var doomed = await _harness.SeedCompanyAsync($"Borrar {Guid.NewGuid():N}"[..20]);
        var admin = await AdminAsync(doomed);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(doomed, language: "es"));
        await OkViewAsync(await admin.PutAsJsonAsync(CompanyRoute(doomed), Body(("es", "eyebrow", "Encuesta"), ("*", "display.textAlign", "start"))));
        await OkViewAsync(await admin.PutAsJsonAsync(SurveyRoute(survey.Id), Body(("es", "closedTitle", "Cerrada"))));
        await _harness.WithDbAsync(async db =>
        {
            db.SurveyAuthorizedPeople.Add(new SurveyAuthorizedPerson
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                Email = "ana@cliente.test",
                AddedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        var name = await _harness.WithDbAsync(db => db.Companies.Where(c => c.Id == doomed).Select(c => c.Name).SingleAsync());

        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/admin/companies/{doomed}")
        {
            Content = JsonContent.Create(new DeleteCompanyRequest(name)),
        };
        var deleted = await (await OperatorAsync()).SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty(await RowsAsync(doomed));
        Assert.False(await _harness.WithDbAsync(db => db.SurveyAuthorizedPeople.AnyAsync(p => p.SurveyId == survey.Id)));
        Assert.False(await _harness.WithDbAsync(db => db.Companies.AnyAsync(c => c.Id == doomed)));
    }

    // ------------------------------------------------------------------
    // Persistence of the two tables the lanes build on
    // ------------------------------------------------------------------

    /// <summary>
    /// <c>survey_authorized_people</c> holds one row per address per survey (the normalised form),
    /// and forgets who added a row when that person is deleted rather than blocking the delete.
    /// </summary>
    [Fact]
    public async Task An_authorized_address_is_unique_per_survey_and_outlives_who_added_it()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyA, language: "es"));
        var adder = await _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyA,
                Email = $"{Guid.NewGuid():N}@tims.test",
                Name = "Quien agrega",
                Role = Roles.CompanyAdmin,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            db.SurveyAuthorizedPeople.Add(new SurveyAuthorizedPerson
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                Email = SurveyAuthorizedPerson.NormaliseEmail(" Ana.Perez@Cliente.test"),
                DisplayName = "Ana Pérez",
                AddedBy = user.Id,
                AddedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return user.Id;
        });

        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => _harness.WithDbAsync(async db =>
        {
            db.SurveyAuthorizedPeople.Add(new SurveyAuthorizedPerson
            {
                Id = Guid.NewGuid(),
                SurveyId = survey.Id,
                Email = SurveyAuthorizedPerson.NormaliseEmail("ana.perez@cliente.TEST "),
                AddedAt = DateTimeOffset.UtcNow,
            });
            return await db.SaveChangesAsync();
        }));
        Assert.Contains("survey_authorized_people", duplicate.InnerException?.Message ?? duplicate.Message, StringComparison.Ordinal);

        await _harness.WithDbAsync(db => db.Database.ExecuteSqlAsync($"DELETE FROM users WHERE \"Id\" = {adder}"));

        var row = await _harness.WithDbAsync(db => db.SurveyAuthorizedPeople.AsNoTracking().SingleAsync(p => p.SurveyId == survey.Id));
        Assert.Equal("ana.perez@cliente.test", row.Email);
        Assert.Equal("Ana Pérez", row.DisplayName);
        Assert.Null(row.AddedBy);
    }

    /// <summary>The partial unique indexes: one company row and one survey row per key and locale.</summary>
    [Fact]
    public async Task One_row_per_key_and_locale_at_each_level()
    {
        var admin = await AdminAsync(_companyA);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyA, language: "es"));
        RespondentContentOverride Row(Guid? surveyId) => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyA,
            SurveyId = surveyId,
            Key = "eyebrow",
            Locale = "es",
            Value = "Encuesta",
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        await _harness.WithDbAsync(async db =>
        {
            db.RespondentContentOverrides.AddRange(Row(null), Row(survey.Id));
            return await db.SaveChangesAsync();
        });

        foreach (var level in new Guid?[] { null, survey.Id })
        {
            await Assert.ThrowsAsync<DbUpdateException>(() => _harness.WithDbAsync(async db =>
            {
                db.RespondentContentOverrides.Add(Row(level));
                return await db.SaveChangesAsync();
            }));
        }
    }

    [Fact]
    public async Task A_reports_notes_are_stored_in_both_languages()
    {
        var (_, authorId) = await _harness.IdentifiedClientAsync(Roles.CompanyAdmin, _companyA);
        var id = Guid.NewGuid();
        var note = new string('n', ReportNotes.MaxLength);
        await _harness.WithDbAsync(async db =>
        {
            db.Reports.Add(new Report
            {
                Id = id,
                Type = "survey",
                Format = "pdf",
                CompanyId = _companyA,
                CreatedBy = authorId,
                NotesIntroEs = "Introducción de TIMS",
                NotesIntroEn = "TIMS's introduction",
                NotesConclusionsEs = note,
                NotesRecommendationsEn = "Recommendations",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            return await db.SaveChangesAsync();
        });

        var stored = await _harness.WithDbAsync(db => db.Reports.AsNoTracking().SingleAsync(r => r.Id == id));
        Assert.Equal("Introducción de TIMS", stored.NotesIntroEs);
        Assert.Equal("TIMS's introduction", stored.NotesIntroEn);
        Assert.Equal(note, stored.NotesConclusionsEs);
        Assert.Null(stored.NotesConclusionsEn);
        Assert.Equal("Recommendations", stored.NotesRecommendationsEn);
        Assert.Null(stored.NotesRecommendationsEs);
    }
}
