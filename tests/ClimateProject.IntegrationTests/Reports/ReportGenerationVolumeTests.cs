using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// req(#88, sixth acceptance criterion): "Generation of a realistically-sized report
/// completes without timing out."
///
/// <para>Until this test existed that criterion was unverified rather than passing: the
/// largest response set any report test built was <c>Enumerable.Range(0, 24)</c>, and
/// generation had never been exercised beyond a couple of dozen answers. The criterion
/// is also the one most likely to matter for PROCOMER, which is a whole agency rather
/// than a team.</para>
///
/// <para><b>Why the shape of the generator makes this worth measuring.</b>
/// <c>ReportGeneration.GenerateAsync</c> loops the company's surveys and calls
/// <c>SurveyAggregateLoader.ComputeAsync</c> once per survey, sequentially. Each of
/// those calls issues about six queries and materialises whole tables into memory --
/// <c>db.QuestionResponses...ToListAsync()</c> pulls EVERY individual answer row for
/// the survey, then aggregates in-process. The cost is therefore
/// (surveys x respondents x questions), all of it on the request thread, on an App
/// Runner instance provisioned at a fraction of a vCPU.</para>
///
/// <para><b>The axis that actually grows, and it is not response volume.</b>
/// <c>CreateReportRequest</c> carries no period, and the survey query filters only on
/// company and <c>Status != Draft</c> -- there is no date range anywhere in the
/// selection. So every report aggregates <em>every non-draft survey the company has
/// ever had</em>, and that set only ever grows: nothing prunes it, and closing a survey
/// keeps it in scope rather than removing it. Report cost is therefore
/// (surveys ever run) x (per-survey cost), and the measured per-survey cost below is the
/// multiplier. At the measured 0.25 s per survey, roughly forty survey cycles reaches
/// this test's ten-second budget on response volume alone -- which is a decade of
/// quarterly surveys, not a near-term problem, but it is a slope with no bound on it
/// rather than a plateau. Whoever revisits this should decide whether a report is meant
/// to be company-wide-forever or scoped to a period; today it is the former, silently.</para>
/// </summary>
[Collection("Postgres")]
public class ReportGenerationVolumeTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly ITestOutputHelper _output;
    private readonly string _companyDomain = $"vol-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    /// <summary>
    /// The instrument CLIO proposed is 44 questions "growing to about 50", so 50 is the
    /// real question count rather than a round number chosen for arithmetic.
    /// </summary>
    private const int Questions = 50;

    /// <summary>
    /// 800 completed responses across 4 departments. Chosen to be an agency-sized census
    /// rather than a team-sized one, while keeping the seed inside a CI budget: it
    /// produces 40,000 rows in <c>question_responses</c>, which is the table the loader
    /// materialises in full.
    /// </summary>
    private const int Respondents = 800;

    public ReportGenerationVolumeTests(PostgresContainerFixture postgres, ITestOutputHelper output)
    {
        _factory = postgres.App;
        _output = output;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company
        {
            Id = _companyId = Guid.NewGuid(),
            Name = "Volume Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task A_realistically_sized_report_generates_within_the_budget()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var departmentIds = await SeedDepartmentsAsync(4);
        var surveyId = await CreateInstrumentSizedSurveyAsync(client);
        var seedElapsed = await SeedResponsesAsync(surveyId, departmentIds);

        // Only generation is timed. Seeding is an artefact of the test, not of the
        // product, and folding it in would measure the wrong thing.
        var stopwatch = Stopwatch.StartNew();
        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Volume Climate Report", null, "climate_summary", _companyId, "pdf", null));
        stopwatch.Stop();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ReportDetail>();
        Assert.Equal("completed", created!.Status);

        var document = JsonSerializer.Deserialize<ReportOutputDocument>(
            created.ReportOutput!, JsonSerializerOptions.Web)!;

        _output.WriteLine(
            $"seeded {Respondents} responses x {Questions} questions = "
            + $"{Respondents * Questions:N0} answers in {seedElapsed.TotalSeconds:F1}s");
        _output.WriteLine($"GENERATION: {stopwatch.Elapsed.TotalSeconds:F2}s");

        // The report must actually contain the survey it was generated over. A generator
        // that silently produced an empty document would otherwise be the fastest of all,
        // and this test would reward it.
        var section = Assert.Single(document.Surveys);
        Assert.Equal(Questions, section.Questions.Count);
        Assert.Equal(Respondents, section.Participation.CompletedCount);

        Assert.True(
            stopwatch.Elapsed < Budget,
            $"Report generation took {stopwatch.Elapsed.TotalSeconds:F2}s for "
            + $"{Respondents * Questions:N0} answers, over the {Budget.TotalSeconds:F0}s budget. "
            + "See the class comment: the loader materialises question_responses in full, "
            + "so this grows with respondents x questions x surveys.");
    }

    /// <summary>
    /// Measured on this path 2026-09-01, one closed survey, generation only:
    ///
    /// <list type="table">
    ///   <item><term>40,000 answers (800 x 50)</term><description>0.25 s</description></item>
    ///   <item><term>100,000 answers (2,000 x 50)</term><description>0.44 s</description></item>
    ///   <item><term>200,000 answers (4,000 x 50)</term><description>0.70 s</description></item>
    /// </list>
    ///
    /// <para>The cost is <b>sub-linear</b>: five times the answers cost 2.8x the time,
    /// because fixed per-survey overhead dominates and the aggregation itself is a single
    /// in-memory pass. The concern written into <c>ReportGeneration.GenerateAsync</c> --
    /// that this is the trigger for moving generation to a background job -- is real in
    /// shape but nowhere near being reached: 200,000 answers is far past a PROCOMER cycle
    /// and still finishes in under a second.</para>
    ///
    /// <para>10 seconds is therefore a 40x margin over the measured 0.25 s. That is loose
    /// enough to survive a shared CI runner without flaking, and tight enough that an
    /// accidental N+1 inside the per-question or per-department loop -- the regression
    /// this guards -- blows through it immediately rather than hiding inside a budget so
    /// large that nothing could ever fail it.</para>
    /// </summary>
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(10);

    private async Task<IReadOnlyList<Guid>> SeedDepartmentsAsync(int count)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var ids = new List<Guid>();
        for (var i = 0; i < count; i++)
        {
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Name = $"Department {i}",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Departments.Add(department);
            ids.Add(department.Id);
        }

        await db.SaveChangesAsync();
        return ids;
    }

    private async Task<Guid> CreateInstrumentSizedSurveyAsync(HttpClient client)
    {
        // Five categories across fifty questions, because the report rolls dimensions up
        // by category: one category would exercise the aggregation far more weakly than a
        // real instrument does.
        string[] categories = ["leadership", "communication", "workload", "recognition", "growth"];
        var questions = Enumerable.Range(0, Questions).Select(i => new CreateSurveyQuestionInput(
            LocalizedInput.FromBare($"Statement {i + 1}"),
            "likert",
            Options:
            [
                new CreateSurveyQuestionOptionInput("1", LocalizedInput.FromBare("Strongly disagree")),
                new CreateSurveyQuestionOptionInput("2", LocalizedInput.FromBare("Disagree")),
                new CreateSurveyQuestionOptionInput("3", LocalizedInput.FromBare("Neutral")),
                new CreateSurveyQuestionOptionInput("4", LocalizedInput.FromBare("Agree")),
                new CreateSurveyQuestionOptionInput("5", LocalizedInput.FromBare("Strongly agree")),
            ],
            Order: i,
            Category: categories[i % categories.Length])).ToList();

        var response = await client.PostAsJsonAsync("/surveys", new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Agency-wide climate"),
            CompanyId: _companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: null,
            Questions: questions,
            Language: null));
        response.EnsureSuccessStatusCode();
        var surveyId = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!.Id;

        // POST /surveys creates a DRAFT, and ReportGeneration selects
        // `Status != SurveyStatuses.Draft`. Left as created, the survey is excluded, the
        // document comes back with no sections, and generation "passes" in 0.07s having
        // aggregated nothing -- which is exactly what happened the first time this test
        // ran. Closing it is also the honest state for a report: a closed survey is the
        // one whose "results are final and analysable".
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var survey = await db.Surveys.FirstAsync(s => s.Id == surveyId);
            survey.Status = SurveyStatuses.Closed;
            await db.SaveChangesAsync();
        }

        return surveyId;
    }

    private async Task<TimeSpan> SeedResponsesAsync(Guid surveyId, IReadOnlyList<Guid> departmentIds)
    {
        var stopwatch = Stopwatch.StartNew();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var questionIds = await db.Questions
            .AsNoTracking()
            .Where(q => q.SurveyId == surveyId)
            .OrderBy(q => q.Order)
            .Select(q => q.Id)
            .ToListAsync();
        Assert.Equal(Questions, questionIds.Count);

        // Change tracking is the dominant cost when adding tens of thousands of entities
        // one at a time; without this the seed alone runs for minutes.
        db.ChangeTracker.AutoDetectChangesEnabled = false;

        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < Respondents; i++)
        {
            var responseId = Guid.NewGuid();
            db.Responses.Add(new Response
            {
                Id = responseId,
                SurveyId = surveyId,
                CompanyId = _companyId,
                UserId = null,
                DepartmentId = departmentIds[i % departmentIds.Count],
                SessionId = Guid.NewGuid().ToString("N"),
                Language = "en",
                IsComplete = true,
                IsAnonymous = true,
                StartTime = now.AddMinutes(-5),
                CompletionTime = now,
            });

            for (var q = 0; q < questionIds.Count; q++)
            {
                // Spread the answers across the whole scale rather than writing a constant:
                // a single repeated value gives every question a zero-variance distribution,
                // which is both unrealistic and cheaper to aggregate than real data.
                var value = ((i + q) % 5) + 1;
                db.QuestionResponses.Add(new QuestionResponse
                {
                    ResponseId = responseId,
                    QuestionId = questionIds[q],
                    ResponseValue = JsonSerializer.Serialize(value.ToString()),
                    ResponseText = null,
                });
            }
        }

        await db.SaveChangesAsync();
        stopwatch.Stop();
        return stopwatch.Elapsed;
    }

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Volume User", email, "A-good-passw0rd"));
        signup.EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }
}
