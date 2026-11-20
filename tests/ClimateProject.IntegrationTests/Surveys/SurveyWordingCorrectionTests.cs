using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// «Corregir redacción» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>,
/// ruling 2): on a survey that already has answers a super admin may change a question's words --
/// text, comment prompt, scale and option labels -- and nothing else. Every other difference is a
/// 409 naming the field. The correction is a new version and is audited; the live-edit refusal
/// for everything else, and for company admins, stays.
/// </summary>
[Collection("Postgres")]
public class SurveyWordingCorrectionTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyWordingCorrectionTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"wording-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Redaccion SA");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Ventas");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static List<CreateSurveyQuestionInput> Questions() =>
    [
        new(LocalizedInput.FromBare("How clear are your goals?"), QuestionTypes.Likert, ScaleMin: 1, ScaleMax: 5,
            ScaleLabelMin: LocalizedInput.FromBare("Not at all"), ScaleLabelMax: LocalizedInput.FromBare("Completly"),
            Required: true, Order: 0, Category: "leadership"),
        new(LocalizedInput.FromBare("Where do you work?"), QuestionTypes.MultipleChoice,
            Options:
            [
                new CreateSurveyQuestionOptionInput("remote", LocalizedInput.FromBare("Remot")),
                new CreateSurveyQuestionOptionInput("office", LocalizedInput.FromBare("Office")),
            ],
            Required: true, Order: 1, CommentPrompt: LocalizedInput.FromBare("Tell us mor"), CommentRequired: false),
        new(LocalizedInput.FromBare("Is there any coment?"), QuestionTypes.OpenEnded, Order: 2),
    ];

    /// <summary>Live, published by the screen's route (so version 1 exists), and answered once by a real submit.</summary>
    private async Task<SurveyDetail> AnsweredSurveyAsync()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(_companyId, questions: Questions()));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var employee = await _harness.ClientAsync(Roles.Employee, _companyId, _departmentId);
        (await employee.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers:
            [
                new SurveyAnswerInput(survey.Questions[0].Id, "4"),
                new SurveyAnswerInput(survey.Questions[1].Id, "remote"),
            ]))).EnsureSuccessStatusCode();
        return survey;
    }

    private Task<HttpClient> OperatorAsync() => _harness.ClientAsync(Roles.SuperAdmin, null);

    /// <summary>The survey's questions exactly as stored, in the editor's shape: the request that changes nothing.</summary>
    private static List<SurveyWordingQuestionInput> AsStored(SurveyDetail survey)
        => survey.Questions
            .OrderBy(q => q.Order)
            .Select(q => new SurveyWordingQuestionInput(
                q.Id,
                q.Type,
                LocalizedInput.FromBare(q.Text ?? string.Empty),
                q.Options?.Select(o => new SurveyWordingOptionInput(o.Value, LocalizedInput.FromBare(o.Label ?? string.Empty))).ToList(),
                q.ScaleMin,
                q.ScaleMax,
                q.ScaleLabelMin is null ? null : LocalizedInput.FromBare(q.ScaleLabelMin),
                q.ScaleLabelMax is null ? null : LocalizedInput.FromBare(q.ScaleLabelMax),
                q.Required,
                q.CommentRequired,
                q.CommentPrompt is null ? null : LocalizedInput.FromBare(q.CommentPrompt),
                q.Order,
                q.Category,
                q.KeepAtEnd))
            .ToList();

    private static Task<HttpResponseMessage> CorrectAsync(HttpClient client, Guid surveyId, List<SurveyWordingQuestionInput> questions)
        => client.PutAsJsonAsync($"/surveys/{surveyId}/wording", new SurveyWordingRequest(questions));

    private static async Task<JsonElement> BodyAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.Clone();
    }

    private static async Task<SurveyDetail> DetailAsync(HttpClient client, Guid surveyId)
        => (await client.GetFromJsonAsync<SurveyDetail>($"/surveys/{surveyId}"))!;

    // ------------------------------------------------------------------
    // The words change; nothing an answer points at does
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_operator_corrects_the_words_of_an_answered_survey_and_it_is_a_new_audited_version()
    {
        var survey = await AnsweredSurveyAsync();
        var op = await OperatorAsync();
        var questions = AsStored(survey);
        questions[0] = questions[0] with { ScaleLabelMax = LocalizedInput.FromBare("Completely") };
        questions[1] = questions[1] with
        {
            Options = [new SurveyWordingOptionInput("remote", LocalizedInput.FromBare("Remote")), questions[1].Options![1]],
            CommentPrompt = LocalizedInput.FromBare("Tell us more"),
        };
        questions[2] = questions[2] with { Text = LocalizedInput.FromBare("Is there any comment?") };

        var response = await CorrectAsync(op, survey.Id, questions);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyWordingResult>())!;
        Assert.Equal(3, result.ChangedQuestionIds.Count);
        Assert.Equal(2, result.Version);

        var after = await DetailAsync(op, survey.Id);
        // Same rows: the answers already stored still point at every one of them.
        Assert.Equal(survey.Questions.Select(q => q.Id).Order(), after.Questions.Select(q => q.Id).Order());
        var byId = after.Questions.ToDictionary(q => q.Id);
        Assert.Equal("Completely", byId[survey.Questions[0].Id].ScaleLabelMax);
        Assert.Equal("Remote", byId[survey.Questions[1].Id].Options!.Single(o => o.Value == "remote").Label);
        Assert.Equal(["remote", "office"], byId[survey.Questions[1].Id].Options!.Select(o => o.Value));
        Assert.Equal("Tell us more", byId[survey.Questions[1].Id].CommentPrompt);
        Assert.Equal("Is there any comment?", byId[survey.Questions[2].Id].Text);

        await _harness.WithDbAsync(async db =>
        {
            var answers = await db.QuestionResponses.AsNoTracking()
                .Where(a => db.Responses.Any(r => r.Id == a.ResponseId && r.SurveyId == survey.Id))
                .ToListAsync();
            Assert.Equal(2, answers.Count);
            Assert.All(answers, a => Assert.Contains(a.QuestionId, byId.Keys));

            Assert.Equal(2, await db.SurveyVersions.CountAsync(v => v.SurveyId == survey.Id));
            Assert.Equal(2, (await db.Surveys.AsNoTracking().SingleAsync(s => s.Id == survey.Id)).Version);
            Assert.True(await db.SurveyAuditLogs.AnyAsync(a => a.SurveyId == survey.Id && a.Action == SurveyAuditActions.Updated));

            var audit = await db.AuditLogs.AsNoTracking().SingleAsync(a => a.Action == "surveys.wording.update" && a.ResourceId == survey.Id.ToString());
            Assert.True(audit.Success);
            Assert.Equal(_companyId, audit.CompanyId);
            Assert.NotNull(audit.UserId);
        });
    }

    [Fact]
    public async Task Resending_the_words_as_they_are_writes_no_version()
    {
        var survey = await AnsweredSurveyAsync();
        var op = await OperatorAsync();

        var response = await CorrectAsync(op, survey.Id, AsStored(survey));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.Content.ReadFromJsonAsync<SurveyWordingResult>())!.ChangedQuestionIds);
        Assert.Equal(1, await _harness.WithDbAsync(db => db.SurveyVersions.CountAsync(v => v.SurveyId == survey.Id)));
    }

    // ------------------------------------------------------------------
    // Anything that is not a word is refused, naming the field
    // ------------------------------------------------------------------

    public static TheoryData<string> StructuralFields() =>
    [
        "type", "order", "category", "required", "commentRequired", "keepAtEnd", "scaleMin", "scaleMax",
        "options.value", "options.count", "options.order", "commentPrompt",
    ];

    [Theory]
    [MemberData(nameof(StructuralFields))]
    public async Task A_change_that_is_not_wording_is_refused_naming_the_field_and_nothing_moves(string change)
    {
        var survey = await AnsweredSurveyAsync();
        var op = await OperatorAsync();
        var questions = AsStored(survey);
        var likert = questions[0];
        var choice = questions[1];
        var open = questions[2];
        var expectedField = change.StartsWith("options", StringComparison.Ordinal) ? "options" : change;
        switch (change)
        {
            case "type": questions[0] = likert with { Type = QuestionTypes.Rating }; break;
            case "order": questions[0] = likert with { Order = 7 }; break;
            case "category": questions[0] = likert with { Category = "workload" }; break;
            case "required": questions[0] = likert with { Required = false }; break;
            case "commentRequired": questions[0] = likert with { CommentRequired = !likert.CommentRequired }; break;
            case "keepAtEnd": questions[0] = likert with { KeepAtEnd = true }; break;
            case "scaleMin": questions[0] = likert with { ScaleMin = 0 }; break;
            case "scaleMax": questions[0] = likert with { ScaleMax = 7 }; break;
            case "options.value": questions[1] = choice with { Options = [choice.Options![0] with { Value = "home" }, choice.Options[1]] }; break;
            case "options.count": questions[1] = choice with { Options = [.. choice.Options!, new SurveyWordingOptionInput("field", LocalizedInput.FromBare("Field"))] }; break;
            case "options.order": questions[1] = choice with { Options = [choice.Options![1], choice.Options[0]] }; break;
            // A prompt where there was none adds a comment box: something asked, not a word.
            case "commentPrompt": questions[2] = open with { CommentPrompt = LocalizedInput.FromBare("Why?") }; break;
            default: throw new ArgumentOutOfRangeException(nameof(change));
        }

        var response = await CorrectAsync(op, survey.Id, questions);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await BodyAsync(response);
        Assert.Equal(AdminRefusals.SurveyWordingStructureChanged, body.GetProperty("code").GetString());
        Assert.Equal(expectedField, body.GetProperty("field").GetString());
        Assert.Equal(1, await _harness.WithDbAsync(db => db.SurveyVersions.CountAsync(v => v.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task A_question_left_out_or_added_is_refused()
    {
        var survey = await AnsweredSurveyAsync();
        var op = await OperatorAsync();
        var questions = AsStored(survey);

        var shorter = await CorrectAsync(op, survey.Id, questions.Take(2).ToList());
        var foreign = await CorrectAsync(op, survey.Id, [.. questions.Take(2), questions[2] with { Id = Guid.NewGuid() }]);

        Assert.Equal(HttpStatusCode.Conflict, shorter.StatusCode);
        Assert.Equal(AdminRefusals.SurveyWordingQuestionsMismatch, (await BodyAsync(shorter)).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.Conflict, foreign.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_may_not_correct_wording_and_the_live_edit_refusal_stays()
    {
        var survey = await AnsweredSurveyAsync();
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var questions = AsStored(survey);
        questions[2] = questions[2] with { Text = LocalizedInput.FromBare("Is there any comment?") };

        var wording = await CorrectAsync(admin, survey.Id, questions);
        var fullEdit = await (await OperatorAsync()).PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(Questions: Questions()));

        Assert.Equal(HttpStatusCode.Forbidden, wording.StatusCode);
        Assert.Equal(AdminRefusals.SurveyWordingSuperAdminOnly, (await BodyAsync(wording)).GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.Conflict, fullEdit.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentHasResponses, (await BodyAsync(fullEdit)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task An_archived_survey_is_refused()
    {
        var survey = await AnsweredSurveyAsync();
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Archived);

        var response = await CorrectAsync(await OperatorAsync(), survey.Id, AsStored(survey));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(AdminRefusals.SurveyContentLocked, (await BodyAsync(response)).GetProperty("code").GetString());
    }
}
