using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

[Collection("Postgres")]
public class ReportEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"rep-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Report Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_creates_a_report_and_it_completes_immediately()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Q3 Climate Report", "Quarterly summary", "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal("completed", created!.Status);
        Assert.NotNull(created.ReportOutput);
    }

    /// <summary>
    /// req(#152): a generated report must actually render the AI insights that exist for the
    /// company. The legacy generator read <c>AIInsight</c> through a rival model shape and the
    /// section came back empty with no error, so this asserts on the insight's own prose and its
    /// 0-100 confidence surviving the whole round trip -- rows in, report output out.
    /// </summary>
    [Fact]
    public async Task A_generated_report_renders_the_companys_AI_insights_and_no_one_elses()
    {
        var otherCompanyId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Companies.Add(new Company
            {
                Id = otherCompanyId, Name = "Other Co", EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            db.AIInsights.AddRange(
                NewInsight(_companyId, "Elevated attrition risk in Engineering", confidenceScore: 87),
                NewInsight(_companyId, "Stale insight", expiresAt: DateTimeOffset.UtcNow.AddDays(-1)),
                NewInsight(otherCompanyId, "Another tenant's insight"));
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Q3 Climate Report", null, "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        var document = JsonSerializer.Deserialize<ReportOutputDocument>(created!.ReportOutput!, JsonSerializerOptions.Web);

        var item = Assert.Single(document!.AiInsights);
        Assert.Equal("Elevated attrition risk in Engineering", item.Title);
        Assert.Equal("Engagement scores trending down over the last 3 cycles", item.Description);
        Assert.Equal(87, item.ConfidenceScore);
        Assert.Equal(["Engineering", "QA"], item.AffectedSegments);
        Assert.Equal(["Schedule 1:1s", "Review workload distribution"], item.RecommendedActions);
    }

    private static AIInsight NewInsight(Guid companyId, string title, int confidenceScore = 87, DateTimeOffset? expiresAt = null)
        => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Type = "risk",
            Category = "attrition",
            Title = title,
            Description = "Engagement scores trending down over the last 3 cycles",
            ConfidenceScore = confidenceScore,
            Priority = "high",
            AffectedSegments = ["Engineering", "QA"],
            RecommendedActions = ["Schedule 1:1s", "Review workload distribution"],
            ExpiresAt = expiresAt,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

    // ------------------------------------------------------------------
    // #88 -- real aggregation, through the same path as the results screens
    // ------------------------------------------------------------------

    private Task<Guid> SeedDepartmentAsync(string name)
        => WithDbAsync(async db =>
        {
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Name = name,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Departments.Add(department);
            await db.SaveChangesAsync();
            return department.Id;
        });

    /// <summary>
    /// Writes one completed response with one answer, the way
    /// <c>question_responses.response_value</c> requires: a serialised JSON string,
    /// because the column is jsonb and a bare <c>4</c>-as-text is a different payload.
    /// Same rule and same reason as <c>SurveyResultsEndpointsTests.SeedAnswerAsync</c>.
    /// </summary>
    /// <param name="demographics">
    /// Written to <c>response_demographics</c> as jsonb, the same way the answer is: the
    /// column holds a JSON payload, so a bare <c>0-1</c>-as-text is a different value and
    /// the aggregation's decoder drops it. Seeding it wrong is how a breakdown test comes
    /// back green over a survey that produced no breakdown at all.
    /// </param>
    private Task SeedAnswerAsync(
        Guid surveyId,
        Guid questionId,
        Guid departmentId,
        string value,
        IReadOnlyDictionary<string, string>? demographics = null)
        => WithDbAsync(async db =>
        {
            var responseId = Guid.NewGuid();
            db.Responses.Add(new Response
            {
                Id = responseId,
                SurveyId = surveyId,
                CompanyId = _companyId,
                UserId = null,
                DepartmentId = departmentId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "en",
                IsComplete = true,
                IsAnonymous = true,
                StartTime = DateTimeOffset.UtcNow.AddMinutes(-5),
                CompletionTime = DateTimeOffset.UtcNow,
                TotalTimeSeconds = 300,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            db.QuestionResponses.Add(new QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = questionId,
                ResponseValue = JsonSerializer.Serialize(value),
                ResponseText = null,
            });
            foreach (var (field, demographicValue) in demographics ?? new Dictionary<string, string>())
            {
                db.ResponseDemographics.Add(new ResponseDemographic
                {
                    ResponseId = responseId,
                    Field = field,
                    Value = JsonSerializer.Serialize(demographicValue),
                });
            }

            await db.SaveChangesAsync();
        });

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        using var scope = _factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> action)
    {
        using var scope = _factory.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private async Task<SurveyDetail> CreateSurveyAsync(HttpClient client, string title, string category)
    {
        var response = await client.PostAsJsonAsync("/surveys", new CreateSurveyRequest(
            Title: LocalizedInput.FromBare(title),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: null,
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("How supported do you feel by leadership?"),
                    "likert",
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("1", LocalizedInput.FromBare("Strongly disagree")),
                        new CreateSurveyQuestionOptionInput("2", LocalizedInput.FromBare("Disagree")),
                        new CreateSurveyQuestionOptionInput("3", LocalizedInput.FromBare("Neutral")),
                        new CreateSurveyQuestionOptionInput("4", LocalizedInput.FromBare("Agree")),
                        new CreateSurveyQuestionOptionInput("5", LocalizedInput.FromBare("Strongly agree")),
                    ],
                    Order: 0,
                    Category: category),
            ],
            Language: null));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
    }

    /// <summary>
    /// req(#88): the report's survey sections are real aggregation, and they are the SAME
    /// aggregation the results screens serve -- asserted by fetching
    /// <c>/surveys/{id}/results</c> in the same test and requiring the two to agree, so
    /// this test fails if the report ever grows its own arithmetic.
    ///
    /// The privacy half is the part that must be impossible to regress: Sales has 2
    /// completed responses, below <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>,
    /// and the results screens suppress it -- so the report must too. The raw persisted
    /// document is searched for Sales's row to prove the withheld headcount is not
    /// merely flagged but absent.
    /// </summary>
    [Fact]
    public async Task A_generated_report_aggregates_like_the_results_screen_and_keeps_a_small_department_suppressed()
    {
        var engineeringId = await SeedDepartmentAsync("Engineering");
        var salesId = await SeedDepartmentAsync("Sales");

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var survey = await CreateSurveyAsync(client, "Q3 Climate", "leadership");
        var questionId = survey.Questions.Single().Id;
        var activate = await client.PutAsJsonAsync($"/surveys/{survey.Id}/status", new UpdateSurveyStatusRequest(SurveyStatuses.Active));
        activate.EnsureSuccessStatusCode();

        // A draft next to it: nothing to aggregate (content is only editable while no
        // responses exist), so it must not appear in the report at all.
        await CreateSurveyAsync(client, "Draft Climate", "leadership");

        for (var i = 0; i < 5; i++)
        {
            await SeedAnswerAsync(survey.Id, questionId, engineeringId, "4");
        }

        await SeedAnswerAsync(survey.Id, questionId, salesId, "2");
        await SeedAnswerAsync(survey.Id, questionId, salesId, "2");

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Q3 Climate Report", null, "climate_summary", _companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        var document = JsonSerializer.Deserialize<ReportOutputDocument>(created!.ReportOutput!, JsonSerializerOptions.Web)!;

        var section = Assert.Single(document.Surveys);
        Assert.Equal(survey.Id, section.SurveyId);
        Assert.Equal("Q3 Climate", section.Title);
        Assert.False(section.IsSuppressed);
        Assert.Equal(7, section.Participation.CompletedCount);

        // The same survey through the results screen's route. Agreement here is the
        // whole point of sharing the aggregation.
        var results = (await client.GetFromJsonAsync<SurveyResultsResponse>(
            $"/surveys/{survey.Id}/results", JsonSerializerOptions.Web))!;
        Assert.Equal(results.Summary.CompletedCount, section.Participation.CompletedCount);

        var leadership = Assert.Single(section.Dimensions);
        Assert.Equal("leadership", leadership.Dimension);
        Assert.Equal(7, leadership.AnsweredCount);
        // (4 x 5 + 2 x 2) / 7 = 3.43 -- and byte-for-byte the number /results serves.
        Assert.Equal(3.43d, leadership.AverageScore);
        Assert.Equal(results.Questions.Single().Average, leadership.AverageScore);

        var engineering = Assert.Single(section.Departments, d => d.DepartmentId == engineeringId.ToString());
        Assert.False(engineering.IsSuppressed);
        Assert.Equal(5, engineering.RespondentCount);

        // The anonymity floor, in the persisted document. Sales's row must say
        // suppressed-and-zero, and the count 2 may survive ONLY as the breakdown's
        // reconciliation counter -- never on the department's own row.
        var sales = Assert.Single(section.Departments, d => d.DepartmentId == salesId.ToString());
        Assert.True(sales.IsSuppressed);
        Assert.Equal(0, sales.RespondentCount);
        Assert.Null(sales.ParticipationRate);
        Assert.Equal(1, section.SuppressedDepartmentCount);
        Assert.Equal(2, section.SuppressedRespondentCount);
        Assert.Equal(SurveyResultsPrivacy.MinimumSegmentRespondents, section.MinimumGroupSize);
    }

    // ------------------------------------------------------------------
    // #88 follow-ups: per-question distributions, word clouds, demographic
    // breakdowns, benchmark comparisons
    // ------------------------------------------------------------------

    private async Task<SurveyDetail> CreateOpenEndedSurveyAsync(HttpClient client, string title)
    {
        var response = await client.PostAsJsonAsync("/surveys", new CreateSurveyRequest(
            Title: LocalizedInput.FromBare(title),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: null,
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Anything else you want to tell us?"),
                    QuestionTypes.OpenEnded,
                    Order: 0,
                    Category: "leadership"),
            ],
            Language: null));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
    }

    private async Task<ReportOutputDocument> GenerateAsync(HttpClient client, string title = "Q3 Climate Report")
    {
        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            title, null, "climate_summary", _companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        _lastReportOutput = created!.ReportOutput!;
        return JsonSerializer.Deserialize<ReportOutputDocument>(_lastReportOutput, JsonSerializerOptions.Web)!;
    }

    /// <summary>
    /// The raw persisted <c>report_output</c> of the last <see cref="GenerateAsync"/> call.
    /// The privacy assertions read THIS -- the bytes handed to the browser -- and not the
    /// parsed graph, because "absent from the document" is a claim about the bytes.
    /// </summary>
    private string _lastReportOutput = string.Empty;

    /// <summary>
    /// req(#88 follow-up): the report prints per-question distributions, and they are the
    /// same distributions <c>/surveys/{id}/results</c> serves.
    ///
    /// <para>The invariant that would catch a projection quietly dropping or re-deriving a
    /// bucket is the sum: every bucket count of one question adds up to the answers that
    /// question received. Asserted here over the document that came back out of Postgres,
    /// not over an in-memory aggregate.</para>
    /// </summary>
    [Fact]
    public async Task A_generated_reports_question_distributions_match_the_results_screen_and_sum_to_the_answered_count()
    {
        var engineeringId = await SeedDepartmentAsync("Engineering");

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var survey = await CreateSurveyAsync(client, "Q3 Climate", "leadership");
        var questionId = survey.Questions.Single().Id;
        (await client.PutAsJsonAsync($"/surveys/{survey.Id}/status", new UpdateSurveyStatusRequest(SurveyStatuses.Active)))
            .EnsureSuccessStatusCode();

        for (var i = 0; i < 5; i++) await SeedAnswerAsync(survey.Id, questionId, engineeringId, "4");
        for (var i = 0; i < 2; i++) await SeedAnswerAsync(survey.Id, questionId, engineeringId, "1");

        var document = await GenerateAsync(client);
        var question = Assert.Single(Assert.Single(document.Surveys).Questions);

        Assert.Equal(questionId, question.QuestionId);
        Assert.Equal("How supported do you feel by leadership?", question.Text);
        Assert.Equal(7, question.AnsweredCount);
        Assert.Equal(question.AnsweredCount, question.Distribution.Sum(bucket => bucket.Count));

        // The option order the survey was authored in, not popularity order: "1" before
        // "4" even though "4" won 5 votes to 2.
        Assert.Equal(["1", "4"], question.Distribution.Select(b => b.Value));
        Assert.Equal([2, 5], question.Distribution.Select(b => b.Count));

        // And byte-for-byte the results screen's own answer to the same question.
        var results = (await client.GetFromJsonAsync<SurveyResultsResponse>(
            $"/surveys/{survey.Id}/results", JsonSerializerOptions.Web))!;
        Assert.Equal(results.Questions.Single().Distribution, question.Distribution);
        Assert.Equal(results.Questions.Single().Average, question.Average);
    }

    /// <summary>
    /// THE open-text guarantee, asserted on the persisted document: a report's word cloud
    /// is a frequency map floored at <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/>,
    /// and verbatim response content is never returned by this platform at all.
    ///
    /// <para>One respondent writes a sentence nobody repeats. Every word of it appears in
    /// exactly one response, so every word of it is below the word floor -- and the
    /// sentence itself must not appear in any form, which is why this searches the raw
    /// column rather than the parsed word list. That is the guarantee "Voices" was closed
    /// on, and a report is the surface most likely to be read by somebody who was not in
    /// the room.</para>
    /// </summary>
    [Fact]
    public async Task A_generated_reports_word_cloud_never_carries_a_singleton_word_or_the_sentence_it_came_from()
    {
        var engineeringId = await SeedDepartmentAsync("Engineering");

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var survey = await CreateOpenEndedSurveyAsync(client, "Open Climate");
        var questionId = survey.Questions.Single().Id;
        (await client.PutAsJsonAsync($"/surveys/{survey.Id}/status", new UpdateSurveyStatusRequest(SurveyStatuses.Active)))
            .EnsureSuccessStatusCode();

        const string Confession = "the visa renewal paperwork is stressful";
        string[] texts = [Confession, "workload is heavy", "workload is heavy", "morale is good", "morale is good"];
        foreach (var text in texts) await SeedAnswerAsync(survey.Id, questionId, engineeringId, text);

        var document = await GenerateAsync(client);
        var question = Assert.Single(Assert.Single(document.Surveys).Questions);

        // The cloud exists and is a frequency map: word, language, two counts, no text.
        var workload = Assert.Single(question.Words, w => w.Word == "workload");
        Assert.Equal("en", workload.Language);
        Assert.Equal(2, workload.ResponseCount);
        Assert.Contains(question.Words, w => w.Word == "morale" && w.ResponseCount == 2);
        Assert.All(question.Words, w => Assert.True(SurveyResultsPrivacy.MeetsWordFloor(w.ResponseCount)));

        // Nothing one person alone said survives -- neither the sentence nor any word of
        // it -- and the withheld words are counted rather than silently dropped.
        Assert.DoesNotContain(Confession, _lastReportOutput, StringComparison.OrdinalIgnoreCase);
        foreach (var word in new[] { "visa", "renewal", "paperwork", "stressful" })
        {
            Assert.DoesNotContain(word, _lastReportOutput, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Equal(5, question.SuppressedWordCount);

        // The same cloud the results screen serves, so a reader cannot get more out of one
        // surface than the other.
        var results = (await client.GetFromJsonAsync<SurveyResultsResponse>(
            $"/surveys/{survey.Id}/results", JsonSerializerOptions.Web))!;
        Assert.Equal(results.Questions.Single().Words, question.Words);
    }

    /// <summary>
    /// req(#88 follow-up): demographic breakdowns beyond department reach the document --
    /// and a group below <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/> reaches
    /// it carrying no number at all.
    ///
    /// <para>The two tenure groups answer differently on purpose (4 against 1) so the
    /// withheld group has a reading of its own, 1.0, that exists nowhere else in the
    /// document. A projection that printed the aggregate's raw segment collection, or that
    /// scored a suppressed group, puts that number in the bytes.</para>
    /// </summary>
    [Fact]
    public async Task A_generated_report_prints_demographic_breakdowns_and_withholds_a_sub_floor_group()
    {
        var engineeringId = await SeedDepartmentAsync("Engineering");

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var survey = await CreateSurveyAsync(client, "Q3 Climate", "leadership");
        var questionId = survey.Questions.Single().Id;
        (await client.PutAsJsonAsync($"/surveys/{survey.Id}/status", new UpdateSurveyStatusRequest(SurveyStatuses.Active)))
            .EnsureSuccessStatusCode();

        var senior = new Dictionary<string, string>(StringComparer.Ordinal) { ["tenure"] = "2-5" };
        var newcomer = new Dictionary<string, string>(StringComparer.Ordinal) { ["tenure"] = "0-1" };
        for (var i = 0; i < 5; i++) await SeedAnswerAsync(survey.Id, questionId, engineeringId, "4", senior);
        for (var i = 0; i < 2; i++) await SeedAnswerAsync(survey.Id, questionId, engineeringId, "1", newcomer);

        var document = await GenerateAsync(client);
        var section = Assert.Single(document.Surveys);

        // Department is printed as departments and must not appear a second time here.
        Assert.DoesNotContain(section.Demographics, b => b.Dimension == "department");
        var tenure = Assert.Single(section.Demographics);
        Assert.Equal("tenure", tenure.Dimension);

        var seniorGroup = Assert.Single(tenure.Segments, s => s.Key == "2-5");
        Assert.False(seniorGroup.IsSuppressed);
        Assert.Equal(5, seniorGroup.RespondentCount);
        var leadership = Assert.Single(seniorGroup.Dimensions);
        Assert.Equal("leadership", leadership.Dimension);
        Assert.Equal(4d, leadership.AverageScore);

        // The withheld group: its row says so, and carries nothing else. The count 2
        // survives once, as the breakdown's reconciliation counter.
        var newcomerGroup = Assert.Single(tenure.Segments, s => s.Key == "0-1");
        Assert.True(newcomerGroup.IsSuppressed);
        Assert.Equal(0, newcomerGroup.RespondentCount);
        Assert.Empty(newcomerGroup.Dimensions);
        Assert.Equal(1, tenure.SuppressedSegmentCount);
        Assert.Equal(2, tenure.SuppressedRespondentCount);

        // Document-wide: no suppressed segment anywhere carries a count or a score, and
        // the withheld group's own reading of 1.0 is not a score in the document at all.
        var suppressed = document.Surveys
            .SelectMany(s => s.Demographics)
            .SelectMany(b => b.Segments)
            .Where(s => s.IsSuppressed)
            .ToList();
        Assert.NotEmpty(suppressed);
        Assert.All(suppressed, s =>
        {
            Assert.Equal(0, s.RespondentCount);
            Assert.Empty(s.Dimensions);
        });
        Assert.DoesNotContain(
            1d,
            document.Surveys.SelectMany(s => s.Demographics).SelectMany(b => b.Segments)
                .SelectMany(s => s.Dimensions).Select(d => d.AverageScore));

        // The same breakdown the statistics screen serves: same groups, same suppression.
        var statistics = (await client.GetFromJsonAsync<SurveyStatisticsResponse>(
            $"/surveys/{survey.Id}/statistics", JsonSerializerOptions.Web))!;
        var served = Assert.Single(statistics.Breakdowns, b => b.Dimension == "tenure");
        Assert.Equal(
            served.Segments.Select(s => (s.Key, s.RespondentCount, s.IsSuppressed)),
            tenure.Segments.Select(s => (s.Key, s.RespondentCount, s.IsSuppressed)));
    }

    private async Task<HttpClient> SuperAdminClientAsync()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<BenchmarkDetail> CreateBenchmarkAsync(HttpClient client, string name, Guid? companyId)
    {
        var response = await client.PostAsJsonAsync("/admin/benchmarks", new CreateBenchmarkRequest(
            name, "d", "industry", "engagement", "internal", null, null, null, companyId, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BenchmarkDetail>())!;
    }

    private static async Task AddMetricAsync(HttpClient client, Guid benchmarkId, string metricName, double value, string unit)
    {
        var response = await client.PostAsJsonAsync(
            $"/admin/benchmarks/{benchmarkId}/metrics",
            new AddBenchmarkMetricRequest(metricName, value, unit, null, null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    /// <summary>
    /// req(#88 follow-up): the report's benchmark section prints the numbers
    /// <c>GET /admin/benchmarks/{id}</c> serves -- the readings AND the year-over-year
    /// change #89 computes -- because it is that route's own code producing them.
    ///
    /// <para>The assertion is equality against the live route in the same test, not against
    /// hand-written expectations. A second derivation in the report would still produce
    /// plausible numbers; only agreement with the surface an administrator is looking at
    /// while they read the report proves there is one derivation.</para>
    /// </summary>
    [Fact]
    public async Task The_reports_benchmark_section_prints_the_numbers_the_benchmarks_route_serves()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var prior = await CreateBenchmarkAsync(client, "2025 Engagement", _companyId);
        await AddMetricAsync(client, prior.Id, "engagement", 70d, "percent");
        var current = await CreateBenchmarkAsync(client, "2026 Engagement", _companyId);
        await AddMetricAsync(client, current.Id, "engagement", 74d, "percent");

        var link = await client.PutAsJsonAsync(
            $"/admin/benchmarks/{current.Id}/prior-period",
            new SetPriorPeriodRequest(PriorPeriodStatuses.Linked, prior.Id));
        Assert.Equal(HttpStatusCode.OK, link.StatusCode);

        var document = await GenerateAsync(client);
        var entry = Assert.Single(document.Benchmarks, b => b.BenchmarkId == current.Id);
        var served = (await client.GetFromJsonAsync<BenchmarkDetail>(
            $"/admin/benchmarks/{current.Id}", JsonSerializerOptions.Web))!;

        Assert.Equal(served.Name, entry.Name);
        Assert.Equal(served.Category, entry.Category);
        Assert.Equal(served.PriorPeriodStatus, entry.PriorPeriodStatus);
        Assert.Equal(served.Metrics, entry.Metrics);
        Assert.Equal(served.PriorPeriod!.Id, entry.PriorPeriod!.Id);
        Assert.Equal(served.PriorPeriod.Metrics, entry.PriorPeriod.Metrics);

        // And the change is a real reading, not merely present: 74 against 70.
        var change = Assert.Single(entry.PriorPeriod.Metrics);
        Assert.Equal(74d, change.Value);
        Assert.Equal(70d, change.PriorValue);
        Assert.Equal(4d, change.Delta);
        Assert.Equal(4d / 70d, change.ChangeRatio!.Value, 10);

        // The prior period is also a benchmark of this company, so it is its own row --
        // unlinked, because nothing points further back.
        var priorEntry = Assert.Single(document.Benchmarks, b => b.BenchmarkId == prior.Id);
        Assert.Equal(PriorPeriodStatuses.Unlinked, priorEntry.PriorPeriodStatus);
        Assert.Null(priorEntry.PriorPeriod);
    }

    /// <summary>
    /// The tenant half of the benchmark section: a report carries the global rows every
    /// tenant compares against and its own company's, and never another tenant's.
    ///
    /// <para>Generation runs with no principal at all -- the scheduled runner (#91) has
    /// nobody logged in -- so the scope cannot come from a role check on the caller. This
    /// is the test that the report binds to <c>BenchmarkEndpoints</c>' own tenant rule
    /// rather than to whoever pressed the button.</para>
    /// </summary>
    [Fact]
    public async Task A_reports_benchmark_section_carries_global_rows_and_never_another_tenants()
    {
        var otherCompanyId = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Companies.Add(new Company
            {
                Id = otherCompanyId,
                Name = "Other Co",
                EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        var superAdmin = await SuperAdminClientAsync();
        var globalBenchmark = await CreateBenchmarkAsync(superAdmin, "Global Engagement", null);
        await AddMetricAsync(superAdmin, globalBenchmark.Id, "engagement", 65d, "percent");
        var foreign = await CreateBenchmarkAsync(superAdmin, "Other Tenant Engagement", otherCompanyId);
        await AddMetricAsync(superAdmin, foreign.Id, "engagement", 99d, "percent");

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var own = await CreateBenchmarkAsync(client, "Our Engagement", _companyId);
        await AddMetricAsync(client, own.Id, "engagement", 71d, "percent");

        var document = await GenerateAsync(client);

        Assert.Contains(document.Benchmarks, b => b.BenchmarkId == own.Id);
        var global = Assert.Single(document.Benchmarks, b => b.BenchmarkId == globalBenchmark.Id);
        Assert.Null(global.CompanyId);

        Assert.DoesNotContain(document.Benchmarks, b => b.BenchmarkId == foreign.Id);
        Assert.DoesNotContain(document.Benchmarks, b => b.CompanyId == otherCompanyId);
        // Not merely absent from the parsed list: the other tenant's id and its reading are
        // not in the bytes handed to this company's browser.
        Assert.DoesNotContain(foreign.Id.ToString(), _lastReportOutput, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Other Tenant Engagement", _lastReportOutput, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Download_increments_count_only_when_completed()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Report", null, "type", _companyId, "csv", null));
        var created = await createResponse.Content.ReadFromJsonAsync<ReportDetail>();

        var downloadResponse = await client.PostAsync($"/admin/reports/{created!.Id}/download", null);
        Assert.Equal(HttpStatusCode.OK, downloadResponse.StatusCode);
        var downloaded = await downloadResponse.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal(1, downloaded!.DownloadCount);
    }

    /// <summary>
    /// #285: <c>reports.created_by</c> must name the caller's own row, even when their
    /// <c>sub</c> spells another user's <c>Id</c>.
    ///
    /// <c>persona_external_id</c> is a free-form 64-character string, so nothing stops one
    /// being a Guid in canonical form -- #154's ETL is the feature that will start filling
    /// the column from legacy ids. Here the collider's <c>PersonaExternalId</c> is the
    /// victim's <c>Id</c>, which is exactly what the collider's <c>sub</c> is then minted
    /// from (<c>PersonaExternalId ?? Id</c>, AuthEndpoints).
    ///
    /// This endpoint resolved <c>Id</c> first until #285, so the report was filed against the
    /// victim -- an audit trail naming someone who did nothing.
    /// </summary>
    [Fact]
    public async Task A_guid_shaped_external_id_never_files_the_report_against_the_user_whose_id_it_matches()
    {
        var (colliderId, colliderToken) = await SeedCollisionAsync();
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", colliderToken);

        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Collision Report", null, "climate_summary", _companyId, "pdf", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal(colliderId, created!.CreatedBy);
    }

    /// <summary>
    /// Two accounts, where the second one's <c>PersonaExternalId</c> is the first one's
    /// <c>Id</c>. Returns the second account's own id and a token minted after the collision
    /// exists, so its <c>sub</c> is the Guid-shaped external id rather than its own.
    /// </summary>
    private async Task<(Guid ColliderId, string Token)> SeedCollisionAsync()
    {
        var victimEmail = $"{Guid.NewGuid():N}@{_companyDomain}";
        var colliderEmail = $"{Guid.NewGuid():N}@{_companyDomain}";
        var setup = _factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.Created,
            (await setup.PostAsJsonAsync("/auth/signup", new SignupRequest("Victim", victimEmail, "A-good-passw0rd"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Created,
            (await setup.PostAsJsonAsync("/auth/signup", new SignupRequest("Collider", colliderEmail, "A-good-passw0rd"))).StatusCode);

        Guid colliderId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var victim = await db.Users.FirstAsync(u => u.Email == victimEmail);
            var collider = await db.Users.FirstAsync(u => u.Email == colliderEmail);
            collider.Role = Roles.CompanyAdmin;
            collider.CompanyId = _companyId;
            collider.PersonaExternalId = victim.Id.ToString();
            await db.SaveChangesAsync();
            colliderId = collider.Id;
            Assert.NotEqual(victim.Id, collider.Id);
        }

        var login = await setup.PostAsJsonAsync("/auth/login", new LoginRequest(colliderEmail, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (colliderId, (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);
    }
}
