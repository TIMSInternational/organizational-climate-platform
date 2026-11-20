using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// «Registrar respuesta en papel» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>,
/// ruling 1): a super admin types a paper questionnaire from a roster row. It is stored exactly as
/// the person's own submission would be, the person shows as completed, their account is never
/// touched, and the audit log says TIMS entered it -- without, on an anonymous survey, naming the
/// response.
/// </summary>
[Collection("Postgres")]
public class PaperResponseTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public PaperResponseTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"paper-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Papel SA");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Operaciones");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static List<CreateSurveyQuestionInput> Questions() =>
    [
        new(LocalizedInput.FromBare("How clear are your goals?"), QuestionTypes.Likert, ScaleMin: 1, ScaleMax: 5, Required: true, Order: 0,
            CommentPrompt: LocalizedInput.FromBare("Why?"), CommentRequired: false),
        new(LocalizedInput.FromBare("Where do you work?"), QuestionTypes.MultipleChoice,
            Options:
            [
                new CreateSurveyQuestionOptionInput("remote", LocalizedInput.FromBare("Remote")),
                new CreateSurveyQuestionOptionInput("office", LocalizedInput.FromBare("Office")),
            ],
            Required: true, Order: 1),
        new(LocalizedInput.FromBare("Anything else?"), QuestionTypes.OpenEnded, Order: 2),
    ];

    private async Task<SurveyDetail> ActiveSurveyAsync(bool anonymous, string? serviceType = null)
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var request = SurveyTestHarness.MinimalRequest(_companyId, questions: Questions()) with
        {
            Settings = new SurveySettingsInput(Anonymous: anonymous),
            ServiceType = serviceType,
        };
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, request);
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey;
    }

    private static List<SurveyAnswerInput> Answers(SurveyDetail survey) =>
    [
        new(survey.Questions[0].Id, "4", Text: "Clear enough"),
        new(survey.Questions[1].Id, "office"),
        new(survey.Questions[2].Id, "More training"),
    ];

    private Task<HttpClient> OperatorAsync() => _harness.ClientAsync(Roles.SuperAdmin, null);

    private static Task<HttpResponseMessage> EnterAsync(HttpClient client, Guid surveyId, Guid userId, IReadOnlyList<SurveyAnswerInput> answers)
        => client.PostAsJsonAsync($"/surveys/{surveyId}/paper-responses/{userId}", new PaperResponseRequest(answers, "en"));

    private static async Task<string?> CodeOfAsync(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private async Task<string> RosterStatusAsync(Guid surveyId, Guid userId)
    {
        var op = await OperatorAsync();
        var view = (await op.GetFromJsonAsync<SurveyParticipationView>($"/surveys/{surveyId}/participation"))!;
        return view.Roster.Single(r => r.UserId == userId).Status;
    }

    private sealed record AccountState(string Email, string? PasswordHash, string? Username, bool IsActive, string Role, DateTimeOffset UpdatedAt, int Credentials);

    private Task<AccountState> AccountAsync(Guid userId) => _harness.WithDbAsync(async db =>
    {
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId);
        var credentials = await db.SurveyCredentials.AsNoTracking().CountAsync(c => c.UserId == userId);
        return new AccountState(user.Email, user.PasswordHash, user.Username, user.IsActive, user.Role, user.UpdatedAt, credentials);
    });

    // ------------------------------------------------------------------
    // Stored as the person's own submission
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_paper_entry_is_stored_field_by_field_as_the_persons_own_submit_would_be()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (ana, anaId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);

        // Ana answers on her own, signed in.
        var own = await ana.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: Answers(survey), SessionId: Guid.NewGuid().ToString("N"), IsComplete: true, Language: "en"));
        Assert.Equal(HttpStatusCode.Created, own.StatusCode);

        // TIMS types Beto's paper with the same answers.
        var op = await OperatorAsync();
        var paper = await EnterAsync(op, survey.Id, betoId, Answers(survey));
        Assert.Equal(HttpStatusCode.Created, paper.StatusCode);
        var result = (await paper.Content.ReadFromJsonAsync<PaperResponseResult>())!;
        Assert.Equal(SurveyParticipantStatuses.Completed, result.Status);
        // The response id is not handed back: on an anonymous survey it would be the join.
        Assert.DoesNotContain("responseId", await paper.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        await _harness.WithDbAsync(async db =>
        {
            var rows = await db.Responses.AsNoTracking().Where(r => r.SurveyId == survey.Id).ToListAsync();
            var real = rows.Single(r => r.UserId == anaId);
            var entered = rows.Single(r => r.UserId == betoId);

            Assert.Equal(real.CompanyId, entered.CompanyId);
            Assert.Equal(real.IsAnonymous, entered.IsAnonymous);
            Assert.Equal(real.IsComplete, entered.IsComplete);
            Assert.Equal(real.Language, entered.Language);
            Assert.Equal(real.DepartmentId, entered.DepartmentId);
            Assert.Equal(_departmentId, entered.DepartmentId);
            Assert.Equal(real.ExcludedAt, entered.ExcludedAt);
            Assert.Equal(real.CompletionTime is null, entered.CompletionTime is null);
            Assert.Equal(real.TotalTimeSeconds is null, entered.TotalTimeSeconds is null);
            // The operator's device is not the person's: neither is recorded for a paper entry.
            Assert.Null(entered.IpAddress);
            Assert.Null(entered.UserAgent);

            var answers = await db.QuestionResponses.AsNoTracking()
                .Where(q => q.ResponseId == real.Id || q.ResponseId == entered.Id)
                .ToListAsync();
            var realAnswers = answers.Where(a => a.ResponseId == real.Id)
                .OrderBy(a => a.QuestionId).Select(a => (a.QuestionId, a.ResponseValue, a.ResponseText, a.TimeSpentSeconds)).ToList();
            var enteredAnswers = answers.Where(a => a.ResponseId == entered.Id)
                .OrderBy(a => a.QuestionId).Select(a => (a.QuestionId, a.ResponseValue, a.ResponseText, a.TimeSpentSeconds)).ToList();
            Assert.Equal(3, realAnswers.Count);
            Assert.Equal(realAnswers, enteredAnswers);

            Assert.Equal(2, (await db.Surveys.AsNoTracking().SingleAsync(s => s.Id == survey.Id)).ResponseCount);
        });

        Assert.Equal(SurveyParticipantStatuses.Completed, await RosterStatusAsync(survey.Id, betoId));

        // Identified: the response carries Beto's id anyway, so the audit row names him.
        await _harness.WithDbAsync(async db =>
        {
            var audit = await db.AuditLogs.AsNoTracking().SingleAsync(a => a.ResourceId == $"{survey.Id}/{betoId}");
            Assert.Equal("surveys.paper-responses.create", audit.Action);
            Assert.Contains(betoId.ToString(), audit.Details!);
            return 0;
        });
    }

    [Fact]
    public async Task The_persons_account_email_and_credentials_are_never_touched()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var before = await AccountAsync(betoId);

        var op = await OperatorAsync();
        Assert.Equal(HttpStatusCode.Created, (await EnterAsync(op, survey.Id, betoId, Answers(survey))).StatusCode);

        Assert.Equal(before, await AccountAsync(betoId));
    }

    [Fact]
    public async Task A_paper_entry_spends_a_licence_seat_as_a_real_submit_does()
    {
        var survey = await ActiveSurveyAsync(anonymous: false, ClimateServiceTypes.GeneralClimate);
        await _harness.WithDbAsync(db =>
            CompanyLicenses.GrantOrUpdateAsync(db, _companyId, ClimateServiceTypes.GeneralClimate, 5, null, DateTimeOffset.UtcNow, default));
        var (ana, _) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        Task<int> SeatsUsedAsync() => _harness.WithDbAsync(db => db.CompanyServiceLicenses
            .AsNoTracking().Where(l => l.CompanyId == _companyId).Select(l => l.SeatsUsed).FirstAsync());

        (await ana.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(Answers: Answers(survey))))
            .EnsureSuccessStatusCode();
        Assert.Equal(1, await SeatsUsedAsync());

        Assert.Equal(HttpStatusCode.Created, (await EnterAsync(await OperatorAsync(), survey.Id, betoId, Answers(survey))).StatusCode);
        Assert.Equal(2, await SeatsUsedAsync());
    }

    // ------------------------------------------------------------------
    // Anonymous
    // ------------------------------------------------------------------

    [Fact]
    public async Task On_an_anonymous_survey_the_response_carries_no_user_and_the_audit_row_names_neither_response_nor_person()
    {
        var survey = await ActiveSurveyAsync(anonymous: true);
        var (_, carlaId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var carlaEmail = (await AccountAsync(carlaId)).Email;
        var op = await OperatorAsync();
        var entering = DateTimeOffset.UtcNow;

        var paper = await EnterAsync(op, survey.Id, carlaId, Answers(survey));

        Assert.Equal(HttpStatusCode.Created, paper.StatusCode);
        await _harness.WithDbAsync(async db =>
        {
            var response = await db.Responses.AsNoTracking().SingleAsync(r => r.SurveyId == survey.Id);
            Assert.Null(response.UserId);
            Assert.True(response.IsAnonymous);
            Assert.True(response.IsComplete);

            // Completion is recorded apart from the answers, as for her own signed-in submit.
            Assert.True(await db.SurveyParticipations.AsNoTracking()
                .AnyAsync(p => p.SurveyId == survey.Id && p.Email == carlaEmail.ToLowerInvariant()));

            // The row is written in the same request as the response, so its timestamp matches
            // the response's StartTime and CompletionTime to the second. It must therefore not
            // name Carla anywhere: not in the resource id, not in the recorded path.
            var audit = await db.AuditLogs.AsNoTracking().SingleAsync(a => a.ResourceId == survey.Id.ToString()
                && a.Action == "surveys.paper-responses.create");
            Assert.DoesNotContain(carlaId.ToString(), audit.ResourceId!);
            Assert.DoesNotContain(carlaId.ToString(), audit.Details!);
            var companyRows = await db.AuditLogs.AsNoTracking().Where(a => a.CompanyId == _companyId && a.Timestamp >= entering).ToListAsync();
            Assert.DoesNotContain(companyRows, a =>
                (a.ResourceId ?? string.Empty).Contains(carlaId.ToString(), StringComparison.Ordinal)
                || (a.Details ?? string.Empty).Contains(carlaId.ToString(), StringComparison.Ordinal));
            Assert.True(audit.Success);
            Assert.Equal(_companyId, audit.CompanyId);
            Assert.NotNull(audit.UserId);
            Assert.Equal("surveys.paper-responses.create", audit.Action);
            Assert.Contains("entered", audit.Details!);
            Assert.DoesNotContain(response.Id.ToString(), audit.Details!);
            Assert.DoesNotContain(response.Id.ToString(), audit.ResourceId!);
            Assert.DoesNotContain(response.SessionId!, audit.Details!);
        });

        Assert.Equal(SurveyParticipantStatuses.Completed, await RosterStatusAsync(survey.Id, carlaId));
    }

    // ------------------------------------------------------------------
    // Refusals
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_person_who_already_completed_is_refused()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var op = await OperatorAsync();
        Assert.Equal(HttpStatusCode.Created, (await EnterAsync(op, survey.Id, betoId, Answers(survey))).StatusCode);

        var again = await EnterAsync(op, survey.Id, betoId, Answers(survey));

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("paper_response_already_completed", await CodeOfAsync(again));
        Assert.Equal(1, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task The_real_submit_validation_refuses_a_missing_required_answer_and_nothing_is_written()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var op = await OperatorAsync();

        var missing = await EnterAsync(op, survey.Id, betoId, [new SurveyAnswerInput(survey.Questions[2].Id, "Only this")]);
        var outOfScale = await EnterAsync(op, survey.Id, betoId,
        [
            new SurveyAnswerInput(survey.Questions[0].Id, "9"),
            new SurveyAnswerInput(survey.Questions[1].Id, "office"),
        ]);

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, outOfScale.StatusCode);
        Assert.Equal(0, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
        Assert.NotEqual(SurveyParticipantStatuses.Completed, await RosterStatusAsync(survey.Id, betoId));
    }

    [Fact]
    public async Task Somebody_outside_the_surveys_population_is_refused()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var otherCompany = await _harness.SeedCompanyAsync("Otra SA");
        var (_, strangerId) = await _harness.IdentifiedClientAsync(Roles.Employee, otherCompany);

        var refused = await EnterAsync(await OperatorAsync(), survey.Id, strangerId, Answers(survey));

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("paper_response_not_in_population", await CodeOfAsync(refused));
    }

    [Fact]
    public async Task An_archived_survey_is_refused()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Archived);

        var refused = await EnterAsync(await OperatorAsync(), survey.Id, betoId, Answers(survey));

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("paper_response_survey_archived", await CodeOfAsync(refused));
    }

    [Fact]
    public async Task A_company_admin_may_not_enter_a_paper_response()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (_, betoId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var refused = await EnterAsync(admin, survey.Id, betoId, Answers(survey));

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("paper_response_super_admin_only", await CodeOfAsync(refused));
    }

    [Fact]
    public async Task The_form_is_the_survey_as_the_person_is_served_it()
    {
        var survey = await ActiveSurveyAsync(anonymous: true);
        var (_, carlaId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId, _departmentId);

        var form = (await (await OperatorAsync()).GetFromJsonAsync<PaperResponseForm>($"/surveys/{survey.Id}/paper-responses/{carlaId}?lang=en"))!;

        Assert.Equal(carlaId, form.UserId);
        Assert.Equal(3, form.Survey.Questions.Count);
        Assert.True(form.Survey.Anonymous);
        Assert.Null(form.Survey.InProgress);
    }
}
