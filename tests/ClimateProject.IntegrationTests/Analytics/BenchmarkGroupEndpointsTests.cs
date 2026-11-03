using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Benchmarks;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Analytics;

/// <summary>
/// <c>/admin/benchmark-groups</c> end to end on Postgres. The arithmetic is proved in
/// <c>BenchmarkGroupReadingTests</c>; what needs a database is which companies and surveys
/// count -- closed, of the group's instrument family, over the respondent floor, meeting the
/// criteria, never the subject itself -- and that the routes are TIMS's alone and audited.
///
/// The database is shared by the whole collection, so every criterion here carries a value no
/// other test writes (<see cref="_sector"/>): a group matching "any sector" would count other
/// classes' companies.
/// </summary>
[Collection("Postgres")]
public class BenchmarkGroupEndpointsTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private readonly string _sector = $"Sector {Guid.NewGuid():N}";
    private Guid _subject;

    public BenchmarkGroupEndpointsTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"bg-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        // trust 4 → 75, pay 2 → 25: overall 50.
        _subject = await CompanyWithSurveyAsync("Subject", trust: 4, pay: 2);
        // trust 3 → 50, pay 3 → 50: overall 50.
        await CompanyWithSurveyAsync("Member one", trust: 3, pay: 3);
        // trust 5 → 100: overall 100.
        await CompanyWithSurveyAsync("Member two", trust: 5);
        // trust 4 → 75, pay 5 → 100: overall 87.5.
        await CompanyWithSurveyAsync("Member three", trust: 4, pay: 5);
        // Never inputs: under the respondent floor, another sector, another instrument family.
        await CompanyWithSurveyAsync("Two answers", trust: 1, responses: 2);
        await CompanyWithSurveyAsync("Other sector", trust: 1, sector: $"Other {Guid.NewGuid():N}");
        await CompanyWithSurveyAsync("Culture", trust: 1, serviceType: ClimateServiceTypes.OrganizationalCulture);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> SuperAdminAsync() => _harness.ClientAsync(Roles.SuperAdmin, null);

    private async Task<Guid> CompanyWithSurveyAsync(
        string name,
        int trust,
        int? pay = null,
        int responses = 3,
        string? sector = null,
        string serviceType = ClimateServiceTypes.GeneralClimate)
    {
        var companyId = await _harness.SeedCompanyAsync($"{name} {Guid.NewGuid():N}");
        await _harness.WithDbAsync(async db =>
        {
            var company = await db.Companies.FirstAsync(c => c.Id == companyId);
            company.Industry = sector ?? _sector;
            company.Country = "Costa Rica";
            await db.SaveChangesAsync();
        });

        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, companyId);
        List<CreateSurveyQuestionInput> questions =
        [
            new(LocalizedInput.FromBare("I trust my leader"), "likert", ScaleMin: 1, ScaleMax: 5, Order: 0, Category: "trust"),
        ];
        if (pay is not null)
        {
            questions.Add(new(LocalizedInput.FromBare("My pay is fair"), "likert", ScaleMin: 1, ScaleMax: 5, Order: 1, Category: "pay"));
        }

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(companyId, questions: questions));
        for (var i = 0; i < responses; i++)
        {
            await _harness.WithDbAsync(async db =>
            {
                var responseId = Guid.NewGuid();
                db.Responses.Add(new Response
                {
                    Id = responseId,
                    SurveyId = survey.Id,
                    CompanyId = companyId,
                    SessionId = Guid.NewGuid().ToString("N"),
                    Language = ContentLanguages.English,
                    IsComplete = true,
                    IsAnonymous = true,
                    StartTime = DateTimeOffset.UtcNow.AddMinutes(-5),
                    CompletionTime = DateTimeOffset.UtcNow,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
                db.QuestionResponses.Add(new QuestionResponse
                {
                    ResponseId = responseId,
                    QuestionId = survey.Questions.Single(q => q.Category == "trust").Id,
                    ResponseValue = JsonSerializer.Serialize(trust.ToString()),
                });
                if (pay is { } value)
                {
                    db.QuestionResponses.Add(new QuestionResponse
                    {
                        ResponseId = responseId,
                        QuestionId = survey.Questions.Single(q => q.Category == "pay").Id,
                        ResponseValue = JsonSerializer.Serialize(value.ToString()),
                    });
                }

                await db.SaveChangesAsync();
            });
        }

        // The instrument family and the close are set directly: a survey created with a
        // service type spends a licence seat, which is not what this class is about.
        await _harness.WithDbAsync(async db =>
        {
            var row = await db.Surveys.FirstAsync(s => s.Id == survey.Id);
            row.ServiceType = serviceType;
            row.Status = SurveyStatuses.Closed;
            row.EndDate = DateTimeOffset.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();
        });
        return companyId;
    }

    private async Task<BenchmarkGroupDto> CreateGroupAsync(HttpClient client, string? sector = null)
    {
        var response = await client.PostAsJsonAsync("/admin/benchmark-groups", new CreateBenchmarkGroupRequest(
            $"Group {Guid.NewGuid():N}", sector ?? _sector, null, "costa rica", ClimateServiceTypes.GeneralClimate));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<BenchmarkGroupDto>())!;
    }

    [Fact]
    public async Task Every_route_is_refused_to_a_company_admin()
    {
        var group = await CreateGroupAsync(await SuperAdminAsync());
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _subject);

        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/admin/benchmark-groups")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/admin/benchmark-groups/options")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/admin/benchmark-groups/preview?serviceType={ClimateServiceTypes.GeneralClimate}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/admin/benchmark-groups/{group.Id}/reading?companyId={_subject}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync("/admin/benchmark-groups",
            new CreateBenchmarkGroupRequest("Mine", null, null, null, ClimateServiceTypes.GeneralClimate))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.DeleteAsync($"/admin/benchmark-groups/{group.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_group_counts_only_closed_surveys_of_its_family_over_the_floor_from_companies_meeting_its_criteria()
    {
        var client = await SuperAdminAsync();
        var group = await CreateGroupAsync(client);

        // Subject and the three members; not "Two answers", "Other sector" or "Culture".
        Assert.Equal(4, group.CompanyCount);
        Assert.Equal(BenchmarkGroupReading.MinimumCompanies, group.MinimumCompanies);
        Assert.NotNull(group.LatestSurveyOn);

        var listed = (await client.GetFromJsonAsync<List<BenchmarkGroupDto>>("/admin/benchmark-groups"))!;
        Assert.Equal(4, listed.Single(g => g.Id == group.Id).CompanyCount);

        var climate = await client.GetFromJsonAsync<BenchmarkGroupPreview>(
            $"/admin/benchmark-groups/preview?industry={Uri.EscapeDataString(_sector)}&serviceType={ClimateServiceTypes.GeneralClimate}");
        Assert.Equal(4, climate!.CompanyCount);
        var culture = await client.GetFromJsonAsync<BenchmarkGroupPreview>(
            $"/admin/benchmark-groups/preview?industry={Uri.EscapeDataString(_sector)}&serviceType={ClimateServiceTypes.OrganizationalCulture}");
        Assert.Equal(1, culture!.CompanyCount);

        var options = await client.GetFromJsonAsync<BenchmarkGroupOptions>("/admin/benchmark-groups/options");
        Assert.Contains(_sector, options!.Industries);
        Assert.Equal(ClimateServiceTypes.Metered, options.ServiceTypes);
    }

    [Fact]
    public async Task Reads_the_subject_against_the_others_never_against_itself()
    {
        var client = await SuperAdminAsync();
        var group = await CreateGroupAsync(client);

        var reading = (await client.GetFromJsonAsync<BenchmarkGroupReadingResponse>(
            $"/admin/benchmark-groups/{group.Id}/reading?companyId={_subject}"))!;

        Assert.Equal(BenchmarkReadingKinds.Ready, reading.Kind);
        // Three, not four: the subject is not one of its own group.
        Assert.Equal(3, reading.CompanyCount);
        Assert.Equal(50, reading.CompanyIndex!.Value, 6);
        // Overall indices 50, 100 and 87.5.
        Assert.Equal(87.5, reading.GroupMedian!.Value, 6);

        var trust = reading.Dimensions.Single(d => d.Key == "trust");
        Assert.Equal(75, trust.Score, 6);
        Assert.Equal(75, trust.Median!.Value, 6);
        Assert.Equal(3, trust.Companies);
        // Only two other companies asked about pay: no median for it.
        var pay = reading.Dimensions.Single(d => d.Key == "pay");
        Assert.Null(pay.Median);
        Assert.Equal(2, pay.Companies);
        Assert.Equal(ClimateServiceTypes.GeneralClimate, reading.Survey!.ServiceType);
    }

    [Fact]
    public async Task Under_three_other_companies_the_reading_says_so_and_carries_no_number()
    {
        var client = await SuperAdminAsync();
        var sector = $"Small {Guid.NewGuid():N}";
        var subject = await CompanyWithSurveyAsync("Small subject", trust: 4, sector: sector);
        await CompanyWithSurveyAsync("Small one", trust: 3, sector: sector);
        await CompanyWithSurveyAsync("Small two", trust: 5, sector: sector);
        var group = await CreateGroupAsync(client, sector);

        var reading = (await client.GetFromJsonAsync<BenchmarkGroupReadingResponse>(
            $"/admin/benchmark-groups/{group.Id}/reading?companyId={subject}"))!;

        Assert.Equal(BenchmarkReadingKinds.Insufficient, reading.Kind);
        Assert.Equal(2, reading.CompanyCount);
        Assert.Null(reading.CompanyIndex);
        Assert.Null(reading.GroupMedian);
        Assert.Empty(reading.Dimensions);
    }

    [Fact]
    public async Task A_reading_is_audited_under_the_company_that_was_read()
    {
        var client = await SuperAdminAsync();
        var group = await CreateGroupAsync(client);

        var response = await client.GetAsync($"/admin/benchmark-groups/{group.Id}/reading?companyId={_subject}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await _harness.WithDbAsync(async db =>
        {
            var row = await db.AuditLogs.SingleAsync(a => a.ResourceId == group.Id.ToString() && a.CompanyId == _subject);
            Assert.Equal("benchmark_group", row.Resource);
        });
    }

    [Fact]
    public async Task Creating_refuses_a_duplicate_name_and_an_unknown_family_and_deleting_removes_only_the_criteria()
    {
        var client = await SuperAdminAsync();
        var group = await CreateGroupAsync(client);

        var duplicate = await client.PostAsJsonAsync("/admin/benchmark-groups",
            new CreateBenchmarkGroupRequest(group.Name.ToUpperInvariant(), null, null, null, ClimateServiceTypes.GeneralClimate));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        var unknown = await client.PostAsJsonAsync("/admin/benchmark-groups",
            new CreateBenchmarkGroupRequest($"Unknown {Guid.NewGuid():N}", null, null, null, "periodic"));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        var noCompany = await client.GetAsync($"/admin/benchmark-groups/{group.Id}/reading");
        Assert.Equal(HttpStatusCode.BadRequest, noCompany.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/admin/benchmark-groups/{group.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/admin/benchmark-groups/{group.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/admin/benchmark-groups/{group.Id}/reading?companyId={_subject}")).StatusCode);
    }
}
