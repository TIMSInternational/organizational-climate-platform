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
/// «Mantener al final» (<c>Question.KeepAtEnd</c>, ruled 2026-11-18 at PROCOMER's request): the
/// flag travels everywhere a question's <c>Order</c> and <c>Category</c> travel -- create, the
/// admin read, the respondent's payload, the publish snapshot, a duplicate, and the operator's
/// live edit of a survey nobody has answered. The ORDER it implies is computed on the
/// respondent's side (<c>orderQuestions</c>); these tests prove the server never drops it on
/// the way there.
///
/// Every survey here marks exactly ONE of two questions, and asserts both: a mapping that
/// copied one question's flag onto every question, or that read the wrong question's, would
/// pass a check of the marked one alone.
/// </summary>
[Collection("Postgres")]
public class SurveyKeepAtEndTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyKeepAtEndTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"keep-at-end-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Keep At End Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Operations");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private Task<HttpClient> OperatorAsync() => _harness.ClientAsync(Roles.SuperAdmin, _companyId);

    /// <summary>The eNPS is authored FIRST and marked, so its place in the payload says nothing.</summary>
    private static List<CreateSurveyQuestionInput> Questions(bool markEnps) =>
    [
        new(LocalizedInput.FromBare("How likely are you to recommend this company?"), QuestionTypes.Rating,
            ScaleMin: 0, ScaleMax: 10, Order: 0, Category: "enps", KeepAtEnd: markEnps),
        new(LocalizedInput.FromBare("How clear are your goals?"), QuestionTypes.Likert,
            ScaleMin: 1, ScaleMax: 5, Order: 1, Category: "clarity"),
    ];

    private static void AssertOnlyTheEnpsIsKeptAtEnd(IReadOnlyList<SurveyQuestionDto> questions)
    {
        Assert.Equal(2, questions.Count);
        Assert.True(questions.Single(q => q.Category == "enps").KeepAtEnd);
        Assert.False(questions.Single(q => q.Category == "clarity").KeepAtEnd);
    }

    private static async Task<SurveyVersionDetail> VersionAsync(HttpClient client, Guid surveyId, int number)
    {
        var list = (await client.GetFromJsonAsync<SurveyVersionListResponse>($"/surveys/{surveyId}/versions"))!;
        var id = list.Versions.Single(v => v.VersionNumber == number).Id;
        return (await client.GetFromJsonAsync<SurveyVersionDetail>($"/surveys/{surveyId}/versions/{id}"))!;
    }

    [Fact]
    public async Task The_flag_round_trips_create_read_respond_snapshot_and_duplicate()
    {
        var admin = await AdminAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            _companyId, questions: Questions(markEnps: true), departmentIds: [_departmentId]));

        // Create: the create response, the admin read and the row itself.
        AssertOnlyTheEnpsIsKeptAtEnd(created.Questions);
        AssertOnlyTheEnpsIsKeptAtEnd((await admin.GetFromJsonAsync<SurveyDetail>($"/surveys/{created.Id}"))!.Questions);
        var stored = await _harness.WithDbAsync(db => db.Questions
            .Where(q => q.SurveyId == created.Id)
            .OrderBy(q => q.Order)
            .Select(q => q.KeepAtEnd)
            .ToListAsync());
        Assert.Equal([true, false], stored);

        // Publish writes the version every response resolves to; it must carry the flag.
        (await SurveyTestHarness.SetStatusAsync(admin, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        AssertOnlyTheEnpsIsKeptAtEnd((await VersionAsync(admin, created.Id, 1)).Questions);

        // The respondent's payload is what `orderQuestions` reads.
        var employee = await _harness.ClientAsync(Roles.Employee, _companyId, _departmentId);
        var view = (await employee.GetFromJsonAsync<SurveyRespondView>($"/surveys/{created.Id}/respond"))!;
        AssertOnlyTheEnpsIsKeptAtEnd(view.Questions);

        // Duplicate: PROCOMER's operator marks the copy, and a copy of the copy must keep it.
        var duplicate = await admin.PostAsJsonAsync($"/surveys/{created.Id}/duplicate", new DuplicateSurveyRequest());
        Assert.Equal(HttpStatusCode.Created, duplicate.StatusCode);
        var copy = (await duplicate.Content.ReadFromJsonAsync<SurveyDetail>())!;
        Assert.NotEqual(created.Id, copy.Id);
        AssertOnlyTheEnpsIsKeptAtEnd(copy.Questions);
        AssertOnlyTheEnpsIsKeptAtEnd((await admin.GetFromJsonAsync<SurveyDetail>($"/surveys/{copy.Id}"))!.Questions);
    }

    [Fact]
    public async Task A_questions_put_on_a_draft_sets_and_clears_the_flag()
    {
        var admin = await AdminAsync();
        var draft = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            _companyId, questions: Questions(markEnps: false)));
        Assert.All(draft.Questions, q => Assert.False(q.KeepAtEnd));

        var marked = await admin.PutAsJsonAsync($"/surveys/{draft.Id}", new UpdateSurveyRequest(Questions: Questions(markEnps: true)));
        Assert.Equal(HttpStatusCode.OK, marked.StatusCode);
        AssertOnlyTheEnpsIsKeptAtEnd((await admin.GetFromJsonAsync<SurveyDetail>($"/surveys/{draft.Id}"))!.Questions);

        // The PUT replaces the questions whole: a payload without the flag clears it, as
        // `Required` does. The editor sends it on every save for that reason.
        var cleared = await admin.PutAsJsonAsync($"/surveys/{draft.Id}", new UpdateSurveyRequest(Questions: Questions(markEnps: false)));
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.All((await admin.GetFromJsonAsync<SurveyDetail>($"/surveys/{draft.Id}"))!.Questions, q => Assert.False(q.KeepAtEnd));
    }

    /// <summary>
    /// The operator's live edit (<c>docs/decisions/operators-edit-a-live-survey.md</c>): a TIMS
    /// super admin marks the questions of an ACTIVE survey nobody has answered. The edit writes
    /// the next version, so the version a response would resolve to carries the flag, and the
    /// history names the change.
    /// </summary>
    [Fact]
    public async Task An_operator_marks_a_question_on_a_live_survey_nobody_has_answered()
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            _companyId, questions: Questions(markEnps: false)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var op = await OperatorAsync();
        var response = await op.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(Questions: Questions(markEnps: true)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await op.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}"))!;
        Assert.Equal(SurveyStatuses.Active, detail.Status);
        AssertOnlyTheEnpsIsKeptAtEnd(detail.Questions);

        var second = await VersionAsync(op, survey.Id, 2);
        Assert.Equal(SurveyVersionReasons.Republish, second.Reason);
        AssertOnlyTheEnpsIsKeptAtEnd(second.Questions);
        Assert.Equal(["questions[0].keepAtEnd"], second.Changes);
        Assert.All((await VersionAsync(op, survey.Id, 1)).Questions, q => Assert.False(q.KeepAtEnd));
    }

    /// <summary>The reason PROCOMER's DEMO must be duplicated first: once answered, the questions are fixed.</summary>
    [Fact]
    public async Task An_answered_live_survey_refuses_the_mark_and_keeps_its_questions()
    {
        var admin = await AdminAsync();
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            _companyId, questions: Questions(markEnps: false)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        await _harness.SeedResponseAsync(survey.Id, _companyId, userId: null);

        var op = await OperatorAsync();
        var response = await op.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(Questions: Questions(markEnps: true)));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.All((await op.GetFromJsonAsync<SurveyDetail>($"/surveys/{survey.Id}"))!.Questions, q => Assert.False(q.KeepAtEnd));
    }
}
