using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Survey templates end to end (#107).
///
/// Two things here are not provable in a unit test and are the reason this file exists:
/// the multi-tenant read/write split around global templates (<c>CompanyId == null</c>),
/// which is a query-shaped property; and that instantiation writes real, independent rows
/// whose option values survive the round trip through Postgres.
/// </summary>
[Collection("Postgres")]
public class SurveyTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;
    private Guid _departmentId;

    public SurveyTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"tmpl-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        _companyId = await _harness.SeedCompanyAsync("Template Co");
        _otherCompanyId = await _harness.SeedCompanyAsync("Other Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Engineering");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private Task<HttpClient> OtherAdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _otherCompanyId);

    private Task<HttpClient> SuperAdminAsync() => _harness.ClientAsync(Roles.SuperAdmin, null);

    private Task<HttpClient> EmployeeAsync() => _harness.ClientAsync(Roles.Employee, _companyId);

    private static LocalizedInput Both(string en, string es) => SurveyTestHarness.Both(en, es);

    private static CreateSurveyTemplateRequest BilingualRequest(Guid? companyId) => new(
        Name: "Standard Climate Instrument",
        Description: "The 2026 baseline",
        Category: "general_climate",
        CompanyId: companyId,
        Tags: ["climate", "baseline"],
        Questions:
        [
            new CreateSurveyTemplateQuestionInput(
                Both("Are you satisfied?", "Estas satisfecho?"),
                QuestionTypes.YesNo,
                Order: 0,
                Required: true),
            new CreateSurveyTemplateQuestionInput(
                Both("Which area needs work?", "Que area necesita trabajo?"),
                QuestionTypes.MultipleChoice,
                Options:
                [
                    new CreateSurveyTemplateQuestionOptionInput("leadership", Both("Leadership", "Liderazgo")),
                    new CreateSurveyTemplateQuestionOptionInput("tooling", Both("Tooling", "Herramientas")),
                ],
                Order: 1),
        ],
        Language: ContentLanguages.Both);

    private static CreateSurveyTemplateRequest SpanishRequest(Guid? companyId) => new(
        Name: "Instrumento de Clima",
        Description: "La base de 2026",
        Category: "general_climate",
        CompanyId: companyId,
        Questions:
        [
            new CreateSurveyTemplateQuestionInput(
                LocalizedInput.FromBare("Que cambiarias?"),
                QuestionTypes.OpenEnded,
                Order: 0),
        ],
        Language: ContentLanguages.Spanish);

    private static async Task<SurveyTemplateDetail> CreateAsync(HttpClient client, CreateSurveyTemplateRequest request)
    {
        var response = await client.PostAsJsonAsync("/survey-templates", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;
    }

    // ------------------------------------------------------------------
    // CRUD
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_company_admin_creates_a_template_for_their_own_company()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        Assert.Equal(_companyId, template.CompanyId);
        Assert.False(template.IsGlobal);
        Assert.Equal(ContentLanguages.Both, template.Language);
        Assert.Equal(2, template.Questions.Count);
        Assert.Equal(["climate", "baseline"], template.Tags);
        Assert.Equal(0, template.UsageCount);
    }

    [Fact]
    public async Task Question_options_round_trip_with_their_stable_values()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        var choice = template.Questions.Single(q => q.Type == QuestionTypes.MultipleChoice);
        Assert.NotNull(choice.Options);
        Assert.Equal(["leadership", "tooling"], choice.Options!.OrderBy(o => o.Order).Select(o => o.Value));
        Assert.Equal(["Leadership", "Tooling"], choice.Options!.OrderBy(o => o.Order).Select(o => o.Label));
    }

    [Fact]
    public async Task A_template_is_read_in_the_requested_locale()
    {
        var client = await AdminAsync();
        var created = await CreateAsync(client, BilingualRequest(_companyId));

        var response = await client.GetAsync($"/survey-templates/{created.Id}?lang=es");
        response.EnsureSuccessStatusCode();
        var template = (await response.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;

        Assert.Equal(ContentLanguages.Spanish, template.ResolvedLocale);
        Assert.Empty(template.FallbackFields);
        Assert.Equal("Estas satisfecho?", template.Questions.Single(q => q.Order == 0).Text);
    }

    [Fact]
    public async Task A_spanish_only_template_read_in_english_comes_back_in_spanish_and_says_so()
    {
        // ResolvedLocale names the language the caller is actually READING. Reporting "en"
        // here would be the silent substitution the paired columns exist to prevent -- the
        // exact bug that shipped in #104 and was caught.
        var client = await AdminAsync();
        var created = await CreateAsync(client, SpanishRequest(_companyId));

        var response = await client.GetAsync($"/survey-templates/{created.Id}?lang=en");
        response.EnsureSuccessStatusCode();
        var template = (await response.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;

        Assert.Equal(ContentLanguages.Spanish, template.Language);
        Assert.Equal(ContentLanguages.Spanish, template.ResolvedLocale);
        Assert.Equal("Que cambiarias?", template.Questions.Single().Text);
        Assert.Contains("questions[0].text", template.FallbackFields);
    }

    [Fact]
    public async Task Updating_questions_replaces_them_wholesale()
    {
        var client = await AdminAsync();
        var created = await CreateAsync(client, BilingualRequest(_companyId));

        var response = await client.PutAsJsonAsync(
            $"/survey-templates/{created.Id}",
            new UpdateSurveyTemplateRequest(
                Name: "Revised Instrument",
                Questions:
                [
                    new CreateSurveyTemplateQuestionInput(Both("One question only", "Solo una pregunta"), QuestionTypes.OpenEnded, Order: 0),
                ],
                Language: ContentLanguages.Both));
        response.EnsureSuccessStatusCode();

        var template = (await response.Content.ReadFromJsonAsync<SurveyTemplateDetail>())!;
        Assert.Equal("Revised Instrument", template.Name);
        Assert.Single(template.Questions);

        // The replaced questions and their option rows are actually gone, not left behind
        // pointing at a template that no longer lists them.
        var oldQuestionIds = created.Questions.Select(q => q.Id).ToList();
        var leftovers = await _harness.WithDbAsync(async db => (
            Questions: await db.TemplateQuestions.CountAsync(q => oldQuestionIds.Contains(q.Id)),
            Options: await db.TemplateQuestionOptions.CountAsync(o => oldQuestionIds.Contains(o.TemplateQuestionId))));
        Assert.Equal((0, 0), leftovers);
    }

    [Fact]
    public async Task An_update_may_not_re_scope_a_template()
    {
        // UpdateSurveyTemplateRequest deliberately has no CompanyId. This asserts the
        // property that decision protects: a company admin cannot promote their own
        // template to a global one, which would make it writable-by-them and visible to
        // every tenant.
        var client = await AdminAsync();
        var created = await CreateAsync(client, BilingualRequest(_companyId));

        var response = await client.PutAsJsonAsync(
            $"/survey-templates/{created.Id}",
            new UpdateSurveyTemplateRequest(Name: "Renamed"));
        response.EnsureSuccessStatusCode();

        var stored = await _harness.WithDbAsync(db => db.SurveyTemplates.FirstAsync(t => t.Id == created.Id));
        Assert.Equal(_companyId, stored.CompanyId);
    }

    [Fact]
    public async Task Deleting_a_template_removes_its_questions_and_options()
    {
        var client = await AdminAsync();
        var created = await CreateAsync(client, BilingualRequest(_companyId));

        var response = await client.DeleteAsync($"/survey-templates/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var remaining = await _harness.WithDbAsync(db => db.TemplateQuestions.CountAsync(q => q.TemplateId == created.Id));
        Assert.Equal(0, remaining);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/survey-templates/{created.Id}")).StatusCode);
    }

    // ------------------------------------------------------------------
    // Global vs company scope -- read and write are SEPARATE checks
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_company_admin_may_READ_a_global_template()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateAsync(superAdmin, BilingualRequest(companyId: null));
        Assert.True(global.IsGlobal);

        var client = await AdminAsync();
        var response = await client.GetAsync($"/survey-templates/{global.Id}");
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_company_admin_may_NOT_CREATE_a_global_template()
    {
        // The denial that matters. A global template is visible to every tenant, and
        // instantiation deep-copies it, so a tenant who could write one would keep
        // propagating their edit into other tenants' surveys long afterwards. This is the
        // #207 shape, and MicroclimateTemplateEndpoints still has it open.
        var client = await AdminAsync();
        var response = await client.PostAsJsonAsync("/survey-templates", BilingualRequest(companyId: null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_may_NOT_UPDATE_a_global_template()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateAsync(superAdmin, BilingualRequest(companyId: null));

        var client = await AdminAsync();
        var response = await client.PutAsJsonAsync(
            $"/survey-templates/{global.Id}",
            new UpdateSurveyTemplateRequest(Name: "Tampered"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var stored = await _harness.WithDbAsync(db => db.SurveyTemplates.FirstAsync(t => t.Id == global.Id));
        Assert.Equal("Standard Climate Instrument", stored.Name);
    }

    [Fact]
    public async Task A_company_admin_may_NOT_DELETE_a_global_template()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateAsync(superAdmin, BilingualRequest(companyId: null));

        var client = await AdminAsync();
        var response = await client.DeleteAsync($"/survey-templates/{global.Id}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.True(await _harness.WithDbAsync(db => db.SurveyTemplates.AnyAsync(t => t.Id == global.Id)));
    }

    [Fact]
    public async Task A_company_admin_may_not_touch_another_tenants_template()
    {
        var owner = await AdminAsync();
        var created = await CreateAsync(owner, BilingualRequest(_companyId));

        var stranger = await OtherAdminAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"/survey-templates/{created.Id}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await stranger.PutAsJsonAsync($"/survey-templates/{created.Id}", new UpdateSurveyTemplateRequest(Name: "Tampered"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.DeleteAsync($"/survey-templates/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_company_admin_may_not_create_a_template_for_another_tenant()
    {
        var client = await AdminAsync();
        var response = await client.PostAsJsonAsync("/survey-templates", BilingualRequest(_otherCompanyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_listing_shows_global_and_own_templates_and_nobody_elses()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateAsync(superAdmin, BilingualRequest(companyId: null));

        var owner = await AdminAsync();
        var mine = await CreateAsync(owner, BilingualRequest(_companyId));

        var stranger = await OtherAdminAsync();
        var theirs = await CreateAsync(stranger, BilingualRequest(_otherCompanyId));

        var response = await owner.GetAsync("/survey-templates");
        response.EnsureSuccessStatusCode();
        var listed = (await response.Content.ReadFromJsonAsync<SurveyTemplateListResponse>())!.Templates.Select(t => t.Id).ToList();

        Assert.Contains(global.Id, listed);
        Assert.Contains(mine.Id, listed);
        Assert.DoesNotContain(theirs.Id, listed);
    }

    [Fact]
    public async Task The_listing_reports_the_question_count_and_the_global_flag()
    {
        var superAdmin = await SuperAdminAsync();
        var global = await CreateAsync(superAdmin, BilingualRequest(companyId: null));

        var owner = await AdminAsync();
        var response = await owner.GetAsync("/survey-templates");
        response.EnsureSuccessStatusCode();
        var item = (await response.Content.ReadFromJsonAsync<SurveyTemplateListResponse>())!
            .Templates.Single(t => t.Id == global.Id);

        Assert.True(item.IsGlobal);
        Assert.Null(item.CompanyId);
        Assert.Equal(2, item.QuestionCount);
    }

    [Fact]
    public async Task A_non_admin_gets_nothing()
    {
        var employee = await EmployeeAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/survey-templates")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await employee.PostAsJsonAsync("/survey-templates", BilingualRequest(_companyId))).StatusCode);
    }

    // ------------------------------------------------------------------
    // Instantiation
    // ------------------------------------------------------------------

    private static async Task<SurveyDetail> UseAsync(HttpClient client, Guid templateId, UseSurveyTemplateRequest? request = null)
    {
        var response = await client.PostAsJsonAsync($"/survey-templates/{templateId}/use", request ?? new UseSurveyTemplateRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
    }

    [Fact]
    public async Task Using_a_template_produces_a_draft_survey_carrying_both_language_halves()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        var survey = await UseAsync(client, template.Id, new UseSurveyTemplateRequest(
            CompanyId: _companyId,
            Title: Both("Q3 Climate Survey", "Encuesta de Clima Q3"),
            DepartmentIds: [_departmentId],
            Language: ContentLanguages.Both));

        Assert.Equal(SurveyStatuses.Draft, survey.Status);
        Assert.Equal(_companyId, survey.CompanyId);
        Assert.Equal(ContentLanguages.Both, survey.Language);
        Assert.Equal(2, survey.Questions.Count);
        Assert.Equal([_departmentId], survey.DepartmentIds);

        var stored = await _harness.WithDbAsync(db => db.Questions
            .Where(q => q.SurveyId == survey.Id)
            .OrderBy(q => q.Order)
            .ToListAsync());
        Assert.All(stored, q => Assert.False(string.IsNullOrWhiteSpace(q.TextEn)));
        Assert.All(stored, q => Assert.False(string.IsNullOrWhiteSpace(q.TextEs)));
    }

    [Fact]
    public async Task The_instantiated_surveys_options_keep_the_templates_stable_values()
    {
        // The single most important assertion in this file. If instantiation re-derived
        // option values, every survey made from a template would aggregate with nothing --
        // no error, no constraint violation, reconciling row counts.
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        var first = await UseAsync(client, template.Id, new UseSurveyTemplateRequest(Language: ContentLanguages.Both, Title: Both("A", "A")));
        var second = await UseAsync(client, template.Id, new UseSurveyTemplateRequest(Language: ContentLanguages.Both, Title: Both("B", "B")));

        var values = await _harness.WithDbAsync(async db =>
        {
            var ids = await db.Surveys.Where(s => s.Id == first.Id || s.Id == second.Id).Select(s => s.Id).ToListAsync();
            var questionIds = await db.Questions.Where(q => ids.Contains(q.SurveyId)).Select(q => q.Id).ToListAsync();
            return await db.QuestionOptions
                .Where(o => questionIds.Contains(o.QuestionId))
                .Select(o => o.Value)
                .ToListAsync();
        });

        Assert.Equal(4, values.Count);
        Assert.Equal(["leadership", "leadership", "tooling", "tooling"], values.OrderBy(v => v));
    }

    [Fact]
    public async Task The_instantiated_survey_is_independent_of_the_template()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));
        var survey = await UseAsync(client, template.Id, new UseSurveyTemplateRequest(Language: ContentLanguages.Both, Title: Both("A", "A")));

        var replaced = await client.PutAsJsonAsync(
            $"/survey-templates/{template.Id}",
            new UpdateSurveyTemplateRequest(
                Questions: [new CreateSurveyTemplateQuestionInput(Both("Replaced", "Reemplazada"), QuestionTypes.OpenEnded, Order: 0)],
                Language: ContentLanguages.Both));
        replaced.EnsureSuccessStatusCode();

        var response = await client.GetAsync($"/surveys/{survey.Id}");
        response.EnsureSuccessStatusCode();
        var after = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;

        Assert.Equal(2, after.Questions.Count);
        Assert.DoesNotContain(after.Questions, q => q.Text == "Replaced");
    }

    [Fact]
    public async Task Using_a_template_counts_the_use()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));
        await UseAsync(client, template.Id, new UseSurveyTemplateRequest(Language: ContentLanguages.Both, Title: Both("A", "A")));

        var stored = await _harness.WithDbAsync(db => db.SurveyTemplates.FirstAsync(t => t.Id == template.Id));
        Assert.Equal(1, stored.UsageCount);
        Assert.NotNull(stored.LastUsed);
    }

    [Fact]
    public async Task A_company_admin_may_instantiate_a_GLOBAL_template_into_their_own_company()
    {
        // Read access is enough to use; the write check applies to the survey's company,
        // not the template's. Refusing this would make global templates pointless.
        var superAdmin = await SuperAdminAsync();
        var global = await CreateAsync(superAdmin, BilingualRequest(companyId: null));

        var client = await AdminAsync();
        var survey = await UseAsync(client, global.Id, new UseSurveyTemplateRequest(Language: ContentLanguages.Both, Title: Both("A", "A")));

        Assert.Equal(_companyId, survey.CompanyId);
    }

    [Fact]
    public async Task A_company_admin_may_not_instantiate_into_another_tenant()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        var response = await client.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            new UseSurveyTemplateRequest(CompanyId: _otherCompanyId, Language: ContentLanguages.Both, Title: Both("A", "A")));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_bilingual_instantiation_without_a_title_is_refused_rather_than_guessed()
    {
        // The template's Name is one monolingual string. Filing it into both columns is the
        // silent content-mangling the paired columns exist to prevent, so the caller is
        // told to send { "en": ..., "es": ... }.
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        var response = await client.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            new UseSurveyTemplateRequest(Language: ContentLanguages.Both));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("authored in both languages", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_single_language_instantiation_falls_back_to_the_templates_name()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, SpanishRequest(_companyId));

        var survey = await UseAsync(client, template.Id);

        Assert.Equal(ContentLanguages.Spanish, survey.Language);
        Assert.Equal("Instrumento de Clima", survey.Title);

        var stored = await _harness.WithDbAsync(db => db.Surveys.FirstAsync(s => s.Id == survey.Id));
        Assert.Null(stored.TitleEn);
        Assert.Equal("Instrumento de Clima", stored.TitleEs);
    }

    [Fact]
    public async Task The_new_survey_inherits_the_language_the_template_is_actually_authored_in()
    {
        // The company defaults to 'en'. A Spanish-only template must not produce a survey
        // declaring itself English, which would then fail its own publish gate for English
        // the template never had.
        var client = await AdminAsync();
        var template = await CreateAsync(client, SpanishRequest(_companyId));

        var survey = await UseAsync(client, template.Id);

        Assert.Equal(ContentLanguages.Spanish, survey.Language);
    }

    [Fact]
    public async Task An_explicitly_requested_language_wins_over_the_templates()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, BilingualRequest(_companyId));

        var survey = await UseAsync(client, template.Id, new UseSurveyTemplateRequest(Language: ContentLanguages.English));

        Assert.Equal(ContentLanguages.English, survey.Language);
        Assert.Equal("Standard Climate Instrument", survey.Title);
    }

    [Fact]
    public async Task An_unknown_department_is_a_400_not_a_500()
    {
        var client = await AdminAsync();
        var template = await CreateAsync(client, SpanishRequest(_companyId));
        var foreignDepartment = await _harness.SeedDepartmentAsync(_otherCompanyId, "Sales");

        var response = await client.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            new UseSurveyTemplateRequest(DepartmentIds: [foreignDepartment]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Unknown department", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_super_admin_must_name_the_target_company()
    {
        // A super_admin has no tenant of their own since #191, so there is no company to
        // default to and creating the survey anywhere would be a guess.
        var superAdmin = await SuperAdminAsync();
        var template = await CreateAsync(superAdmin, SpanishRequest(companyId: null));

        var response = await superAdmin.PostAsJsonAsync(
            $"/survey-templates/{template.Id}/use",
            new UseSurveyTemplateRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("CompanyId is required", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Using_an_unknown_template_is_a_404()
    {
        var client = await AdminAsync();
        var response = await client.PostAsJsonAsync($"/survey-templates/{Guid.NewGuid()}/use", new UseSurveyTemplateRequest());

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_bare_string_is_refused_when_the_template_is_authored_in_both()
    {
        var client = await AdminAsync();
        var response = await client.PostAsJsonAsync("/survey-templates", new CreateSurveyTemplateRequest(
            Name: "Ambiguous",
            Description: "Ambiguous",
            Category: "general_climate",
            CompanyId: _companyId,
            Questions: [new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("How are you?"), QuestionTypes.OpenEnded)],
            Language: ContentLanguages.Both));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("authored in both languages", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_invalid_language_is_a_400()
    {
        var client = await AdminAsync();
        var response = await client.PostAsJsonAsync(
            "/survey-templates",
            BilingualRequest(_companyId) with { Language = "pt" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Invalid language: pt", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Name_description_and_category_are_required()
    {
        var client = await AdminAsync();
        var response = await client.PostAsJsonAsync("/survey-templates", new CreateSurveyTemplateRequest(
            Name: "   ",
            Description: "The 2026 baseline",
            Category: "general_climate",
            CompanyId: _companyId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_company_is_a_400_not_a_500()
    {
        var superAdmin = await SuperAdminAsync();
        var response = await superAdmin.PostAsJsonAsync("/survey-templates", BilingualRequest(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("not found", await response.Content.ReadAsStringAsync());
    }
}
