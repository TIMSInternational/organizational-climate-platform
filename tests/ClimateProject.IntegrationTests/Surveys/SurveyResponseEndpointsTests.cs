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
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The respond path (#118): the endpoint real employees hit, and the one where a
/// mistake is least recoverable -- a lost or corrupted response cannot be re-collected.
///
/// Three properties here are only provable end to end, which is why they are asserted
/// against a real Postgres rather than in the unit suite:
/// <list type="number">
/// <item><c>question_responses.response_value</c> is <c>jsonb</c>. A bare option value
/// is not JSON and the insert fails with 22P02 -- a failure no in-memory test can
/// see.</item>
/// <item>Two respondents reading different languages who pick the same option must
/// produce ONE aggregation group. Splitting produces no error, no constraint violation
/// and row counts that reconcile exactly, so only a GROUP BY over real stored rows can
/// catch it.</item>
/// <item>An anonymous response must carry no attributable identifier. That is a claim
/// about columns, and it has to be read off the row.</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class SurveyResponseEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _departmentId;

    public SurveyResponseEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"respond-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Respond Co");
        _departmentId = await _harness.SeedDepartmentAsync(_companyId, "Engineering");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    private Task<HttpClient> EmployeeAsync(Guid? departmentId = null)
        => _harness.ClientAsync(Roles.Employee, _companyId, departmentId);

    /// <summary>
    /// An employee plus the id of the user row behind them.
    ///
    /// Found by difference rather than by an endpoint, because there is no <c>/auth/me</c>
    /// on this API and the harness deliberately keeps its generated emails to itself. The
    /// assembly runs its integration tests serially (see
    /// <c>Support/AssemblyParallelism.cs</c>), so exactly one user row appears across this
    /// call and the difference is unambiguous.
    /// </summary>
    private async Task<(HttpClient Client, Guid UserId)> EmployeeWithIdAsync(Guid? departmentId)
    {
        var before = await _harness.WithDbAsync(db => db.Users.Select(u => u.Id).ToListAsync());
        var client = await EmployeeAsync(departmentId);
        var after = await _harness.WithDbAsync(db => db.Users.Select(u => u.Id).ToListAsync());

        return (client, Assert.Single(after.Except(before)));
    }

    /// <summary>
    /// A bilingual multiple-choice question whose option VALUES are locale independent
    /// and whose LABELS differ per language -- the exact shape #195 introduced, and the
    /// only shape in which the aggregation property can be tested at all.
    /// </summary>
    private static CreateSurveyQuestionInput WorkModeQuestion(bool bilingual, bool required = false)
        => new(
            bilingual
                ? SurveyTestHarness.Both("Where do you work?", "¿Dónde trabajas?")
                : LocalizedInput.FromBare("Where do you work?"),
            QuestionTypes.MultipleChoice,
            Options:
            [
                new CreateSurveyQuestionOptionInput(
                    "remote",
                    bilingual ? SurveyTestHarness.Both("Remote", "Remoto") : LocalizedInput.FromBare("Remote")),
                new CreateSurveyQuestionOptionInput(
                    "hybrid",
                    bilingual ? SurveyTestHarness.Both("Hybrid", "Híbrido") : LocalizedInput.FromBare("Hybrid")),
            ],
            Required: required,
            Order: 0);

    private async Task<SurveyDetail> ActiveSurveyAsync(
        List<CreateSurveyQuestionInput>? questions = null,
        SurveySettingsInput? settings = null,
        string? language = null,
        List<Guid>? departmentIds = null)
    {
        var admin = await AdminAsync();
        var request = new CreateSurveyRequest(
            Title: language == ContentLanguages.Both
                ? SurveyTestHarness.Both("Q3 Climate Survey", "Encuesta de Clima Q3")
                : LocalizedInput.FromBare("Q3 Climate Survey"),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: departmentIds,
            Questions: questions ?? [WorkModeQuestion(bilingual: language == ContentLanguages.Both)],
            Settings: settings,
            Language: language);

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, request);
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey;
    }

    private static Task<HttpResponseMessage> SubmitAsync(
        HttpClient client,
        Guid surveyId,
        SubmitSurveyResponseRequest request)
        => client.PostAsJsonAsync($"/surveys/{surveyId}/responses", request);

    private Task<Response> ResponseRowAsync(Guid responseId)
        => _harness.WithDbAsync(db => db.Responses.AsNoTracking().FirstAsync(r => r.Id == responseId));

    // ------------------------------------------------------------------
    // The happy path
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_employee_submits_a_response_and_it_is_stored_complete()
    {
        var survey = await ActiveSurveyAsync();
        var questionId = survey.Questions[0].Id;
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(questionId, "remote")],
            Language: ContentLanguages.English));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        var result = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;

        Assert.True(result.IsComplete);
        Assert.False(result.AlreadySubmitted);
        Assert.False(result.IsAnonymous);
        Assert.Equal(1, result.AnsweredQuestionCount);
        Assert.Equal(1, result.QuestionCount);

        var row = await ResponseRowAsync(result.ResponseId);
        Assert.True(row.IsComplete);
        Assert.NotNull(row.UserId);
        Assert.NotNull(row.CompletionTime);
        Assert.Equal(_companyId, row.CompanyId);
    }

    [Fact]
    public async Task A_completed_response_increments_the_surveys_response_count()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        (await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "hybrid")]))).EnsureSuccessStatusCode();

        var count = await _harness.WithDbAsync(db => db.Surveys
            .Where(s => s.Id == survey.Id)
            .Select(s => s.ResponseCount)
            .FirstAsync());

        Assert.Equal(1, count);
    }

    [Fact]
    public async Task A_partial_save_does_not_count_as_a_response()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        (await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            IsComplete: false))).EnsureSuccessStatusCode();

        var count = await _harness.WithDbAsync(db => db.Surveys
            .Where(s => s.Id == survey.Id)
            .Select(s => s.ResponseCount)
            .FirstAsync());

        Assert.Equal(0, count);
    }

    [Fact]
    public async Task The_respondents_language_is_recorded_on_the_response()
    {
        // Response.Language exists because the live word cloud counted "trabajo" and
        // "work" into one frequency map with nothing anywhere recording which language a
        // respondent had been reading.
        var survey = await ActiveSurveyAsync(language: ContentLanguages.Both);
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            Language: ContentLanguages.Spanish));
        http.EnsureSuccessStatusCode();

        var result = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;
        Assert.Equal(ContentLanguages.Spanish, result.Language);
        Assert.Equal(ContentLanguages.Spanish, (await ResponseRowAsync(result.ResponseId)).Language);
    }

    [Fact]
    public async Task An_unrecognised_language_is_refused_rather_than_bucketed_as_english()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            Language: "fr"));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    // ------------------------------------------------------------------
    // jsonb, and the aggregation property this whole design exists for
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_stored_answer_is_real_jsonb_holding_the_stable_option_value()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));
        http.EnsureSuccessStatusCode();
        var result = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;

        var stored = await _harness.WithDbAsync(db => db.QuestionResponses
            .AsNoTracking()
            .Where(qr => qr.ResponseId == result.ResponseId)
            .Select(qr => qr.ResponseValue)
            .FirstAsync());

        // Had this been inserted as a bare `remote`, Postgres would have rejected the
        // statement with 22P02 (invalid input syntax for type json) and this test would
        // never have reached the assertion.
        Assert.Equal("\"remote\"", stored);
        Assert.Equal(JsonValueKind.String, JsonDocument.Parse(stored).RootElement.ValueKind);

        // Read back through Postgres's own jsonb operator, which only works if the column
        // really holds json rather than a string that happens to have quotes in it.
        var extracted = await _harness.WithDbAsync(db => db.Database
            .SqlQuery<string>($"SELECT response_value #>> '{{}}' AS \"Value\" FROM question_responses WHERE response_id = {result.ResponseId}")
            .SingleAsync());

        Assert.Equal("remote", extracted);
    }

    [Fact]
    public async Task Two_respondents_in_different_languages_choosing_the_same_option_form_one_aggregation_group()
    {
        // THE test for this lane. Storing the option's display text instead of its stable
        // value would give "Remote" and "Remoto": two groups of one, no error, no
        // constraint violation, and a row count that reconciles exactly.
        var survey = await ActiveSurveyAsync(language: ContentLanguages.Both);
        var questionId = survey.Questions[0].Id;

        var english = await EmployeeAsync(_departmentId);
        var spanish = await EmployeeAsync(_departmentId);

        (await SubmitAsync(english, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(questionId, "remote")],
            Language: ContentLanguages.English))).EnsureSuccessStatusCode();

        (await SubmitAsync(spanish, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(questionId, "remote")],
            Language: ContentLanguages.Spanish))).EnsureSuccessStatusCode();

        var distinctValues = await _harness.WithDbAsync(db => db.Database
            .SqlQuery<int>($"SELECT COUNT(DISTINCT response_value)::int AS \"Value\" FROM question_responses WHERE question_id = {questionId}")
            .SingleAsync());
        var totalAnswers = await _harness.WithDbAsync(db => db.QuestionResponses
            .CountAsync(qr => qr.QuestionId == questionId));

        Assert.Equal(2, totalAnswers);
        Assert.Equal(1, distinctValues);
    }

    [Fact]
    public async Task The_respond_payload_hands_out_the_stable_value_beside_the_translated_label()
    {
        // The contract the previous test depends on: a Spanish respondent reads "Remoto"
        // and submits "remote". If the payload only carried the label there would be
        // nothing else for a client to send.
        var survey = await ActiveSurveyAsync(language: ContentLanguages.Both);
        var employee = await EmployeeAsync(_departmentId);

        var view = (await employee.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?lang=es"))!;

        var options = view.Questions[0].Options!;
        Assert.Equal(["remote", "hybrid"], options.Select(o => o.Value));
        Assert.Equal(["Remoto", "Híbrido"], options.Select(o => o.Label));
    }

    [Fact]
    public async Task An_option_label_is_not_accepted_as_an_answer()
    {
        var survey = await ActiveSurveyAsync(language: ContentLanguages.Both);
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "Remoto")]));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db => db.Responses.Where(r => r.SurveyId == survey.Id).ToListAsync()));
    }

    // ------------------------------------------------------------------
    // Idempotency
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_retried_submission_returns_the_same_response_and_creates_no_second_row()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);
        var request = new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N"));

        var first = await SubmitAsync(employee, survey.Id, request);
        var second = await SubmitAsync(employee, survey.Id, request);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        var firstResult = (await first.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;
        var secondResult = (await second.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;

        Assert.Equal(firstResult.ResponseId, secondResult.ResponseId);
        Assert.False(firstResult.AlreadySubmitted);
        Assert.True(secondResult.AlreadySubmitted);

        Assert.Equal(1, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
        Assert.Equal(1, await _harness.WithDbAsync(db => db.Surveys
            .Where(s => s.Id == survey.Id).Select(s => s.ResponseCount).FirstAsync()));
    }

    [Fact]
    public async Task A_second_submission_with_a_fresh_session_still_cannot_duplicate_an_identified_response()
    {
        // The identified path keys on the acting user, not the session, precisely so a
        // client that lost its session id between retries cannot double-submit.
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        (await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")))).EnsureSuccessStatusCode();

        var second = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "hybrid")],
            SessionId: Guid.NewGuid().ToString("N")));

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.True((await second.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.AlreadySubmitted);
        Assert.Equal(1, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));

        // And the first answer stands: a completed response is never rewritten.
        //
        // Scoped to THIS survey's question. An unfiltered FirstAsync() reads whichever
        // question_responses row the database happens to return first, which -- in an
        // assembly that shares one Postgres container across test classes -- is some
        // earlier test's answer, not this one's. That is what made this assertion fail
        // with Actual: "Great experience", a value no line of this test ever writes.
        // QuestionId is a fresh guid per survey, so it scopes the read exactly.
        var stored = await _harness.WithDbAsync(db => db.QuestionResponses
            .AsNoTracking()
            .Where(qr => qr.QuestionId == survey.Questions[0].Id)
            .Select(qr => qr.ResponseValue)
            .FirstAsync());
        Assert.Equal("\"remote\"", stored);
    }

    [Fact]
    public async Task An_anonymous_retry_with_the_same_session_does_not_duplicate()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var visitor = _factory.CreateClient();
        var request = new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N"));

        (await SubmitAsync(visitor, survey.Id, request)).EnsureSuccessStatusCode();
        var second = await SubmitAsync(visitor, survey.Id, request);

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.True((await second.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.AlreadySubmitted);
        Assert.Equal(1, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task An_anonymous_submission_without_a_session_id_is_refused()
    {
        // Without it, a retry is indistinguishable from a second respondent and
        // "double-submit cannot duplicate a response" becomes unenforceable.
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var visitor = _factory.CreateClient();

        var http = await SubmitAsync(visitor, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    // ------------------------------------------------------------------
    // Anonymity
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_anonymous_visitor_may_respond_without_authenticating()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var visitor = _factory.CreateClient();

        var http = await SubmitAsync(visitor, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
        Assert.True((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.IsAnonymous);
    }

    [Fact]
    public async Task An_anonymous_response_carries_no_attributable_identifier()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var visitor = _factory.CreateClient();
        visitor.DefaultRequestHeaders.Add("User-Agent", "IntegrationTest/1.0");

        var http = await SubmitAsync(visitor, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));
        http.EnsureSuccessStatusCode();

        var row = await ResponseRowAsync((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);

        Assert.True(row.IsAnonymous);
        Assert.Null(row.UserId);
        Assert.Null(row.IpAddress);
        Assert.Null(row.UserAgent);
        Assert.Null(row.DepartmentId);
    }

    [Fact]
    public async Task An_identified_respondent_to_an_anonymous_survey_is_still_not_recorded()
    {
        // The flag belongs to the SURVEY. Knowing who the respondent is changes only what
        // we decline to write down -- otherwise "anonymous" would mean "anonymous unless
        // you happened to be logged in".
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var employee = await EmployeeAsync(_departmentId);
        employee.DefaultRequestHeaders.Add("User-Agent", "IntegrationTest/1.0");

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));
        http.EnsureSuccessStatusCode();

        var row = await ResponseRowAsync((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);

        Assert.True(row.IsAnonymous);
        Assert.Null(row.UserId);
        Assert.Null(row.IpAddress);
        Assert.Null(row.UserAgent);
    }

    [Fact]
    public async Task An_anonymous_response_from_a_tiny_department_records_no_department()
    {
        // A department of one is an identifier wearing a different hat: nothing about
        // department_id looks like a name, and that is exactly why it leaks.
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));
        http.EnsureSuccessStatusCode();

        var row = await ResponseRowAsync((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);
        Assert.Null(row.DepartmentId);
    }

    [Fact]
    public async Task An_identified_response_records_its_department_for_segmentation()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));
        http.EnsureSuccessStatusCode();

        var row = await ResponseRowAsync((await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.ResponseId);
        Assert.Equal(_departmentId, row.DepartmentId);
    }

    [Fact]
    public async Task An_identified_response_captures_the_respondents_demographics_as_jsonb()
    {
        var survey = await ActiveSurveyAsync();
        var (employee, userId) = await EmployeeWithIdAsync(_departmentId);
        await SeedDemographicAsync(userId, "tenure", "10_plus_years");

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));
        http.EnsureSuccessStatusCode();
        var result = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;

        Assert.Empty(result.SuppressedDemographics);

        var stored = await _harness.WithDbAsync(db => db.ResponseDemographics
            .AsNoTracking()
            .Where(rd => rd.ResponseId == result.ResponseId)
            .ToListAsync());

        var demographic = Assert.Single(stored);
        Assert.Equal("tenure", demographic.Field);
        // response_demographics.value is jsonb too. A bare 10_plus_years would be 22P02.
        Assert.Equal("\"10_plus_years\"", demographic.Value);
    }

    [Fact]
    public async Task An_anonymous_response_suppresses_a_demographic_that_would_identify_the_respondent()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var (employee, userId) = await EmployeeWithIdAsync(_departmentId);
        await SeedDemographicAsync(userId, "tenure", "10_plus_years");

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));
        http.EnsureSuccessStatusCode();
        var result = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;

        // Reported, not silently dropped: a reader must be able to tell "answered
        // nothing" from "we refused to record it".
        Assert.Equal(["tenure"], result.SuppressedDemographics);
        Assert.Empty(await _harness.WithDbAsync(db => db.ResponseDemographics
            .Where(rd => rd.ResponseId == result.ResponseId)
            .ToListAsync()));
    }

    [Fact]
    public async Task An_anonymous_response_keeps_a_demographic_shared_by_a_large_enough_group()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var (employee, userId) = await EmployeeWithIdAsync(_departmentId);
        await SeedDemographicAsync(userId, "location", "bogota");
        await SeedDemographicPeersAsync("location", "bogota", SurveyResponsePrivacy.MinimumCohortSize);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));
        http.EnsureSuccessStatusCode();
        var result = (await http.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;

        Assert.Empty(result.SuppressedDemographics);
        Assert.Equal(
            "location",
            Assert.Single(await _harness.WithDbAsync(db => db.ResponseDemographics
                .Where(rd => rd.ResponseId == result.ResponseId)
                .ToListAsync())).Field);
    }

    // ------------------------------------------------------------------
    // Partial save and resume
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_partial_save_is_resumable_and_then_completable()
    {
        var survey = await ActiveSurveyAsync(questions:
        [
            WorkModeQuestion(bilingual: false),
            new CreateSurveyQuestionInput(
                LocalizedInput.FromBare("What would you change?"),
                QuestionTypes.OpenEnded,
                Required: true,
                Order: 1),
        ]);

        var employee = await EmployeeAsync(_departmentId);
        var sessionId = Guid.NewGuid().ToString("N");
        var choice = survey.Questions.Single(q => q.Type == QuestionTypes.MultipleChoice).Id;
        var text = survey.Questions.Single(q => q.Type == QuestionTypes.OpenEnded).Id;

        var partial = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(choice, "hybrid")],
            SessionId: sessionId,
            IsComplete: false));
        Assert.Equal(HttpStatusCode.Created, partial.StatusCode);
        Assert.False((await partial.Content.ReadFromJsonAsync<SurveySubmissionResult>())!.IsComplete);

        // The closed tab reopens and gets its answers back.
        var view = (await employee.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?sessionId={sessionId}"))!;
        var inProgress = view.InProgress!;
        Assert.False(inProgress.IsComplete);
        var saved = Assert.Single(inProgress.Answers);
        Assert.Equal(choice, saved.QuestionId);
        Assert.Equal("hybrid", saved.Value);

        var completed = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(text, "Fewer meetings.")],
            SessionId: sessionId,
            IsComplete: true));
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);

        var result = (await completed.Content.ReadFromJsonAsync<SurveySubmissionResult>())!;
        Assert.True(result.IsComplete);
        Assert.Equal(inProgress.ResponseId, result.ResponseId);
        Assert.Equal(2, result.AnsweredQuestionCount);
        Assert.Equal(1, await _harness.WithDbAsync(db => db.Responses.CountAsync(r => r.SurveyId == survey.Id)));
    }

    [Fact]
    public async Task Revisiting_a_question_updates_the_answer_rather_than_conflicting()
    {
        var survey = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);
        var questionId = survey.Questions[0].Id;
        var sessionId = Guid.NewGuid().ToString("N");

        (await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(questionId, "remote")],
            SessionId: sessionId,
            IsComplete: false))).EnsureSuccessStatusCode();

        var changed = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(questionId, "hybrid")],
            SessionId: sessionId,
            IsComplete: false));
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);

        // Scoped to this survey. The Postgres collection shares one database across every
        // test class, so an unscoped sweep sees sibling tests' rows and Assert.Single fails
        // on their data rather than on this behaviour.
        var rows = await _harness.WithDbAsync(db => db.QuestionResponses.AsNoTracking()
            .Where(qr => db.Responses.Any(r => r.Id == qr.ResponseId && r.SurveyId == survey.Id))
            .ToListAsync());
        Assert.Equal("\"hybrid\"", Assert.Single(rows).ResponseValue);
    }

    [Fact]
    public async Task A_survey_that_forbids_partial_responses_refuses_one()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(AllowPartialResponses: false));
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: false));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    [Fact]
    public async Task Completing_without_a_required_question_is_refused()
    {
        var survey = await ActiveSurveyAsync(questions: [WorkModeQuestion(bilingual: false, required: true)]);
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(Answers: []));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db => db.Responses.Where(r => r.SurveyId == survey.Id).ToListAsync()));
    }

    // ------------------------------------------------------------------
    // Status, targeting and tenancy
    // ------------------------------------------------------------------

    [Theory]
    [InlineData(SurveyStatuses.Draft)]
    [InlineData(SurveyStatuses.Scheduled)]
    [InlineData(SurveyStatuses.Closed)]
    [InlineData(SurveyStatuses.Archived)]
    public async Task A_survey_that_is_not_active_refuses_responses(string status)
    {
        var survey = await ActiveSurveyAsync();
        await _harness.ForceStatusAsync(survey.Id, status);
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db => db.Responses.Where(r => r.SurveyId == survey.Id).ToListAsync()));
    }

    [Fact]
    public async Task A_closed_anonymous_survey_is_no_longer_publicly_available()
    {
        // The settings describe how a survey will be answered, not whether it may be.
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        await _harness.ForceStatusAsync(survey.Id, SurveyStatuses.Closed);
        var visitor = _factory.CreateClient();

        var http = await SubmitAsync(visitor, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));

        Assert.Equal(HttpStatusCode.Unauthorized, http.StatusCode);
    }

    [Fact]
    public async Task An_unauthenticated_visitor_cannot_respond_to_a_named_survey()
    {
        var survey = await ActiveSurveyAsync();
        var visitor = _factory.CreateClient();

        var http = await SubmitAsync(visitor, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")],
            SessionId: Guid.NewGuid().ToString("N")));

        Assert.Equal(HttpStatusCode.Unauthorized, http.StatusCode);
    }

    [Fact]
    public async Task An_employee_of_another_tenant_cannot_respond()
    {
        var survey = await ActiveSurveyAsync();
        var otherCompanyId = await _harness.SeedCompanyAsync("Other Co");
        var outsider = await _harness.ClientAsync(Roles.Employee, otherCompanyId);

        var http = await SubmitAsync(outsider, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Forbidden, http.StatusCode);
    }

    [Fact]
    public async Task An_employee_outside_the_targeted_departments_cannot_respond()
    {
        // Must agree with SurveyQueries.AssignedTo exactly, or /surveys/my lists a survey
        // the respond endpoint then refuses.
        var survey = await ActiveSurveyAsync(departmentIds: [_departmentId]);
        var otherDepartmentId = await _harness.SeedDepartmentAsync(_companyId, "Finance");
        var employee = await EmployeeAsync(otherDepartmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Forbidden, http.StatusCode);
    }

    [Fact]
    public async Task An_employee_inside_the_targeted_departments_may_respond()
    {
        var survey = await ActiveSurveyAsync(departmentIds: [_departmentId]);
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(survey.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.Created, http.StatusCode);
    }

    [Fact]
    public async Task An_unknown_survey_is_a_404()
    {
        var employee = await EmployeeAsync(_departmentId);
        var http = await SubmitAsync(employee, Guid.NewGuid(), new SubmitSurveyResponseRequest(Answers: []));
        Assert.Equal(HttpStatusCode.NotFound, http.StatusCode);
    }

    [Fact]
    public async Task An_answer_to_a_question_from_another_survey_is_refused()
    {
        var survey = await ActiveSurveyAsync();
        var other = await ActiveSurveyAsync();
        var employee = await EmployeeAsync(_departmentId);

        var http = await SubmitAsync(employee, survey.Id, new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(other.Questions[0].Id, "remote")]));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    // ------------------------------------------------------------------
    // The respond payload
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_spanish_only_survey_fetched_in_english_reports_the_locale_it_is_actually_in()
    {
        // Reporting 'en' here is the silent substitution #195 forbids, and it shipped once
        // on this domain already.
        var survey = await ActiveSurveyAsync(
            language: ContentLanguages.Spanish,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("¿Cómo te sientes?"),
                    QuestionTypes.OpenEnded,
                    Order: 0),
            ]);
        var employee = await EmployeeAsync(_departmentId);

        var view = (await employee.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?lang=en"))!;

        Assert.Equal(ContentLanguages.Spanish, view.ResolvedLocale);
        Assert.Equal(ContentLanguages.Spanish, view.Language);
        Assert.Contains("title", view.FallbackFields, StringComparer.Ordinal);
    }

    [Fact]
    public async Task The_public_respond_payload_is_served_to_an_unauthenticated_visitor()
    {
        var survey = await ActiveSurveyAsync(settings: new SurveySettingsInput(Anonymous: true));
        var visitor = _factory.CreateClient();

        var view = (await visitor.GetFromJsonAsync<SurveyRespondView>($"/surveys/{survey.Id}/respond"))!;

        Assert.True(view.Anonymous);
        Assert.Single(view.Questions);
        Assert.Null(view.InProgress);
    }

    [Fact]
    public async Task The_respond_payload_is_not_public_for_a_named_survey()
    {
        var survey = await ActiveSurveyAsync();
        var visitor = _factory.CreateClient();

        var http = await visitor.GetAsync(new Uri($"/surveys/{survey.Id}/respond", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, http.StatusCode);
    }

    // ------------------------------------------------------------------
    // Rate limiting on the public path (#146)
    // ------------------------------------------------------------------

    [Theory]
    [InlineData("/surveys/{id:guid}/responses")]
    [InlineData("/surveys/{id:guid}/respond")]
    public void The_public_respond_routes_are_rate_limited(string pattern)
    {
        // Asserted from the route metadata rather than by firing the limit: the limiter is
        // a fixed window over wall-clock time, so a test that exhausts it either takes a
        // minute or becomes timing-dependent -- and both of those are how a guard ends up
        // deleted for flaking.
        var endpoint = _factory.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == pattern);

        var metadata = endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>();

        Assert.NotNull(metadata);
        Assert.Equal(SurveyResponseEndpoints.ResponseSubmissionRateLimiterPolicy, metadata.PolicyName);
    }

    // ------------------------------------------------------------------
    // Seeding helpers
    // ------------------------------------------------------------------

    /// <summary>
    /// Attaches a demographic value to a user, creating the company's field on first use.
    /// </summary>
    private Task SeedDemographicAsync(Guid userId, string field, string value)
        => _harness.WithDbAsync(async db =>
        {
            var demographicField = await db.DemographicFields
                .FirstOrDefaultAsync(f => f.CompanyId == _companyId && f.Field == field);
            if (demographicField is null)
            {
                demographicField = new DemographicField
                {
                    Id = Guid.NewGuid(),
                    CompanyId = _companyId,
                    Field = field,
                    LabelEn = field,
                    Type = "select",
                    Order = 0,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                db.DemographicFields.Add(demographicField);
                DemographicOptionSeed.Add(db, demographicField.Id, [value]);
            }

            db.UserDemographics.Add(new UserDemographic
            {
                UserId = userId,
                DemographicFieldId = demographicField.Id,
                Value = value,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });

            await db.SaveChangesAsync();
        });

    /// <summary>Adds enough other users sharing a demographic value to clear the cohort floor.</summary>
    private Task SeedDemographicPeersAsync(string field, string value, int peerCount)
        => _harness.WithDbAsync(async db =>
        {
            var demographicField = await db.DemographicFields
                .FirstAsync(f => f.CompanyId == _companyId && f.Field == field);

            for (var i = 0; i < peerCount; i++)
            {
                var peer = new User
                {
                    Id = Guid.NewGuid(),
                    CompanyId = _companyId,
                    Email = $"{Guid.NewGuid():N}@peers.test",
                    Name = "Peer",
                    Role = Roles.Employee,
                    IsActive = true,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                db.Users.Add(peer);
                db.UserDemographics.Add(new UserDemographic
                {
                    UserId = peer.Id,
                    DemographicFieldId = demographicField.Id,
                    Value = value,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
            }

            await db.SaveChangesAsync();
        });
}
