using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The refusals an administrator can trigger from a screen carry a stable <c>code</c>
/// (<see cref="AdminRefusals"/>), so <c>describeApiError</c> can say them in the reader's
/// language instead of falling back to a sentence chosen by the status (G30 follow-up).
/// </summary>
/// <remarks>
/// Every test pins THREE things: the status, the code, and the message word for word. The code
/// is additive -- an integration that reads <c>message</c> must see exactly what it saw before --
/// so the message is part of the contract, not an incidental.
/// </remarks>
[Collection("Postgres")]
public class AdminRefusalCodeTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public AdminRefusalCodeTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"refusal-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Refusal Codes Co");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private static async Task AssertRefusalAsync(
        HttpResponseMessage response, HttpStatusCode status, string code, string message)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"Expected {(int)status}, got {(int)response.StatusCode}: {raw}");
        using var body = JsonDocument.Parse(raw);
        Assert.Equal(code, body.RootElement.GetProperty("code").GetString());
        Assert.Equal(message, body.RootElement.GetProperty("message").GetString());
    }

    private async Task<(HttpClient Admin, Guid SurveyId)> SurveyAsync(
        string? status = null, CreateSurveyRequest? request = null)
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, request ?? SurveyTestHarness.MinimalRequest(_companyId));
        if (status is not null)
        {
            await _harness.ForceStatusAsync(survey.Id, status);
        }

        return (admin, survey.Id);
    }

    // ------------------------------------------------------------------
    // Org structure
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_department_name_already_used_at_its_level_is_refused_with_its_code_on_create_and_rename()
    {
        var admin = await AdminAsync();
        (await admin.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(_companyId, "Ventas", null, null, true)))
            .EnsureSuccessStatusCode();
        var other = await admin.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(_companyId, "Compras", null, null, true));
        other.EnsureSuccessStatusCode();
        var otherId = (await other.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(_companyId, "Ventas", null, null, true)),
            HttpStatusCode.BadRequest,
            "department_name_taken",
            "Department with this name already exists at this level");

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/admin/departments/{otherId}", new UpdateDepartmentRequest("Ventas", null, null)),
            HttpStatusCode.BadRequest,
            "department_name_taken",
            "Department with this name already exists at this level");
    }

    [Fact]
    public async Task A_demographic_field_key_already_used_is_refused_with_its_code()
    {
        var admin = await AdminAsync();
        var request = new CreateDemographicFieldRequest(_companyId, "sede", LocalizedInput.FromBare("Sede"), "text", null, false, 0);
        (await admin.PostAsJsonAsync("/admin/demographic-fields", request)).EnsureSuccessStatusCode();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/admin/demographic-fields", request),
            HttpStatusCode.Conflict,
            "demographic_field_key_taken",
            "A demographic field with key 'sede' already exists for this company");
    }

    [Fact]
    public async Task The_reserved_area_key_is_refused_with_its_code()
    {
        var admin = await AdminAsync();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync(
                "/admin/demographic-fields",
                new CreateDemographicFieldRequest(_companyId, SelfDeclaredDepartment.FieldKey, LocalizedInput.FromBare("Área"), "text", null, false, 0)),
            HttpStatusCode.BadRequest,
            "demographic_field_key_reserved",
            $"'{SelfDeclaredDepartment.FieldKey}' is reserved for the área a respondent declares; choose another key");
    }

    [Fact]
    public async Task A_select_field_with_no_options_is_refused_with_its_code()
    {
        var admin = await AdminAsync();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync(
                "/admin/demographic-fields",
                new CreateDemographicFieldRequest(_companyId, "turno", LocalizedInput.FromBare("Turno"), "select", [], false, 0)),
            HttpStatusCode.BadRequest,
            "demographic_field_options_required",
            "Select fields require at least one option");
    }

    [Fact]
    public async Task A_person_named_as_their_own_manager_is_refused_with_its_code()
    {
        var admin = await AdminAsync();
        var (_, personId) = await _harness.IdentifiedTokenAsync(Roles.Employee, _companyId);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/admin/users/{personId}", new UpdateUserRequest(null, null, personId, null)),
            HttpStatusCode.BadRequest,
            "user_own_manager",
            "A person cannot be their own manager");
    }

    [Fact]
    public async Task A_company_domain_that_is_malformed_or_taken_is_refused_with_its_code_on_create_and_update()
    {
        var super = await _harness.ClientAsync(Roles.SuperAdmin, null);
        // The harness's tenant domains do not pass the format check, so this one is given a
        // domain that does before another company tries to take it.
        var takenDomain = $"taken{Guid.NewGuid():N}"[..13] + ".com";
        await _harness.WithDbAsync(async db =>
        {
            var company = await db.Companies.SingleAsync(c => c.Id == _companyId);
            company.EmailDomain = takenDomain;
            await db.SaveChangesAsync();
        });
        var otherId = await _harness.SeedCompanyAsync("Other Domain Co");

        await AssertRefusalAsync(
            await super.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest("Bad Co", "not a domain", "technology", "small", "CR", null)),
            HttpStatusCode.BadRequest,
            "company_domain_invalid",
            "Invalid domain format: not a domain");

        await AssertRefusalAsync(
            await super.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest("Dup Co", takenDomain, "technology", "small", "CR", null)),
            HttpStatusCode.Conflict,
            "company_domain_taken",
            $"Domain already exists: {takenDomain}");

        await AssertRefusalAsync(
            await super.PutAsJsonAsync($"/admin/companies/{otherId}", new UpdateCompanyRequest(null, "not a domain", null, null, null, null)),
            HttpStatusCode.BadRequest,
            "company_domain_invalid",
            "Invalid domain format: not a domain");

        await AssertRefusalAsync(
            await super.PutAsJsonAsync($"/admin/companies/{otherId}", new UpdateCompanyRequest(null, takenDomain, null, null, null, null)),
            HttpStatusCode.Conflict,
            "company_domain_taken",
            "Domain already exists");
    }

    // ------------------------------------------------------------------
    // Survey authoring, schedule and lifecycle
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_window_that_ends_before_it_starts_is_refused_with_its_code_on_create_update_and_duplicate()
    {
        var admin = await AdminAsync();
        var now = DateTimeOffset.UtcNow;

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(_companyId) with { StartDate = now.AddDays(5), EndDate = now.AddDays(1) }),
            HttpStatusCode.BadRequest,
            "survey_dates_out_of_order",
            "StartDate must be before EndDate");

        var (_, surveyId) = await SurveyAsync();
        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(EndDate: now.AddDays(-30))),
            HttpStatusCode.BadRequest,
            "survey_dates_out_of_order",
            "StartDate must be before EndDate");

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync($"/surveys/{surveyId}/duplicate", new DuplicateSurveyRequest(StartDate: now.AddDays(5), EndDate: now.AddDays(1))),
            HttpStatusCode.BadRequest,
            "survey_dates_out_of_order",
            "StartDate must be before EndDate");
    }

    [Fact]
    public async Task Editing_the_questions_of_a_live_survey_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync(SurveyStatuses.Active);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: SurveyTestHarness.MinimalRequest(_companyId).Questions)),
            HttpStatusCode.Conflict,
            "survey_content_locked",
            "A survey in status 'active' cannot have its content edited. Duplicate it instead -- the copy keeps every option's stable value, so its responses still aggregate with this one's.");
    }

    [Fact]
    public async Task Editing_the_questions_of_a_draft_that_has_responses_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync();
        await _harness.SeedResponseAsync(surveyId, _companyId, null);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: SurveyTestHarness.MinimalRequest(_companyId).Questions)),
            HttpStatusCode.Conflict,
            "survey_content_has_responses",
            "This survey already has responses; its content can no longer be edited.");
    }

    [Fact]
    public async Task Rescheduling_a_closed_survey_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync(SurveyStatuses.Closed);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(EndDate: DateTimeOffset.UtcNow.AddDays(30))),
            HttpStatusCode.Conflict,
            "survey_schedule_frozen",
            "A survey in status 'closed' can no longer be rescheduled.");
    }

    [Fact]
    public async Task Moving_the_start_of_a_live_survey_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync(SurveyStatuses.Active);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(StartDate: DateTimeOffset.UtcNow.AddDays(-7))),
            HttpStatusCode.Conflict,
            "survey_start_frozen",
            "StartDate cannot be changed once the survey is active.");
    }

    [Fact]
    public async Task Returning_an_answered_survey_to_draft_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync(SurveyStatuses.Scheduled);
        await _harness.SeedResponseAsync(surveyId, _companyId, null);

        await AssertRefusalAsync(
            await SurveyTestHarness.SetStatusAsync(admin, surveyId, SurveyStatuses.Draft),
            HttpStatusCode.Conflict,
            "survey_revert_has_responses",
            "This survey has responses, so it cannot return to 'draft' where its content would be editable. "
            + "Duplicate it instead -- the copy keeps every option's stable value, so its responses still aggregate with this one's.");
    }

    [Fact]
    public async Task Publishing_a_survey_with_no_questions_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync(request: SurveyTestHarness.MinimalRequest(_companyId, questions: []));

        await AssertRefusalAsync(
            await SurveyTestHarness.SetStatusAsync(admin, surveyId, SurveyStatuses.Active),
            HttpStatusCode.BadRequest,
            "survey_no_questions",
            "Cannot publish a survey with no questions.");
    }

    [Fact]
    public async Task Publishing_a_bilingual_survey_with_a_missing_translation_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync(request: SurveyTestHarness.MinimalRequest(
            _companyId,
            language: ContentLanguages.Both,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "How are you feeling?", ["es"] = null }),
                    "open_ended",
                    Order: 0),
            ]));

        var response = await SurveyTestHarness.SetStatusAsync(admin, surveyId, SurveyStatuses.Active);

        // The message is ContentPublishValidation.Describe over the list the same body carries.
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var missing = body.RootElement.GetProperty("missingTranslations").EnumerateArray()
            .Select(m => $"{m.GetProperty("field").GetString()} ({m.GetProperty("locale").GetString()})")
            .ToList();
        Assert.NotEmpty(missing);
        await AssertRefusalAsync(
            response,
            HttpStatusCode.BadRequest,
            "survey_missing_translations",
            $"Cannot publish: {missing.Count} translation(s) missing -- {string.Join(", ", missing)}");
    }

    [Fact]
    public async Task Deleting_an_answered_survey_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync();
        await _harness.SeedResponseAsync(surveyId, _companyId, null);

        await AssertRefusalAsync(
            await admin.DeleteAsync($"/surveys/{surveyId}"),
            HttpStatusCode.Conflict,
            "survey_delete_has_responses",
            "This survey has responses and cannot be deleted. Archive it instead.");
    }

    [Fact]
    public async Task A_question_with_no_text_is_refused_with_its_code()
    {
        var admin = await AdminAsync();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
                _companyId, questions: [new CreateSurveyQuestionInput(null, "open_ended", Order: 0)])),
            HttpStatusCode.BadRequest,
            "question_text_required",
            "Question 0 requires text");

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
                _companyId, questions: [new CreateSurveyQuestionInput(LocalizedInput.FromBare("  "), "open_ended", Order: 0)])),
            HttpStatusCode.BadRequest,
            "question_text_required",
            "Question 0 requires text");
    }

    [Fact]
    public async Task A_multiple_choice_question_with_a_repeated_or_a_single_option_is_refused_with_its_code()
    {
        var admin = await AdminAsync();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
                _companyId,
                questions:
                [
                    new CreateSurveyQuestionInput(
                        LocalizedInput.FromBare("Pick one"),
                        QuestionTypes.MultipleChoice,
                        [new CreateSurveyQuestionOptionInput("a", LocalizedInput.FromBare("A")), new CreateSurveyQuestionOptionInput("a", LocalizedInput.FromBare("Also A"))],
                        Order: 0),
                ])),
            HttpStatusCode.BadRequest,
            "question_option_duplicate",
            "Question 0 has duplicate option value 'a'");

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/surveys", SurveyTestHarness.MinimalRequest(
                _companyId,
                questions:
                [
                    new CreateSurveyQuestionInput(
                        LocalizedInput.FromBare("Pick one"),
                        QuestionTypes.MultipleChoice,
                        [new CreateSurveyQuestionOptionInput("a", LocalizedInput.FromBare("A"))],
                        Order: 0),
                ])),
            HttpStatusCode.BadRequest,
            "question_options_too_few",
            "Question 0: multiple_choice questions require at least 2 options");
    }

    // ------------------------------------------------------------------
    // Survey distribution
    // ------------------------------------------------------------------

    [Fact]
    public async Task Inviting_people_to_a_draft_is_refused_with_its_code()
    {
        var (admin, surveyId) = await SurveyAsync();

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync($"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true)),
            HttpStatusCode.Conflict,
            "survey_not_distributable",
            "A survey in status 'draft' cannot be distributed. "
            + $"Publish it first via PUT /surveys/{{id}}/status ({string.Join(" or ", SurveyStatuses.RespondentVisible)}).");
    }

    [Fact]
    public async Task Inviting_people_after_the_window_closed_is_refused_with_its_code()
    {
        var now = DateTimeOffset.UtcNow;
        var (admin, surveyId) = await SurveyAsync(
            SurveyStatuses.Active,
            SurveyTestHarness.MinimalRequest(_companyId) with { StartDate = now.AddDays(-10), EndDate = now.AddDays(-1) });

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync($"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true)),
            HttpStatusCode.Conflict,
            "survey_window_closed",
            "This survey's response window has already closed; there is nothing to invite anyone to.");
    }

    [Fact]
    public async Task Reminders_on_a_survey_that_turned_them_off_are_refused_with_their_code()
    {
        var (admin, surveyId) = await SurveyAsync(
            SurveyStatuses.Active,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(Anonymous: false, NotificationSendReminders: false),
            });

        await AssertRefusalAsync(
            await admin.PostAsync($"/surveys/{surveyId}/invitations/reminders", null),
            HttpStatusCode.Conflict,
            "survey_reminders_off",
            "This survey has notificationSendReminders turned off. Turn it on before sending reminders.");
    }

    [Fact]
    public async Task Reminders_on_a_survey_that_is_not_collecting_are_refused_with_their_code()
    {
        var (admin, surveyId) = await SurveyAsync(
            SurveyStatuses.Closed,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(Anonymous: false, NotificationSendReminders: true),
            });

        await AssertRefusalAsync(
            await admin.PostAsync($"/surveys/{surveyId}/invitations/reminders", null),
            HttpStatusCode.Conflict,
            "survey_not_collecting",
            "A survey in status 'closed' is not collecting responses; there is nothing to remind anyone about.");
    }

    // ------------------------------------------------------------------
    // Microclimates
    // ------------------------------------------------------------------

    private CreateMicroclimateRequest MicroclimateRequest(
        DateTimeOffset? start = null, DateTimeOffset? end = null, LocalizedInput? title = null, string language = "en") => new(
        title ?? LocalizedInput.FromBare("Pulse"),
        null,
        _companyId,
        start ?? DateTimeOffset.UtcNow.AddHours(1),
        end ?? DateTimeOffset.UtcNow.AddHours(3),
        TargetParticipantCount: 10,
        AnonymousResponses: true,
        TemplateId: null,
        Questions:
        [
            new CreateQuestionInput(
                language == ContentLanguages.Both
                    ? SurveyTestHarness.Both("How is the week going?", "¿Cómo va la semana?")
                    : LocalizedInput.FromBare("How is the week going?"),
                "open_ended",
                null,
                true,
                1),
        ],
        Language: language);

    private async Task<(HttpClient Admin, Guid Id)> MicroclimateAsync(CreateMicroclimateRequest? request = null)
    {
        var admin = await AdminAsync();
        var response = await admin.PostAsJsonAsync("/microclimates", request ?? MicroclimateRequest());
        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (admin, (await response.Content.ReadFromJsonAsync<MicroclimateDetail>())!.Id);
    }

    private Task SetMicroclimateAsync(Guid id, string status, DateTimeOffset? endTime = null)
        => _harness.WithDbAsync(async db =>
        {
            var row = await db.Microclimates.SingleAsync(m => m.Id == id);
            row.Status = status;
            if (endTime is { } end)
            {
                row.Scheduling.StartTime = end.AddHours(-2);
                row.Scheduling.EndTime = end;
            }

            await db.SaveChangesAsync();
        });

    [Fact]
    public async Task A_microclimate_window_out_of_order_is_refused_with_its_code_on_create_edit_and_content()
    {
        var admin = await AdminAsync();
        var now = DateTimeOffset.UtcNow;

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync("/microclimates", MicroclimateRequest(now.AddHours(5), now.AddHours(1))),
            HttpStatusCode.BadRequest,
            "microclimate_window_out_of_order",
            MicroclimateEndpoints.WindowOutOfOrderMessage);

        var (_, id) = await MicroclimateAsync();
        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/microclimates/{id}", new UpdateMicroclimateRequest(null, null, null, now.AddMinutes(1))),
            HttpStatusCode.BadRequest,
            "microclimate_window_out_of_order",
            MicroclimateEndpoints.WindowOutOfOrderMessage);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync(
                $"/microclimates/{id}/content",
                new ReplaceMicroclimateContentRequest("Pulse", null, now.AddHours(5), now.AddHours(1), 10, true, [new CreateQuestionInput("How?", "open_ended", null, true, 1)])),
            HttpStatusCode.BadRequest,
            "microclimate_window_out_of_order",
            MicroclimateEndpoints.WindowOutOfOrderMessage);
    }

    [Fact]
    public async Task Extending_a_closed_microclimate_is_refused_with_its_code()
    {
        var (admin, id) = await MicroclimateAsync();
        await SetMicroclimateAsync(id, MicroclimateStatuses.Closed);

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync($"/microclimates/{id}", new UpdateMicroclimateRequest(null, null, null, DateTimeOffset.UtcNow.AddDays(1))),
            HttpStatusCode.Conflict,
            "microclimate_closed_window",
            MicroclimateEndpoints.ClosedWindowEditMessage);
    }

    [Fact]
    public async Task Replacing_or_discarding_a_launched_microclimate_is_refused_with_its_code()
    {
        var (admin, id) = await MicroclimateAsync();
        await SetMicroclimateAsync(id, MicroclimateStatuses.Active);
        var now = DateTimeOffset.UtcNow;

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync(
                $"/microclimates/{id}/content",
                new ReplaceMicroclimateContentRequest("Pulse", null, now.AddHours(1), now.AddHours(3), 10, true, [new CreateQuestionInput("How?", "open_ended", null, true, 1)])),
            HttpStatusCode.Conflict,
            "microclimate_not_draft",
            MicroclimateEndpoints.NotADraftMessage);

        await AssertRefusalAsync(
            await admin.DeleteAsync($"/microclimates/{id}"),
            HttpStatusCode.Conflict,
            "microclimate_not_draft",
            MicroclimateEndpoints.NotADraftMessage);
    }

    [Fact]
    public async Task Activating_a_microclimate_whose_window_is_over_is_refused_with_its_code()
    {
        var (admin, id) = await MicroclimateAsync();
        var end = DateTimeOffset.UtcNow.AddHours(-1);
        await SetMicroclimateAsync(id, MicroclimateStatuses.Draft, end);
        var stored = await _harness.WithDbAsync(db => db.Microclimates.Where(m => m.Id == id).Select(m => m.Scheduling.EndTime).SingleAsync());

        await AssertRefusalAsync(
            await admin.PostAsync($"/microclimates/{id}/activate", null),
            HttpStatusCode.BadRequest,
            "microclimate_window_elapsed",
            MicroclimateEndpoints.WindowAlreadyOverMessage(stored));
    }

    [Fact]
    public async Task Activating_a_bilingual_microclimate_with_a_missing_translation_is_refused_with_its_code()
    {
        // Create refuses a half-authored bilingual title, so the Spanish half is removed
        // afterwards -- the shape a draft saved mid-translation has.
        var (admin, id) = await MicroclimateAsync(MicroclimateRequest(
            title: SurveyTestHarness.Both("Pulse", "Pulso"),
            language: ContentLanguages.Both));
        await _harness.WithDbAsync(async db =>
        {
            var row = await db.Microclimates.SingleAsync(m => m.Id == id);
            row.TitleEs = null;
            await db.SaveChangesAsync();
        });

        var response = await admin.PostAsync($"/microclimates/{id}/activate", null);

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var missing = body.RootElement.GetProperty("missingTranslations").EnumerateArray()
            .Select(m => $"{m.GetProperty("field").GetString()} ({m.GetProperty("locale").GetString()})")
            .ToList();
        Assert.NotEmpty(missing);
        await AssertRefusalAsync(
            response,
            HttpStatusCode.BadRequest,
            "microclimate_missing_translations",
            $"Cannot publish: {missing.Count} translation(s) missing -- {string.Join(", ", missing)}");
    }

    [Fact]
    public async Task Inviting_people_to_a_microclimate_whose_window_closed_is_refused_with_its_code()
    {
        var (admin, id) = await MicroclimateAsync();
        await SetMicroclimateAsync(id, MicroclimateStatuses.Active, DateTimeOffset.UtcNow.AddMinutes(-5));

        await AssertRefusalAsync(
            await admin.PostAsJsonAsync($"/microclimates/{id}/invitations", new CreateMicroclimateInvitationsRequest(AllCompanyUsers: true)),
            HttpStatusCode.Conflict,
            "microclimate_invite_window_closed",
            "This microclimate's response window has already closed; there is nothing to invite anyone to.");
    }

    // ------------------------------------------------------------------
    // Reports
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_report_schedule_that_starts_in_the_past_is_refused_with_its_code()
    {
        var admin = await AdminAsync();
        var created = await admin.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Monthly Climate Report", null, "climate_summary", _companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var report = (await created.Content.ReadFromJsonAsync<ReportDetail>())!;

        await AssertRefusalAsync(
            await admin.PutAsJsonAsync(
                $"/admin/reports/{report.Id}/schedule",
                new SetReportScheduleRequest("monthly", DateTimeOffset.UtcNow.AddHours(-1))),
            HttpStatusCode.BadRequest,
            "report_schedule_start_past",
            "The first occurrence must be in the future.");
    }
}
