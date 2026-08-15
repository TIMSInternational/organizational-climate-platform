using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Analytics;

/// <summary>
/// Two companies are seeded rather than one, because the interesting half of this endpoint is
/// the denial: #207 closed a live cross-tenant hole in the neighbouring benchmark endpoints, so
/// every route here is exercised from the wrong tenant as well as the right one.
/// </summary>
[Collection("Postgres")]
public class AnalyticsInsightEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"anla-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"anlb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _surveyAId;
    private Guid _surveyBId;
    private Guid _departmentAId;
    private Guid _departmentBId;

    public AnalyticsInsightEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var companyA = new Company { Id = Guid.NewGuid(), Name = "Analytics Co A", EmailDomain = _companyADomain, CreatedAt = now };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Analytics Co B", EmailDomain = _companyBDomain, CreatedAt = now };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();

        var departmentA = new Department { Id = Guid.NewGuid(), CompanyId = companyA.Id, Name = "Engineering", CreatedAt = now, UpdatedAt = now };
        var departmentB = new Department { Id = Guid.NewGuid(), CompanyId = companyB.Id, Name = "Sales", CreatedAt = now, UpdatedAt = now };
        db.Departments.AddRange(departmentA, departmentB);
        _departmentAId = departmentA.Id;
        _departmentBId = departmentB.Id;
        await db.SaveChangesAsync();

        var authorA = await SeedUserAsync(db, companyA.Id);
        var authorB = await SeedUserAsync(db, companyB.Id);
        _surveyAId = await SeedSurveyAsync(db, companyA.Id, authorA);
        _surveyBId = await SeedSurveyAsync(db, companyB.Id, authorB);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static async Task<Guid> SeedUserAsync(ClimateProjectDbContext db, Guid companyId)
    {
        var now = DateTimeOffset.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            Email = $"member-{Guid.NewGuid():N}@member.test",
            Name = "Member",
            Role = Roles.Employee,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private static async Task<Guid> SeedSurveyAsync(ClimateProjectDbContext db, Guid companyId, Guid createdBy)
    {
        var now = DateTimeOffset.UtcNow;
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = "Annual climate survey",
            Language = "en",
            Type = "general_climate",
            StartDate = now,
            EndDate = now.AddDays(14),
            Status = "draft",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return survey.Id;
    }

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }

            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task<HttpClient> ClientAsync(string role, string domain, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, role, domain, companyId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static CreateAnalyticsInsightRequest CreateRequest(
        Guid companyId,
        string metricName = "Overall Engagement",
        Guid? surveyId = null,
        Guid? departmentId = null,
        string aggregationType = "company_wide",
        string metricType = "engagement",
        string? metricDescription = null,
        int totalResponses = 0)
        => new(surveyId, companyId, departmentId, aggregationType, metricType, metricName, metricDescription, totalResponses);

    private async Task<AnalyticsInsightDetail> CreateInsightAsync(HttpClient client, CreateAnalyticsInsightRequest request)
    {
        var response = await client.PostAsJsonAsync("/admin/analytics-insights", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<AnalyticsInsightDetail>())!;
    }

    [Fact]
    public async Task Create_an_insight_then_add_metric_data_and_a_time_series_point()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var created = await CreateInsightAsync(client, CreateRequest(
            _companyAId, surveyId: _surveyAId, departmentId: _departmentAId,
            metricDescription: "Mean of all engagement items.", totalResponses: 120));

        Assert.Equal(_companyAId, created.CompanyId);
        Assert.Equal(_surveyAId, created.SurveyId);
        Assert.Equal(_departmentAId, created.DepartmentId);
        Assert.Equal("Overall Engagement", created.MetricName);
        Assert.Equal(120, created.TotalResponses);
        // IsCurrent and CalculationDate are server-stamped, not accepted from the request.
        Assert.True(created.IsCurrent);
        Assert.NotEqual(default, created.CalculationDate);
        Assert.Empty(created.MetricData);
        Assert.Empty(created.TimeSeries);

        var metricResponse = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{created.Id}/metric-data",
            new AddMetricDataRequest("Satisfied", 42.5, 120, 60.0));
        Assert.Equal(HttpStatusCode.Created, metricResponse.StatusCode);

        var seriesResponse = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{created.Id}/time-series",
            new AddTimeSeriesPointRequest(DateTimeOffset.UtcNow, 42.5, 120));
        Assert.Equal(HttpStatusCode.Created, seriesResponse.StatusCode);

        var final = (await seriesResponse.Content.ReadFromJsonAsync<AnalyticsInsightDetail>())!;
        var point = Assert.Single(final.MetricData);
        Assert.Equal("Satisfied", point.Label);
        Assert.Equal(120, point.Count);
        Assert.Equal(60.0, point.Percentage);
        Assert.Single(final.TimeSeries);
    }

    [Fact]
    public async Task Time_series_points_come_back_in_date_order_regardless_of_insertion_order()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(client, CreateRequest(_companyAId, "Trend"));

        // Deliberately out of order, and deliberately not UtcNow: a backfill writes older
        // points after newer ones.
        var march = new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero);
        var january = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var february = new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero);
        foreach (var (date, value) in new[] { (march, 3.0), (january, 1.0), (february, 2.0) })
        {
            var response = await client.PostAsJsonAsync(
                $"/admin/analytics-insights/{created.Id}/time-series", new AddTimeSeriesPointRequest(date, value, 10));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var detail = (await (await client.GetAsync($"/admin/analytics-insights/{created.Id}")).Content
            .ReadFromJsonAsync<AnalyticsInsightDetail>())!;

        Assert.Equal(new[] { 1.0, 2.0, 3.0 }, detail.TimeSeries.Select(t => t.Value));
    }

    [Fact]
    public async Task Points_that_tie_on_the_sort_key_still_come_back_in_a_stable_order()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(client, CreateRequest(_companyAId, "Tied"));

        // Same instant for every point, and the same label for every metric row: without the
        // id tiebreak in LoadDetailAsync, Postgres is free to return these in any order and a
        // chart would reshuffle between two identical requests.
        var sameInstant = new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 5; i++)
        {
            await client.PostAsJsonAsync(
                $"/admin/analytics-insights/{created.Id}/time-series", new AddTimeSeriesPointRequest(sameInstant, i, i));
            await client.PostAsJsonAsync(
                $"/admin/analytics-insights/{created.Id}/metric-data", new AddMetricDataRequest("Same", i, i, null));
        }

        var first = (await (await client.GetAsync($"/admin/analytics-insights/{created.Id}")).Content
            .ReadFromJsonAsync<AnalyticsInsightDetail>())!;
        var second = (await (await client.GetAsync($"/admin/analytics-insights/{created.Id}")).Content
            .ReadFromJsonAsync<AnalyticsInsightDetail>())!;

        // Only the stability is asserted, not a specific permutation: Postgres orders uuid by
        // raw byte order and .NET's Guid.CompareTo does not, so "sorted" means something
        // different on each side of the wire. Repeatability is what the acceptance criterion
        // is actually about.
        Assert.Equal(5, first.TimeSeries.Count);
        Assert.Equal(first.TimeSeries.Select(t => t.Id), second.TimeSeries.Select(t => t.Id));
        Assert.Equal(first.MetricData.Select(m => m.Id), second.MetricData.Select(m => m.Id));
    }

    [Fact]
    public async Task Metric_data_comes_back_ordered_by_label()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(client, CreateRequest(_companyAId, "Breakdown"));

        foreach (var label in new[] { "Neutral", "Satisfied", "Dissatisfied" })
        {
            await client.PostAsJsonAsync(
                $"/admin/analytics-insights/{created.Id}/metric-data", new AddMetricDataRequest(label, 1.0, 1, null));
        }

        var detail = (await (await client.GetAsync($"/admin/analytics-insights/{created.Id}")).Content
            .ReadFromJsonAsync<AnalyticsInsightDetail>())!;

        Assert.Equal(new[] { "Dissatisfied", "Neutral", "Satisfied" }, detail.MetricData.Select(m => m.Label));
    }

    [Fact]
    public async Task List_returns_only_the_requested_companys_insights_newest_first()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var mine = await CreateInsightAsync(superAdmin, CreateRequest(_companyAId, "Mine"));
        var theirs = await CreateInsightAsync(superAdmin, CreateRequest(_companyBId, "Theirs"));

        var list = (await (await superAdmin.GetAsync($"/admin/analytics-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AnalyticsInsightListItem>>())!;

        Assert.Contains(list, i => i.Id == mine.Id);
        Assert.DoesNotContain(list, i => i.Id == theirs.Id);
        Assert.All(list, i => Assert.Equal(_companyAId, i.CompanyId));

        var dates = list.Select(i => i.CalculationDate).ToList();
        Assert.Equal(dates.OrderByDescending(d => d), dates);
    }

    [Fact]
    public async Task List_can_filter_to_current_insights_only()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var current = await CreateInsightAsync(client, CreateRequest(_companyAId, "Current"));
        var superseded = await CreateInsightAsync(client, CreateRequest(_companyAId, "Superseded"));

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.AnalyticsInsights.FirstAsync(i => i.Id == superseded.Id);
            row.IsCurrent = false;
            await db.SaveChangesAsync();
        }

        var currentOnly = (await (await client.GetAsync($"/admin/analytics-insights?companyId={_companyAId}&isCurrent=true")).Content
            .ReadFromJsonAsync<List<AnalyticsInsightListItem>>())!;
        Assert.Contains(currentOnly, i => i.Id == current.Id);
        Assert.DoesNotContain(currentOnly, i => i.Id == superseded.Id);

        var unfiltered = (await (await client.GetAsync($"/admin/analytics-insights?companyId={_companyAId}")).Content
            .ReadFromJsonAsync<List<AnalyticsInsightListItem>>())!;
        Assert.Contains(unfiltered, i => i.Id == superseded.Id);
    }

    [Fact]
    public async Task A_CompanyAdmin_cannot_list_another_companys_insights()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.GetAsync($"/admin/analytics-insights?companyId={_companyBId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_CompanyAdmin_cannot_read_or_write_another_companys_insight()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var companyBInsight = await CreateInsightAsync(superAdmin, CreateRequest(_companyBId, "Company B Engagement"));

        var companyAAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var getResponse = await companyAAdmin.GetAsync($"/admin/analytics-insights/{companyBInsight.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, getResponse.StatusCode);

        var metricResponse = await companyAAdmin.PostAsJsonAsync(
            $"/admin/analytics-insights/{companyBInsight.Id}/metric-data", new AddMetricDataRequest("Tampered", 1.0, 1, null));
        Assert.Equal(HttpStatusCode.Forbidden, metricResponse.StatusCode);

        var seriesResponse = await companyAAdmin.PostAsJsonAsync(
            $"/admin/analytics-insights/{companyBInsight.Id}/time-series", new AddTimeSeriesPointRequest(DateTimeOffset.UtcNow, 1.0, 1));
        Assert.Equal(HttpStatusCode.Forbidden, seriesResponse.StatusCode);

        // And nothing landed: the denial must be a denial, not a 403 after a write.
        var asSuperAdmin = (await (await superAdmin.GetAsync($"/admin/analytics-insights/{companyBInsight.Id}")).Content
            .ReadFromJsonAsync<AnalyticsInsightDetail>())!;
        Assert.Empty(asSuperAdmin.MetricData);
        Assert.Empty(asSuperAdmin.TimeSeries);
    }

    [Fact]
    public async Task A_CompanyAdmin_cannot_create_an_insight_for_another_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync("/admin/analytics-insights", CreateRequest(_companyBId, "Cross Tenant"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_SuperAdmin_may_cross_companies()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var inA = await CreateInsightAsync(superAdmin, CreateRequest(_companyAId, "A"));
        var inB = await CreateInsightAsync(superAdmin, CreateRequest(_companyBId, "B"));

        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/admin/analytics-insights/{inA.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/admin/analytics-insights/{inB.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await superAdmin.GetAsync($"/admin/analytics-insights?companyId={_companyBId}")).StatusCode);
    }

    [Theory]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Employee)]
    public async Task A_non_admin_of_the_same_company_is_denied(string role)
    {
        // CanAccessCompany is an allow-list of two roles, so a leader in the right company is
        // still not an analytics reader. Worth pinning: a bare "is this my company" check
        // would have let all three through.
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var insight = await CreateInsightAsync(superAdmin, CreateRequest(_companyAId, "Restricted"));

        var member = await ClientAsync(role, _companyADomain, _companyAId);

        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/admin/analytics-insights/{insight.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/admin/analytics-insights?companyId={_companyAId}")).StatusCode);

        var createResponse = await member.PostAsJsonAsync("/admin/analytics-insights", CreateRequest(_companyAId, "Nope"));
        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_unauthorized()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync($"/admin/analytics-insights?companyId={_companyAId}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_SurveyId_belonging_to_another_company()
    {
        // The cross-tenant write #87 found on snapshots: the survey exists, so an
        // existence-only check would pass and bind another tenant's survey id to this
        // company's aggregate.
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync(
            "/admin/analytics-insights", CreateRequest(_companyAId, "Borrowed Survey", surveyId: _surveyBId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_an_unknown_SurveyId()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync(
            "/admin/analytics-insights", CreateRequest(_companyAId, "X", surveyId: Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_DepartmentId_from_another_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var response = await client.PostAsJsonAsync(
            "/admin/analytics-insights", CreateRequest(_companyAId, "Borrowed Department", departmentId: _departmentBId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_an_unknown_CompanyId_with_400_rather_than_500()
    {
        // Only a SuperAdmin can get past CanAccessCompany with a company that is not their own,
        // so a mistyped guid would otherwise hit the company_id foreign key and surface as an
        // unhandled DbUpdateException.
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await superAdmin.PostAsJsonAsync("/admin/analytics-insights", CreateRequest(Guid.NewGuid(), "Ghost Company"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_blank_and_over_long_required_fields()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var blank = await client.PostAsJsonAsync("/admin/analytics-insights", CreateRequest(_companyAId, metricName: "   "));
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);

        // 201 characters against a varchar(200): without the guard this is a Postgres 22001,
        // which reaches the caller as a 500.
        var tooLong = await client.PostAsJsonAsync(
            "/admin/analytics-insights",
            CreateRequest(_companyAId, metricName: new string('n', AnalyticsInsightValidation.MaxMetricNameLength + 1)));
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);

        var negative = await client.PostAsJsonAsync(
            "/admin/analytics-insights", CreateRequest(_companyAId, totalResponses: -1));
        Assert.Equal(HttpStatusCode.BadRequest, negative.StatusCode);
    }

    [Fact]
    public async Task Adding_metric_data_or_a_time_series_point_rejects_bad_input()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await CreateInsightAsync(client, CreateRequest(_companyAId, "Validated"));

        var blankLabel = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{created.Id}/metric-data", new AddMetricDataRequest("  ", 1.0, null, null));
        Assert.Equal(HttpStatusCode.BadRequest, blankLabel.StatusCode);

        var longLabel = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{created.Id}/metric-data",
            new AddMetricDataRequest(new string('x', AnalyticsInsightValidation.MaxLabelLength + 1), 1.0, null, null));
        Assert.Equal(HttpStatusCode.BadRequest, longLabel.StatusCode);

        var negativeCount = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{created.Id}/time-series", new AddTimeSeriesPointRequest(DateTimeOffset.UtcNow, 1.0, -1));
        Assert.Equal(HttpStatusCode.BadRequest, negativeCount.StatusCode);

        var detail = (await (await client.GetAsync($"/admin/analytics-insights/{created.Id}")).Content
            .ReadFromJsonAsync<AnalyticsInsightDetail>())!;
        Assert.Empty(detail.MetricData);
        Assert.Empty(detail.TimeSeries);
    }

    [Fact]
    public async Task Unknown_ids_return_404_on_every_route_that_takes_one()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var unknown = Guid.NewGuid();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/admin/analytics-insights/{unknown}")).StatusCode);

        var metricResponse = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{unknown}/metric-data", new AddMetricDataRequest("Satisfied", 1.0, null, null));
        Assert.Equal(HttpStatusCode.NotFound, metricResponse.StatusCode);

        var seriesResponse = await client.PostAsJsonAsync(
            $"/admin/analytics-insights/{unknown}/time-series", new AddTimeSeriesPointRequest(DateTimeOffset.UtcNow, 1.0, 1));
        Assert.Equal(HttpStatusCode.NotFound, seriesResponse.StatusCode);
    }
}
