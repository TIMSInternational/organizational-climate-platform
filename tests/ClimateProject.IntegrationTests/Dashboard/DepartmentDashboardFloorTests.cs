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
/// SupervisorDashboard, 10 Sep) hatch the open survey's team count under the floor. A screen that
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

    /// <summary>
    /// A team of two that has answered an open survey reads as withheld -- null on the wire,
    /// never 2 and never 0 -- and so does the company's count beside it, which at 2 is under
    /// the same floor. Ruled 2026-10-21: a leader's own team is held to 3.
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    public async Task An_open_surveys_team_count_under_three_is_withheld_and_absent_reads_the_same(int answered)
    {
        var survey = await SeedSurveyAsync(
            "Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30), companyResponseCount: answered, targetAudienceCount: 24);
        await SeedResponsesAsync(survey, _engineeringId, answered);

        var raw = await ReadRawAsync(await LeaderAsync());
        var row = SurveyRow(raw, survey);

        // Withheld, and withheld identically for 0, 1 and 2: "nobody answered" and "two
        // answered" must not be told apart.
        Assert.Equal(JsonValueKind.Null, row.GetProperty("responseCount").ValueKind);
        Assert.Equal(JsonValueKind.Null, row.GetProperty("companyResponseCount").ValueKind);
        // The invited headcount is not a response count, and travels as the author entered it.
        Assert.Equal(24, row.GetProperty("companyTargetAudienceCount").GetInt32());
        // The running total carries no survey this team answered under the floor.
        Assert.Equal(0, raw.GetProperty("completedResponseCount").GetInt32());
    }

    [Fact]
    public async Task An_open_surveys_team_count_of_three_is_reported()
    {
        var survey = await SeedSurveyAsync(
            "Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30), companyResponseCount: 3, targetAudienceCount: 24);
        await SeedResponsesAsync(survey, _engineeringId, SurveyResultsPrivacy.MinimumSegmentRespondents);

        var raw = await ReadRawAsync(await LeaderAsync());
        var row = SurveyRow(raw, survey);

        Assert.Equal(3, row.GetProperty("responseCount").GetInt32());
        Assert.Equal(3, row.GetProperty("companyResponseCount").GetInt32());
        Assert.Equal(3, raw.GetProperty("completedResponseCount").GetInt32());
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
    /// survey, it would move by exactly the open survey's withheld count between the two reads,
    /// so it sums only the surveys this team answered at or over the floor.
    /// </summary>
    [Fact]
    public async Task The_running_total_moves_only_when_a_surveys_team_count_reaches_the_floor()
    {
        var closed = await SeedSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-10));
        await SeedResponsesAsync(closed, _engineeringId, 6);
        var open = await SeedSurveyAsync("Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30));
        await SeedResponsesAsync(open, _engineeringId, 1);

        var leader = await LeaderAsync();
        Assert.Equal(6, (await ReadAsync(leader)).CompletedResponseCount);

        // A second answer is still under the floor: the total does not move, so the two reads
        // cannot be differenced into "one more person answered".
        await SeedResponsesAsync(open, _engineeringId, 1);
        Assert.Equal(6, (await ReadAsync(leader)).CompletedResponseCount);

        // At the floor the open survey's count is printed, so the total may carry it.
        await SeedResponsesAsync(open, _engineeringId, 1);
        var body = await ReadAsync(leader);
        Assert.Equal(6 + SurveyResultsPrivacy.MinimumSegmentRespondents, body.CompletedResponseCount);
        Assert.Equal<int?>(SurveyResultsPrivacy.MinimumSegmentRespondents, Assert.Single(body.ActiveSurveys, s => s.Id == open).ResponseCount);
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

    /// <summary>
    /// <b>The rest-of-company guard, at 3 again since 2026-10-21.</b>
    ///
    /// <para>
    /// Engineering at five, everyone else at one or two: the company's reading and the team's,
    /// with both counts, give the rest's reading by subtraction -- (7 x company - 5 x team) / 2
    /// is two people's answers. A leader cannot open the results screens, so this would be the
    /// only way they could learn it, and the organisation side is withheld. The team's own
    /// reading, at five, is still disclosed.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task A_rest_of_company_under_three_withholds_the_organisation_side_and_keeps_the_team(int rest)
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 5, sales: rest);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        Assert.False(climate.IsSuppressed);
        Assert.Equal(5, climate.RespondentCount);
        Assert.Equal<double?>(4.0, Score(climate.Dimensions, "trust"));
        Assert.Null(climate.Organization);
    }

    [Fact]
    public async Task A_rest_of_company_of_three_discloses_the_organisation_side()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 5, sales: 3);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        var organization = Assert.IsType<DashboardOrganizationClimate>(climate.Organization);
        Assert.Equal(8, organization.RespondentCount);
        // (5x4 + 3x2) / 8 = 3.25.
        Assert.Equal<double?>(3.25, Score(organization.Dimensions, "trust"));
    }

    // ------------------------------------------------------------------
    // The team's own reading, held to 3 for every caller (ruled 2026-10-21)
    // ------------------------------------------------------------------

    /// <summary>
    /// A team of one or two is withheld from its leader and its supervisor: no score, no
    /// respondent count (0, the same value an absent team gets), no organisation side -- and the
    /// floor reported is the one that withheld it, 3, not the administrator's 1.
    /// </summary>
    [Theory]
    [InlineData(Roles.Leader, 1)]
    [InlineData(Roles.Leader, 2)]
    [InlineData(Roles.Supervisor, 1)]
    [InlineData(Roles.Supervisor, 2)]
    public async Task A_team_of_one_or_two_is_withheld_and_reports_the_floor_of_three(string role, int team)
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: team, sales: 6);

        var climate = (await ReadAsync(await _harness.ClientAsync(role, _companyId, _engineeringId))).Climate!;

        Assert.True(climate.IsSuppressed);
        Assert.Equal(0, climate.RespondentCount);
        Assert.Equal(SurveyResultsPrivacy.MinimumSegmentRespondents, climate.MinimumGroupSize);
        Assert.Equal(3, climate.MinimumGroupSize);
        Assert.NotEmpty(climate.Dimensions);
        Assert.All(climate.Dimensions, d => Assert.Null(d.AverageScore));
        Assert.Null(climate.Organization);
    }

    /// <summary>
    /// Too small and absent are one answer: the payload for a team of two is byte-for-byte the
    /// payload for a team that did not answer, so a reader cannot difference them.
    /// </summary>
    [Fact]
    public async Task A_team_of_two_and_a_team_that_did_not_answer_read_identically()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 2, sales: 6);

        var engineering = (await ReadRawAsync(await LeaderAsync())).GetProperty("climate");
        var sales = (await ReadRawAsync(await _harness.ClientAsync(Roles.Leader, _companyId, _salesId))).GetProperty("climate");
        var absentDepartment = await _harness.SeedDepartmentAsync(_companyId, "Legal");
        var absent = (await ReadRawAsync(await _harness.ClientAsync(Roles.Leader, _companyId, absentDepartment))).GetProperty("climate");

        // Sales, at six, is the control: a disclosed reading, so the comparison is not two
        // empty payloads agreeing.
        Assert.False(sales.GetProperty("isSuppressed").GetBoolean());
        Assert.Equal(absent.GetRawText(), engineering.GetRawText());
    }

    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    public async Task A_team_of_three_is_shown_and_reports_the_floor_of_three(string role)
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 3, sales: 6);

        var climate = (await ReadAsync(await _harness.ClientAsync(role, _companyId, _engineeringId))).Climate!;

        Assert.False(climate.IsSuppressed);
        Assert.Equal(3, climate.RespondentCount);
        Assert.Equal(3, climate.MinimumGroupSize);
        Assert.Equal<double?>(4.0, Score(climate.Dimensions, "trust"));
        Assert.Equal<double?>(3.0, Score(climate.Dimensions, "workload"));
        Assert.NotNull(climate.Organization);
    }

    /// <summary>
    /// A survey under its own floor reports the team floor too, not the administrator's 1.
    /// </summary>
    [Fact]
    public async Task A_survey_under_its_own_floor_reports_the_team_floor()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 2, sales: 0);

        var climate = (await ReadAsync(await LeaderAsync())).Climate!;

        Assert.True(climate.IsSuppressed);
        Assert.Empty(climate.Dimensions);
        Assert.Equal(3, climate.MinimumGroupSize);
    }

    /// <summary>
    /// <b>An administrator calling the team view gets the team view's floor.</b> The 2026-10-15
    /// ruling (a single department reported from one respondent) is kept on the administrator's
    /// own screens; this page is one floor whoever asks, so it and its export cannot differ by
    /// caller.
    /// </summary>
    [Theory]
    [InlineData(Roles.CompanyAdmin)]
    [InlineData(Roles.SuperAdmin)]
    public async Task An_administrator_reading_the_team_view_gets_the_same_floor_of_three(string role)
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 2, sales: 6);

        var client = await _harness.ClientAsync(role, _companyId);
        var response = await client.GetAsync($"/dashboard/department-admin?departmentId={_engineeringId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var climate = (await response.Content.ReadFromJsonAsync<DepartmentAdminDashboard>())!.Climate!;

        Assert.True(climate.IsSuppressed);
        Assert.Equal(3, climate.MinimumGroupSize);
        Assert.All(climate.Dimensions, d => Assert.Null(d.AverageScore));
    }

    // ------------------------------------------------------------------
    // The export mirrors the screen
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_export_withholds_a_team_of_two_exactly_as_the_screen_does()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 2, sales: 6);
        var open = await SeedSurveyAsync("Q4 open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30), companyResponseCount: 2);
        await SeedResponsesAsync(open, _engineeringId, 2);

        var leader = await LeaderAsync();
        var screen = await ReadAsync(leader);
        Assert.True(screen.Climate!.IsSuppressed);
        Assert.Null(Assert.Single(screen.ActiveSurveys).ResponseCount);

        var csv = await (await leader.GetAsync("/dashboard/department-admin/export")).Content.ReadAsStringAsync();

        // The withheld reading prints as the notice and the floor that withheld it -- 3.
        Assert.Contains("This team is below the anonymity floor", csv, StringComparison.Ordinal);
        Assert.Contains("\"Minimum group size\",\"3\"", csv, StringComparison.Ordinal);
        // The open survey's two is printed as the word, with the floor of 3 in the notice.
        Assert.Contains("Q4 open", csv, StringComparison.Ordinal);
        Assert.Contains("fewer than 3 responses from this team", csv, StringComparison.Ordinal);
        Assert.DoesNotContain("\"Respondents\"", csv, StringComparison.Ordinal);
        Assert.Contains("\"Completed responses\",\"0\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_export_discloses_a_team_of_three_exactly_as_the_screen_does()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 3, sales: 6);

        var leader = await LeaderAsync();
        var screen = await ReadAsync(leader);
        Assert.False(screen.Climate!.IsSuppressed);

        var csv = await (await leader.GetAsync("/dashboard/department-admin/export")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("This team is below the anonymity floor", csv, StringComparison.Ordinal);
        Assert.Contains($"\"Respondents\",\"{screen.Climate.RespondentCount}\"", csv, StringComparison.Ordinal);
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

    /// <summary>
    /// A withheld team reading still carries no organisation side -- the guarantee outlives the
    /// floor that used to produce it.
    /// </summary>
    /// <remarks>
    /// There are two ways to a withheld reading: the team was too small, or the team did not
    /// answer. This fixture is the second -- Engineering has NO responses; the first is
    /// <see cref="A_team_of_one_or_two_is_withheld_and_reports_the_floor_of_three"/>. The handler returns before it computes the organisation side, and that early
    /// return is what this test pins: told apart, a reader could difference "we did not answer"
    /// against "we were too few" and learn roughly how few -- which is why the two collapse to
    /// one withheld answer on purpose, and still do.
    /// </remarks>
    [Fact]
    public async Task A_withheld_team_reading_carries_no_organisation_side()
    {
        await SeedScoredSurveyAsync("Q3", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-30), engineering: 0, sales: 6);

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
                Type = "periodic",
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
