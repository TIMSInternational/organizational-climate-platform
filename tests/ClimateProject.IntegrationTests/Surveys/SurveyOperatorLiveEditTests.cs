using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// A TIMS operator editing a survey that has left draft (ruled 2026-11-11,
/// <c>docs/decisions/operators-edit-a-live-survey.md</c>): super admins only; the title and the
/// description always, short of archived; the questions only while the survey is scheduled or
/// active and not one response row exists. Every effective edit writes the next version, so a
/// response still resolves to the content it was given.
/// </summary>
[Collection("Postgres")]
public class SurveyOperatorLiveEditTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyOperatorLiveEditTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"live-edit-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Live Edit Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Operations");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> CompanyAdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    /// <summary>Homed in a company, as Audrey is.</summary>
    private Task<HttpClient> OperatorAsync() => _harness.ClientAsync(Roles.SuperAdmin, _companyId);

    /// <summary>A survey published the way the screen publishes it, so the publish snapshot exists.</summary>
    private async Task<Guid> LiveSurveyAsync(string? language = null)
    {
        var admin = await CompanyAdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId, language: language));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey.Id;
    }

    private static List<CreateSurveyQuestionInput> NewQuestions() =>
    [
        new(LocalizedInput.FromBare("What would you change first?"), "open_ended", Order: 0),
        new(LocalizedInput.FromBare("How clear are your goals?"), "likert", ScaleMin: 1, ScaleMax: 5, Order: 1),
    ];

    private static async Task<string?> CodeOfAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static async Task<SurveyVersionListResponse> VersionsAsync(HttpClient client, Guid surveyId)
    {
        var response = await client.GetAsync($"/surveys/{surveyId}/versions");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyVersionListResponse>())!;
    }

    private static async Task<SurveyDetail> DetailAsync(HttpClient client, Guid surveyId)
        => (await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{surveyId}"))!;

    // ------------------------------------------------------------------
    // While nobody has answered: name, description and questions
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_operator_renames_a_live_survey_and_the_rename_is_a_new_version()
    {
        var surveyId = await LiveSurveyAsync();
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(
            Title: LocalizedInput.FromBare("Q3 Climate Survey 2026"),
            Description: LocalizedInput.FromBare("Your answers are anonymous.")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await DetailAsync(op, surveyId);
        Assert.Equal("Q3 Climate Survey 2026", detail.Title);
        Assert.Equal("Your answers are anonymous.", detail.Description);
        Assert.Equal(SurveyStatuses.Active, detail.Status);

        var versions = await VersionsAsync(op, surveyId);
        Assert.Equal(2, versions.Versions.Count);
        Assert.Equal(2, versions.CurrentVersion);
        var latest = versions.Versions.Single(v => v.VersionNumber == 2);
        Assert.Equal(SurveyVersionReasons.Republish, latest.Reason);
        Assert.Equal("Q3 Climate Survey 2026", latest.Title);
        Assert.Equal("Q3 Climate Survey", versions.Versions.Single(v => v.VersionNumber == 1).Title);
    }

    [Fact]
    public async Task An_operator_rewrites_the_questions_of_a_live_survey_nobody_has_answered()
    {
        var surveyId = await LiveSurveyAsync();
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: NewQuestions()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await DetailAsync(op, surveyId);
        Assert.Equal(
            new List<string?> { "What would you change first?", "How clear are your goals?" },
            detail.Questions.Select(q => q.Text).ToList());
        Assert.Equal(SurveyStatuses.Active, detail.Status);

        // The version a response now resolves to holds the NEW questions.
        var current = await op.GetFromJsonAsync<SurveyVersionDetail>($"/surveys/{surveyId}/versions/{(await VersionsAsync(op, surveyId)).Versions.Single(v => v.VersionNumber == 2).Id}");
        Assert.Equal(2, current!.Questions.Count);
    }

    [Fact]
    public async Task A_company_less_operator_can_rename_a_live_survey_too()
    {
        // Federico's account has no company; the audit row is filed under the survey's.
        var surveyId = await LiveSurveyAsync();
        var op = await _harness.ClientAsync(Roles.SuperAdmin, null);

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Renamed")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Renamed", (await DetailAsync(op, surveyId)).Title);
    }

    [Fact]
    public async Task Resending_the_same_title_writes_no_version()
    {
        var surveyId = await LiveSurveyAsync();
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Q3 Climate Survey")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single((await VersionsAsync(op, surveyId)).Versions);
    }

    [Fact]
    public async Task A_scheduled_survey_takes_new_questions_from_an_operator()
    {
        var admin = await CompanyAdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId));
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Scheduled);
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(Questions: NewQuestions()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, (await DetailAsync(op, survey.Id)).Questions.Count);
    }

    // ------------------------------------------------------------------
    // Once anybody has answered: name and description only
    // ------------------------------------------------------------------

    [Fact]
    public async Task Questions_stay_frozen_once_a_response_exists()
    {
        var surveyId = await LiveSurveyAsync();
        await _harness.SeedResponseAsync(surveyId, _companyId, null, isComplete: false);
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: NewQuestions()));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentHasResponses, await CodeOfAsync(response));
        Assert.Equal("How are you feeling?", Assert.Single((await DetailAsync(op, surveyId)).Questions).Text);
        Assert.Single((await VersionsAsync(op, surveyId)).Versions);
    }

    [Fact]
    public async Task An_excluded_response_still_freezes_the_questions()
    {
        // Excluded from the results, still stored against these questions.
        var surveyId = await LiveSurveyAsync();
        await _harness.SeedResponseAsync(surveyId, _companyId, null);
        await _harness.WithDbAsync(async db =>
        {
            var row = await db.Responses.IgnoreQueryFilters(ResponseQueryFilters.IncludeExcluded).FirstAsync(r => r.SurveyId == surveyId);
            row.ExcludedAt = DateTimeOffset.UtcNow;
            var survey = await db.Surveys.FirstAsync(s => s.Id == surveyId);
            survey.ResponseCount = 0;
            await db.SaveChangesAsync();
        });
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: NewQuestions()));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentHasResponses, await CodeOfAsync(response));
    }

    [Fact]
    public async Task The_name_of_a_survey_with_responses_can_still_be_corrected()
    {
        var surveyId = await LiveSurveyAsync();
        await _harness.SeedResponseAsync(surveyId, _companyId, null);
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Q3 Climate Survey (corrected)")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await DetailAsync(op, surveyId);
        Assert.Equal("Q3 Climate Survey (corrected)", detail.Title);
        Assert.Equal("How are you feeling?", Assert.Single(detail.Questions).Text);
    }

    [Fact]
    public async Task A_closed_survey_takes_a_new_description_but_not_new_questions()
    {
        var surveyId = await LiveSurveyAsync();
        await _harness.ForceStatusAsync(surveyId, SurveyStatuses.Closed);
        var op = await OperatorAsync();

        var described = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Description: LocalizedInput.FromBare("Closed on time.")));
        var rewritten = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: NewQuestions()));

        Assert.Equal(HttpStatusCode.OK, described.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, rewritten.StatusCode);
        Assert.Equal(AdminRefusals.SurveyLiveEditOutOfScope, await CodeOfAsync(rewritten));
        Assert.Equal("How are you feeling?", Assert.Single((await DetailAsync(op, surveyId)).Questions).Text);
    }

    // ------------------------------------------------------------------
    // What never moves outside draft, and who may not
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(nameof(UpdateSurveyRequest.Type))]
    [InlineData(nameof(UpdateSurveyRequest.Language))]
    [InlineData(nameof(UpdateSurveyRequest.DepartmentIds))]
    [InlineData("Anonymous")]
    public async Task Type_language_departments_and_anonymity_stay_draft_only_even_for_an_operator(string field)
    {
        var surveyId = await LiveSurveyAsync();
        var op = await OperatorAsync();
        var request = field switch
        {
            nameof(UpdateSurveyRequest.Type) => new UpdateSurveyRequest(Type: "exit_interview"),
            nameof(UpdateSurveyRequest.Language) => new UpdateSurveyRequest(Language: ContentLanguages.Both),
            nameof(UpdateSurveyRequest.DepartmentIds) => new UpdateSurveyRequest(DepartmentIds: [_departmentId]),
            _ => new UpdateSurveyRequest(Settings: new SurveySettingsInput(Anonymous: true)),
        };

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", request);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyLiveEditOutOfScope, await CodeOfAsync(response));
    }

    [Fact]
    public async Task An_archived_survey_is_not_edited_even_by_an_operator()
    {
        var surveyId = await LiveSurveyAsync();
        await _harness.ForceStatusAsync(surveyId, SurveyStatuses.Archived);
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Renamed")));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentLocked, await CodeOfAsync(response));
    }

    [Fact]
    public async Task The_clients_administrator_still_cannot_edit_a_live_survey()
    {
        var surveyId = await LiveSurveyAsync();
        var admin = await CompanyAdminAsync();

        var renamed = await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Title: LocalizedInput.FromBare("Renamed")));
        var rewritten = await admin.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: NewQuestions()));

        Assert.Equal(HttpStatusCode.Conflict, renamed.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentLocked, await CodeOfAsync(renamed));
        Assert.Equal(HttpStatusCode.Conflict, rewritten.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentLocked, await CodeOfAsync(rewritten));
        Assert.Equal("Q3 Climate Survey", (await DetailAsync(admin, surveyId)).Title);
    }

    // ------------------------------------------------------------------
    // The publish gate, held for content respondents already see
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_live_survey_cannot_be_left_without_questions()
    {
        var surveyId = await LiveSurveyAsync();
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: []));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyNoQuestions, await CodeOfAsync(response));
        Assert.Equal("How are you feeling?", Assert.Single((await DetailAsync(op, surveyId)).Questions).Text);
        Assert.Single((await VersionsAsync(op, surveyId)).Versions);
    }

    [Fact]
    public async Task An_edit_may_not_leave_a_live_bilingual_survey_untranslated()
    {
        var surveyId = await LiveSurveyAsync(ContentLanguages.Both);
        var op = await OperatorAsync();
        var englishOnly = LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Only in English" });

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions:
            [new CreateSurveyQuestionInput(englishOnly, "open_ended", Order: 0)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyMissingTranslations, await CodeOfAsync(response));
        var question = Assert.Single((await DetailAsync(op, surveyId)).Questions);
        Assert.Equal("How are you feeling?", question.Text);
    }

    [Fact]
    public async Task A_gap_that_predates_the_edit_does_not_block_a_title_fix()
    {
        var surveyId = await LiveSurveyAsync(ContentLanguages.Both);
        await _harness.WithDbAsync(async db =>
        {
            var question = await db.Questions.FirstAsync(q => q.SurveyId == surveyId);
            question.TextEs = string.Empty;
            await db.SaveChangesAsync();
        });
        var op = await OperatorAsync();

        var response = await op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(
            Title: SurveyTestHarness.Both("Q3 Climate Survey 2026", "Encuesta de clima Q3 2026")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // The race with a first answer
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_first_answer_being_written_holds_the_edit_back_and_then_refuses_it()
    {
        var surveyId = await LiveSurveyAsync();
        var op = await OperatorAsync();

        // A respondent's first save, caught mid-transaction: the response row is inserted (which
        // takes FOR KEY SHARE on the survey) but not committed. Read committed, the edit cannot
        // see it -- only the row lock can stop the edit replacing the questions under it.
        using var scope = _harness.Factory.Services.CreateScope();
        var respondentDb = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        await using var firstAnswer = await respondentDb.Database.BeginTransactionAsync();
        respondentDb.Responses.Add(new Response
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            CompanyId = _companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            Language = "en",
            IsComplete = false,
            StartTime = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await respondentDb.SaveChangesAsync();

        var edit = op.PutAsJsonAsync($"/surveys/{surveyId}", new UpdateSurveyRequest(Questions: NewQuestions()));
        var finishedWhileTheAnswerWasOpen = await Task.WhenAny(edit, Task.Delay(TimeSpan.FromSeconds(3))) == edit;
        await firstAnswer.CommitAsync();
        var response = await edit;

        Assert.False(finishedWhileTheAnswerWasOpen, $"The edit did not wait for the answer: {(int)response.StatusCode}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentHasResponses, await CodeOfAsync(response));
        Assert.Equal("How are you feeling?", Assert.Single((await DetailAsync(op, surveyId)).Questions).Text);
    }
}
