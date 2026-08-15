using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

[Collection("Postgres")]
public class SurveyEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _engineeringId;
    private Guid _salesId;

    public SurveyEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"srv-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Survey Co A");
        _companyBId = await _harness.SeedCompanyAsync("Survey Co B");
        _engineeringId = await _harness.SeedDepartmentAsync(_companyAId, "Engineering");
        _salesId = await _harness.SeedDepartmentAsync(_companyAId, "Sales");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

    // ------------------------------------------------------------------
    // CRUD
    // ------------------------------------------------------------------

    [Fact]
    public async Task CompanyAdmin_creates_a_survey_and_reads_it_back()
    {
        var client = await AdminAAsync();

        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            questions:
            [
                new CreateSurveyQuestionInput(LocalizedInput.FromBare("How satisfied are you?"), "likert", Order: 0, Required: true),
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Which area needs work?"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("leadership", LocalizedInput.FromBare("Leadership")),
                        new CreateSurveyQuestionOptionInput("tooling", LocalizedInput.FromBare("Tooling")),
                    ],
                    Order: 1),
            ],
            departmentIds: [_engineeringId]));

        Assert.Equal(SurveyStatuses.Draft, created.Status);
        Assert.Equal(1, created.Version);
        Assert.Equal(0, created.ResponseCount);
        Assert.Equal("Q3 Climate Survey", created.Title);
        Assert.Equal(2, created.Questions.Count);
        Assert.Equal([_engineeringId], created.DepartmentIds);
        Assert.True(created.IsContentEditable);

        var fetched = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}");
        Assert.Equal(created.Id, fetched!.Id);
        Assert.Equal(2, fetched.Questions.Count);
        var choice = fetched.Questions.Single(q => q.Type == "multiple_choice");
        Assert.Equal(["leadership", "tooling"], choice.Options!.Select(o => o.Value));
    }

    [Fact]
    public async Task Creating_a_survey_records_the_acting_admin_as_its_author()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));

        // created_by is NOT NULL with a RESTRICT foreign key, so a survey that stored
        // Guid.Empty here would have failed to insert at all.
        var authorExists = await _harness.WithDbAsync(db => db.Users.AnyAsync(u => u.Id == created.CreatedBy));
        Assert.True(authorExists);
    }

    [Fact]
    public async Task An_update_rewrites_title_questions_and_targeting_while_the_survey_is_a_draft()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId, departmentIds: [_engineeringId]));

        var response = await client.PutAsJsonAsync($"/surveys/{created.Id}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Q4 Climate Survey"),
            DepartmentIds: [_salesId],
            Questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("What would you change?"), "open_ended", Order: 0)]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal("Q4 Climate Survey", updated.Title);
        Assert.Equal([_salesId], updated.DepartmentIds);
        Assert.Equal("What would you change?", Assert.Single(updated.Questions).Text);
    }

    [Fact]
    public async Task An_omitted_field_is_left_alone_rather_than_blanked()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId, departmentIds: [_engineeringId]));

        var response = await client.PutAsJsonAsync($"/surveys/{created.Id}", new UpdateSurveyRequest(
            Description: LocalizedInput.FromBare("Now with a description")));

        var updated = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.Equal("Q3 Climate Survey", updated.Title);
        Assert.Equal([_engineeringId], updated.DepartmentIds);
        Assert.Single(updated.Questions);
    }

    [Fact]
    public async Task A_draft_with_no_responses_can_be_deleted_and_takes_its_questions_with_it()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Pick one"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("a", LocalizedInput.FromBare("A")),
                        new CreateSurveyQuestionOptionInput("b", LocalizedInput.FromBare("B")),
                    ],
                    Order: 0),
            ],
            departmentIds: [_engineeringId]));

        var deleted = await client.DeleteAsync($"/surveys/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/surveys/{created.Id}")).StatusCode);

        await _harness.WithDbAsync(async db =>
        {
            Assert.False(await db.Questions.AnyAsync(q => q.SurveyId == created.Id));
            Assert.False(await db.SurveyDepartmentTargets.AnyAsync(t => t.SurveyId == created.Id));
        });
    }

    [Fact]
    public async Task A_survey_with_responses_cannot_be_deleted_and_the_error_points_at_archiving()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        await _harness.SeedResponseAsync(created.Id, _companyAId, null);

        var deleted = await client.DeleteAsync($"/surveys/{created.Id}");

        Assert.Equal(HttpStatusCode.Conflict, deleted.StatusCode);
        Assert.Contains("Archive it instead", await deleted.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.True(await _harness.WithDbAsync(db => db.Surveys.AnyAsync(s => s.Id == created.Id)));
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_question_type_outside_the_canonical_survey_vocabulary_is_rejected()
    {
        var client = await AdminAAsync();

        var response = await client.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
            _companyAId,
            questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("How do you feel?"), "open_text", Order: 0)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Invalid question type", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_multiple_choice_question_with_fewer_than_two_options_is_rejected()
    {
        var client = await AdminAAsync();

        var response = await client.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
            _companyAId,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Pick one"),
                    "multiple_choice",
                    Options: [new CreateSurveyQuestionOptionInput("only", LocalizedInput.FromBare("Only"))],
                    Order: 0),
            ]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("at least 2 options", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Two_options_sharing_a_stable_value_are_rejected_before_they_reach_the_unique_index()
    {
        var client = await AdminAAsync();

        var response = await client.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
            _companyAId,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Pick one"),
                    "multiple_choice",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("same", LocalizedInput.FromBare("First")),
                        new CreateSurveyQuestionOptionInput("same", LocalizedInput.FromBare("Second")),
                    ],
                    Order: 0),
            ]));

        // A 400 naming the duplicate, not a 500 out of the DbUpdateException handler.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("duplicate option value", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_survey_cannot_end_before_it_starts()
    {
        var client = await AdminAAsync();
        var request = SurveyTestHarness.MinimalRequest(_companyAId) with
        {
            StartDate = DateTimeOffset.UtcNow.AddDays(10),
            EndDate = DateTimeOffset.UtcNow.AddDays(1),
        };

        var response = await client.PostAsJsonAsync("/surveys", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_department_belonging_to_another_tenant_cannot_be_targeted()
    {
        var otherTenantDepartment = await _harness.SeedDepartmentAsync(_companyBId, "B's Engineering");
        var client = await AdminAAsync();

        var response = await client.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
            _companyAId, departmentIds: [otherTenantDepartment]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Unknown department", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Multi-tenancy
    // ------------------------------------------------------------------

    [Fact]
    public async Task CompanyAdmin_cannot_read_update_delete_or_publish_another_tenants_survey()
    {
        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        var bSurvey = await SurveyTestHarness.CreateSurveyAsync(adminB, SurveyTestHarness.MinimalRequest(_companyBId));

        var adminA = await AdminAAsync();

        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.GetAsync($"/surveys/{bSurvey.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.PutAsJsonAsync($"/surveys/{bSurvey.Id}", new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Hijacked")))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SurveyTestHarness.SetStatusAsync(adminA, bSurvey.Id, SurveyStatuses.Active)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.PostAsJsonAsync($"/surveys/{bSurvey.Id}/duplicate", new DuplicateSurveyRequest())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.DeleteAsync($"/surveys/{bSurvey.Id}")).StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_survey_inside_another_tenant()
    {
        var adminA = await AdminAAsync();

        var response = await adminA.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(_companyBId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_employee_cannot_reach_the_administration_surface()
    {
        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId);

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys?companyId={_companyAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys/scoped?companyId={_companyAId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(_companyAId))).StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_reaches_every_tenant()
    {
        var adminA = await AdminAAsync();
        var aSurvey = await SurveyTestHarness.CreateSurveyAsync(adminA, SurveyTestHarness.MinimalRequest(_companyAId));

        // A super_admin has no company of their own (#191: CompanyId is NULL for global
        // scope), which is exactly the shape that used to blow up on Guid.Parse.
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/surveys/{aSurvey.Id}")).StatusCode);

        var all = await superAdmin.GetFromJsonAsync<SurveyListResponse>("/surveys");
        Assert.Contains(all!.Surveys, s => s.Id == aSurvey.Id);
    }

    // ------------------------------------------------------------------
    // Scoped listing
    // ------------------------------------------------------------------

    [Fact]
    public async Task Scoped_listing_shows_only_the_callers_own_tenant()
    {
        var adminA = await AdminAAsync();
        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        var aSurvey = await SurveyTestHarness.CreateSurveyAsync(adminA, SurveyTestHarness.MinimalRequest(_companyAId));
        var bSurvey = await SurveyTestHarness.CreateSurveyAsync(adminB, SurveyTestHarness.MinimalRequest(_companyBId));

        var scoped = await adminA.GetFromJsonAsync<SurveyListResponse>("/surveys/scoped");

        Assert.Contains(scoped!.Surveys, s => s.Id == aSurvey.Id);
        Assert.DoesNotContain(scoped.Surveys, s => s.Id == bSurvey.Id);
    }

    [Fact]
    public async Task Asking_for_another_tenants_scope_explicitly_is_refused_rather_than_silently_rescoped()
    {
        var adminA = await AdminAAsync();

        var response = await adminA.GetAsync($"/surveys?companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Listing_filters_by_status_and_type_and_reports_question_counts()
    {
        var client = await AdminAAsync();
        var draft = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        var published = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(client, published.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var drafts = await client.GetFromJsonAsync<SurveyListResponse>($"/surveys?status={SurveyStatuses.Draft}");
        Assert.Contains(drafts!.Surveys, s => s.Id == draft.Id);
        Assert.DoesNotContain(drafts.Surveys, s => s.Id == published.Id);

        var actives = await client.GetFromJsonAsync<SurveyListResponse>($"/surveys?status={SurveyStatuses.Active}");
        Assert.Contains(actives!.Surveys, s => s.Id == published.Id);
        Assert.Equal(1, actives.Surveys.Single(s => s.Id == published.Id).QuestionCount);

        var byType = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?type=general_climate");
        Assert.Contains(byType!.Surveys, s => s.Id == draft.Id);

        var otherType = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?type=exit_interview");
        Assert.Empty(otherType!.Surveys);
    }

    [Fact]
    public async Task An_unknown_status_filter_is_a_400_rather_than_an_empty_list()
    {
        var client = await AdminAAsync();

        var response = await client.GetAsync("/surveys?status=published");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Search_matches_both_title_columns_so_a_bilingual_survey_is_findable_in_either_language()
    {
        var client = await AdminAAsync();
        var bilingual = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId,
            title: SurveyTestHarness.Both("Engagement pulse", "Pulso de compromiso"),
            language: ContentLanguages.Both));

        var byEnglish = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?q=Engagement");
        var bySpanish = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?q=compromiso");

        Assert.Contains(byEnglish!.Surveys, s => s.Id == bilingual.Id);
        Assert.Contains(bySpanish!.Surveys, s => s.Id == bilingual.Id);
    }

    [Fact]
    public async Task A_search_term_containing_a_wildcard_is_matched_literally()
    {
        var client = await AdminAAsync();
        await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(
            _companyAId, title: LocalizedInput.FromBare("Annual review")));

        // Unescaped, "%" would match every survey in the tenant.
        var results = await client.GetFromJsonAsync<SurveyListResponse>("/surveys?q=%25");

        Assert.Empty(results!.Surveys);
    }

    // ------------------------------------------------------------------
    // /surveys/my -- a different list, not a rescoped one
    // ------------------------------------------------------------------

    [Fact]
    public async Task My_serves_an_employee_the_surveys_scoped_refuses_them()
    {
        var admin = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId, _engineeringId);

        var mine = await employee.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Contains(mine!.Surveys, s => s.Id == survey.Id);

        // The two listings are not the same list wearing different scopes.
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/surveys/scoped")).StatusCode);
    }

    [Fact]
    public async Task My_omits_drafts_scheduled_closed_and_archived_surveys()
    {
        var admin = await AdminAAsync();
        var draft = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyAId));

        var scheduled = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(admin, scheduled.Id, SurveyStatuses.Scheduled)).EnsureSuccessStatusCode();

        var closed = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(admin, closed.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(admin, closed.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId, _engineeringId);
        var mine = await employee.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");

        Assert.DoesNotContain(mine!.Surveys, s => s.Id == draft.Id);
        Assert.DoesNotContain(mine.Surveys, s => s.Id == scheduled.Id);
        Assert.DoesNotContain(mine.Surveys, s => s.Id == closed.Id);
    }

    [Fact]
    public async Task My_respects_department_targeting()
    {
        var admin = await AdminAAsync();
        var engineeringOnly = await SurveyTestHarness.CreateSurveyAsync(
            admin, SurveyTestHarness.MinimalRequest(_companyAId, departmentIds: [_engineeringId]));
        (await SurveyTestHarness.SetStatusAsync(admin, engineeringOnly.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var engineer = await _harness.ClientAsync(Roles.Employee, _companyAId, _engineeringId);
        var salesperson = await _harness.ClientAsync(Roles.Employee, _companyAId, _salesId);

        Assert.Contains(
            (await engineer.GetFromJsonAsync<MySurveyListResponse>("/surveys/my"))!.Surveys,
            s => s.Id == engineeringOnly.Id);
        Assert.DoesNotContain(
            (await salesperson.GetFromJsonAsync<MySurveyListResponse>("/surveys/my"))!.Surveys,
            s => s.Id == engineeringOnly.Id);
    }

    [Fact]
    public async Task A_targeted_survey_is_hidden_from_someone_with_no_department_but_an_untargeted_one_is_not()
    {
        var admin = await AdminAAsync();
        var targeted = await SurveyTestHarness.CreateSurveyAsync(
            admin, SurveyTestHarness.MinimalRequest(_companyAId, departmentIds: [_engineeringId]));
        (await SurveyTestHarness.SetStatusAsync(admin, targeted.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var companyWide = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(admin, companyWide.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var unassigned = await _harness.ClientAsync(Roles.Employee, _companyAId, departmentId: null);
        var mine = (await unassigned.GetFromJsonAsync<MySurveyListResponse>("/surveys/my"))!.Surveys;

        Assert.DoesNotContain(mine, s => s.Id == targeted.Id);
        Assert.Contains(mine, s => s.Id == companyWide.Id);
    }

    [Fact]
    public async Task My_never_crosses_a_tenant_boundary()
    {
        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        var bSurvey = await SurveyTestHarness.CreateSurveyAsync(adminB, SurveyTestHarness.MinimalRequest(_companyBId));
        (await SurveyTestHarness.SetStatusAsync(adminB, bSurvey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var employeeA = await _harness.ClientAsync(Roles.Employee, _companyAId, _engineeringId);
        var mine = await employeeA.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");

        Assert.DoesNotContain(mine!.Surveys, s => s.Id == bSurvey.Id);
    }

    [Fact]
    public async Task My_drops_a_survey_the_caller_has_already_completed()
    {
        var admin = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var token = await _harness.TokenAsync(Roles.Employee, _companyAId, _engineeringId);
        var employee = _factory.CreateClient();
        employee.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var before = await employee.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Contains(before!.Surveys, s => s.Id == survey.Id);

        var employeeId = await _harness.WithDbAsync(db => db.Users
            .Where(u => u.CompanyId == _companyAId && u.DepartmentId == _engineeringId && u.Role == Roles.Employee)
            .OrderByDescending(u => u.CreatedAt)
            .Select(u => u.Id)
            .FirstAsync());
        await _harness.SeedResponseAsync(survey.Id, _companyAId, employeeId);

        var after = await employee.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.DoesNotContain(after!.Surveys, s => s.Id == survey.Id);
    }

    [Fact]
    public async Task My_returns_an_empty_list_for_a_super_admin_who_belongs_to_no_tenant()
    {
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        var mine = await superAdmin.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");

        Assert.Empty(mine!.Surveys);
    }

    // ------------------------------------------------------------------
    // Bulk
    // ------------------------------------------------------------------

    [Fact]
    public async Task Bulk_archive_reports_per_survey_outcomes_instead_of_failing_the_whole_batch()
    {
        var client = await AdminAAsync();
        var archivable = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));

        var active = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        (await SurveyTestHarness.SetStatusAsync(client, active.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var response = await client.PostAsJsonAsync("/surveys/bulk", new BulkSurveyActionRequest(
            "archive", [archivable.Id, active.Id]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var results = (await response.Content.ReadFromJsonAsync<BulkSurveyActionResponse>())!.Results;

        Assert.True(results.Single(r => r.SurveyId == archivable.Id).Succeeded);
        // An active survey must be closed before it can be archived -- bulk is a loop over
        // the same lifecycle rule, never a way around it.
        Assert.False(results.Single(r => r.SurveyId == active.Id).Succeeded);

        var reloadedActive = await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{active.Id}");
        Assert.Equal(SurveyStatuses.Active, reloadedActive!.Status);
    }

    [Fact]
    public async Task Bulk_reports_another_tenants_survey_as_not_found_rather_than_forbidden()
    {
        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        var bSurvey = await SurveyTestHarness.CreateSurveyAsync(adminB, SurveyTestHarness.MinimalRequest(_companyBId));

        var adminA = await AdminAAsync();
        var response = await adminA.PostAsJsonAsync("/surveys/bulk", new BulkSurveyActionRequest("archive", [bSurvey.Id]));

        var result = Assert.Single((await response.Content.ReadFromJsonAsync<BulkSurveyActionResponse>())!.Results);
        Assert.False(result.Succeeded);
        // "Forbidden" would confirm the GUID exists somewhere -- a cross-tenant probe, and
        // an endpoint taking a list of ids is the ideal shape for one.
        Assert.Equal("Survey not found", result.Message);

        var stillThere = await adminB.GetAsync($"/surveys/{bSurvey.Id}");
        Assert.Equal(HttpStatusCode.OK, stillThere.StatusCode);
    }

    [Fact]
    public async Task Bulk_delete_refuses_a_survey_that_has_responses()
    {
        var client = await AdminAAsync();
        var withResponses = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        await _harness.SeedResponseAsync(withResponses.Id, _companyAId, null);
        var empty = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));

        var response = await client.PostAsJsonAsync("/surveys/bulk", new BulkSurveyActionRequest(
            "delete", [withResponses.Id, empty.Id]));

        var results = (await response.Content.ReadFromJsonAsync<BulkSurveyActionResponse>())!.Results;
        Assert.False(results.Single(r => r.SurveyId == withResponses.Id).Succeeded);
        Assert.True(results.Single(r => r.SurveyId == empty.Id).Succeeded);

        Assert.True(await _harness.WithDbAsync(db => db.Surveys.AnyAsync(s => s.Id == withResponses.Id)));
        Assert.False(await _harness.WithDbAsync(db => db.Surveys.AnyAsync(s => s.Id == empty.Id)));
    }

    [Fact]
    public async Task An_unknown_bulk_action_is_rejected_outright()
    {
        var client = await AdminAAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));

        var response = await client.PostAsJsonAsync("/surveys/bulk", new BulkSurveyActionRequest("purge", [survey.Id]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
