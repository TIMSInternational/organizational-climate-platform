using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;

namespace ClimateProject.IntegrationTests.Dashboard;

/// <summary>
/// The department dashboard's floor, applied where the payload is built.
///
/// <para>
/// The leader's and the supervisor's panels (the canvas's LeaderDashboard and
/// SupervisorDashboard, 10 Sep) hatch the open survey's team count under 5. A screen that
/// hides a number the network tab still shows has hidden nothing, so every count those panels
/// hatch must be absent from <c>GET /dashboard/department-admin</c> itself -- and the numbers
/// the leader's panel does print beside the team's (the whole company's) must not give a
/// hidden one back by subtraction.
/// </para>
///
/// <para>
/// xUnit builds this class once per test and <see cref="InitializeAsync"/> seeds a fresh
/// tenant each time, so every count below is exactly what the test in hand seeded.
/// </para>
/// </summary>
[Collection("Postgres")]
public class DepartmentDashboardFloorTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _engineeringId;
    private Guid _salesId;
    private Guid _authorId;

    public DepartmentDashboardFloorTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"ddf-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Floor Co");
        _engineeringId = await _harness.SeedDepartmentAsync(_companyId, "Engineering");
        _salesId = await _harness.SeedDepartmentAsync(_companyId, "Sales");
        _authorId = await _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var author = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                DepartmentId = null,
                Email = $"author-{Guid.NewGuid():N}@seed.test",
                Name = "Survey Author",
                Role = Roles.CompanyAdmin,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(author);
            await db.SaveChangesAsync();
            return author.Id;
        });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // The counts
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_open_surveys_team_count_under_the_floor_travels_as_null_and_so_does_a_company_total_under_it()
    {
        var survey = await SeedSurveyAsync(
            "Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30), companyResponseCount: 3, targetAudienceCount: 24);
        await SeedResponsesAsync(survey, _engineeringId, 3);

        var raw = await ReadRawAsync(await LeaderAsync());
        var row = SurveyRow(raw, survey);

        // Null -- not 3, and not 0, which would read "nobody in this team has answered".
        Assert.Equal(JsonValueKind.Null, row.GetProperty("responseCount").ValueKind);
        // The whole company's 3 is under the floor as well: beside a hatched team count it
        // would say the team has at most 3.
        Assert.Equal(JsonValueKind.Null, row.GetProperty("companyResponseCount").ValueKind);
        // The invited headcount is not a response count, and travels as the author entered it.
        Assert.Equal(24, row.GetProperty("companyTargetAudienceCount").GetInt32());
        // And the running total leaves out the one survey the team answered under the floor.
        Assert.Equal(0, raw.GetProperty("completedResponseCount").GetInt32());
    }

    [Fact]
    public async Task At_the_floor_the_team_count_is_the_departments_and_the_company_total_the_companys()
    {
        var survey = await SeedSurveyAsync(
            "Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30), companyResponseCount: 7, targetAudienceCount: 24);
        await SeedResponsesAsync(survey, _engineeringId, 5);
        await SeedResponsesAsync(survey, _engineeringId, 1, isComplete: false);
        await SeedResponsesAsync(survey, _salesId, 2);

        var body = await ReadAsync(await LeaderAsync());
        var row = Assert.Single(body.ActiveSurveys, s => s.Id == survey);

        // Engineering's five completed -- not its incomplete one, not Sales' two, and not
        // the company's seven, which travels under its own name.
        Assert.Equal<int?>(5, row.ResponseCount);
        Assert.Equal<int?>(7, row.CompanyResponseCount);
        Assert.Equal<int?>(24, row.CompanyTargetAudienceCount);
        Assert.Equal(5, body.CompletedResponseCount);
    }

    /// <summary>
    /// The running total is read twice by anyone who opens the page twice. Counted over every
    /// survey, it moved by exactly the open survey's hatched count between the two reads.
    /// </summary>
    [Fact]
    public async Task The_running_total_never_moves_by_a_count_under_the_floor()
    {
        var closed = await SeedSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-10));
        await SeedResponsesAsync(closed, _engineeringId, 6);
        var open = await SeedSurveyAsync("Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30));
        await SeedResponsesAsync(open, _engineeringId, 3);

        var leader = await LeaderAsync();
        Assert.Equal(6, (await ReadAsync(leader)).CompletedResponseCount);

        // A fourth answer to the open survey: the total must not move, or the two reads
        // give the hatched count back by subtraction.
        await SeedResponsesAsync(open, _engineeringId, 1);
        Assert.Equal(6, (await ReadAsync(leader)).CompletedResponseCount);

        // At five the open survey's count is printed anyway, so the total may carry it.
        await SeedResponsesAsync(open, _engineeringId, 1);
        var body = await ReadAsync(leader);
        Assert.Equal(11, body.CompletedResponseCount);
        Assert.Equal<int?>(5, Assert.Single(body.ActiveSurveys, s => s.Id == open).ResponseCount);
    }

    // ------------------------------------------------------------------
    // The team's reading, and the organisation's beside it
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_teams_reading_is_the_latest_closed_survey_never_an_archived_one()
    {
        var q3 = await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 5, sales: 5);
        // Archived before its end date, a month ahead, with one answer -- the demo tenant's
        // "(Copia)". By end date it out-ranks Q3; it is not a reading anybody ran.
        var copy = await SeedScoredSurveyAsync("Q4 (Copy)", SurveyStatuses.Archived, DateTimeOffset.UtcNow.AddDays(30), engineering: 1, sales: 0);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        Assert.NotEqual(copy, climate.SurveyId);
        Assert.Equal(q3, climate.SurveyId);
        Assert.False(climate.IsSuppressed);
        Assert.Equal(5, climate.RespondentCount);
    }

    [Fact]
    public async Task The_organisation_side_is_the_whole_companys_reading_of_the_same_survey()
    {
        var survey = await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 5, sales: 5);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        Assert.Equal(survey, climate.SurveyId);
        // The team's side is Engineering's alone ...
        Assert.Equal<double?>(4.0, Score(climate.Dimensions, "trust"));
        Assert.Equal<double?>(3.0, Score(climate.Dimensions, "workload"));
        // ... and the organisation's is everyone's: ten respondents, (5x4 + 5x2) / 10 and
        // (5x3 + 5x2) / 10.
        var organization = Assert.IsType<DashboardOrganizationClimate>(climate.Organization);
        Assert.Equal(10, organization.RespondentCount);
        Assert.Equal<double?>(3.0, Score(organization.Dimensions, "trust"));
        Assert.Equal<double?>(2.5, Score(organization.Dimensions, "workload"));
    }

    [Fact]
    public async Task The_organisation_side_is_withheld_when_the_rest_of_the_company_is_under_the_floor()
    {
        // Engineering five, everyone else three: the company's reading and the team's, with
        // both counts, give the other three's reading by subtraction.
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 5, sales: 3);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        // The team's own reading is disclosed, so this passes because of the rest and not
        // because the whole block was withheld.
        Assert.False(climate.IsSuppressed);
        Assert.Equal<double?>(4.0, Score(climate.Dimensions, "trust"));
        Assert.Null(climate.Organization);
    }

    [Fact]
    public async Task A_team_that_is_the_whole_company_reads_its_own_reading_as_the_organisations()
    {
        // Nobody answered outside the team, so there is no rest whose reading the two sides
        // could give away.
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 5, sales: 0);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        var organization = Assert.IsType<DashboardOrganizationClimate>(climate.Organization);
        Assert.Equal(5, organization.RespondentCount);
        Assert.Equal<double?>(4.0, Score(organization.Dimensions, "trust"));
    }

    [Fact]
    public async Task A_withheld_team_reading_carries_no_organisation_side()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 3, sales: 6);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        Assert.True(climate.IsSuppressed);
        Assert.Equal(0, climate.RespondentCount);
        Assert.NotEmpty(climate.Dimensions);
        Assert.All(climate.Dimensions, d => Assert.Null(d.AverageScore));
        Assert.Null(climate.Organization);
    }

    // ------------------------------------------------------------------
    // Reading and seeding
    // ------------------------------------------------------------------

    private Task<HttpClient> LeaderAsync() => _harness.ClientAsync(Roles.Leader, _companyId, _engineeringId);

    private static async Task<JsonElement> ReadRawAsync(HttpClient client)
    {
        var response = await client.GetAsync("/dashboard/department-admin");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<DepartmentAdminDashboard> ReadAsync(HttpClient client)
    {
        var response = await client.GetAsync("/dashboard/department-admin");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<DepartmentAdminDashboard>())!;
    }

    private static JsonElement SurveyRow(JsonElement raw, Guid surveyId)
        => raw.GetProperty("activeSurveys").EnumerateArray().Single(e => e.GetProperty("id").GetGuid() == surveyId);

    private static double? Score(IReadOnlyList<DashboardDimensionScore> dimensions, string key)
        => Assert.Single(dimensions, d => d.Dimension == key).AverageScore;

    /// <param name="companyResponseCount">
    /// The survey row's own denormalised company-wide tally, which <c>SurveyResponseEndpoints</c>
    /// bumps once per completed response anywhere in the tenant; seeded directly, as
    /// <c>DashboardEndpointsTests</c> seeds it.
    /// </param>
    private Task<Guid> SeedSurveyAsync(
        string title,
        string status,
        DateTimeOffset endDate,
        int companyResponseCount = 0,
        int? targetAudienceCount = null)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var survey = new Survey
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                CreatedBy = _authorId,
                TitleEn = title,
                TitleEs = $"{title} (ES)",
                Language = "both",
                Type = "general_climate",
                StartDate = endDate.AddDays(-30),
                EndDate = endDate,
                Status = status,
                ResponseCount = companyResponseCount,
                TargetAudienceCount = targetAudienceCount,
                Settings = new SurveySettings { Anonymous = true },
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Surveys.Add(survey);
            await db.SaveChangesAsync();
            return survey.Id;
        });

    /// <summary>
    /// A survey with two scale questions -- <c>trust</c> and <c>workload</c> -- answered 4 and 3
    /// by every Engineering respondent and 2 and 2 by every Sales one, so each side's mean is
    /// arithmetic a reader can check.
    /// </summary>
    private async Task<Guid> SeedScoredSurveyAsync(string title, string status, DateTimeOffset endDate, int engineering, int sales)
    {
        var survey = await SeedSurveyAsync(title, status, endDate);
        var (trust, workload) = await _harness.WithDbAsync(async db =>
        {
            var trustQuestion = ScaleQuestion(survey, 0, "trust");
            var workloadQuestion = ScaleQuestion(survey, 1, "workload");
            db.Questions.AddRange(trustQuestion, workloadQuestion);
            await db.SaveChangesAsync();
            return (trustQuestion.Id, workloadQuestion.Id);
        });

        await SeedResponsesAsync(survey, _engineeringId, engineering, answers: [(trust, 4), (workload, 3)]);
        await SeedResponsesAsync(survey, _salesId, sales, answers: [(trust, 2), (workload, 2)]);
        return survey;
    }

    private static Question ScaleQuestion(Guid surveyId, int order, string category)
        => new()
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            TextEn = $"A {category} statement",
            TextEs = $"Una afirmación de {category}",
            Type = QuestionTypes.Likert,
            ScaleMin = 1,
            ScaleMax = 5,
            Required = true,
            Order = order,
            Category = category,
        };

    private Task SeedResponsesAsync(
        Guid surveyId,
        Guid? departmentId,
        int count,
        bool isComplete = true,
        IReadOnlyList<(Guid QuestionId, int Value)>? answers = null)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            for (var i = 0; i < count; i++)
            {
                var responseId = Guid.NewGuid();
                db.Responses.Add(new Response
                {
                    Id = responseId,
                    SurveyId = surveyId,
                    CompanyId = _companyId,
                    DepartmentId = departmentId,
                    SessionId = Guid.NewGuid().ToString("N"),
                    Language = "en",
                    IsComplete = isComplete,
                    IsAnonymous = true,
                    StartTime = now.AddMinutes(-5),
                    CompletionTime = isComplete ? now : null,
                    TotalTimeSeconds = isComplete ? 300 : null,
                    CreatedAt = now,
                    UpdatedAt = now,
                });

                foreach (var (questionId, value) in answers ?? [])
                {
                    // response_value is jsonb: a bare number is valid JSON, and the
                    // aggregation reads a JSON number back as its raw text.
                    db.QuestionResponses.Add(new QuestionResponse
                    {
                        ResponseId = responseId,
                        QuestionId = questionId,
                        ResponseValue = JsonSerializer.Serialize(value),
                    });
                }
            }

            await db.SaveChangesAsync();
        });
}
