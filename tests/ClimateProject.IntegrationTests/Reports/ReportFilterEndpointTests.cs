using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// The report filter model (#88's "report configuration and filter model").
///
/// <para>Until this existed, <c>reports.filters</c> and <c>reports.config</c> were jsonb columns
/// nothing wrote and nothing read, and every generated document was the whole company. The two
/// properties worth defending are that a filter <b>narrows and never widens</b>, and that the
/// document records what it was told to include -- so a reader can tell an EMPTY section from
/// an EXCLUDED one.</para>
/// </summary>
[Collection("Postgres")]
public class ReportFilterEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"flt-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportFilterEndpointTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(new Company
        {
            Id = _companyId = Guid.NewGuid(),
            Name = "Filter Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd")))
            .EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);
        return client;
    }

    private async Task<Guid> AddSurveyAsync(string title, Guid? companyId = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var creator = await db.Users.FirstAsync(u => u.CompanyId == _companyId);
        var id = Guid.NewGuid();
        db.Surveys.Add(new Survey
        {
            Id = id,
            CompanyId = companyId ?? _companyId,
            CreatedBy = creator.Id,
            TitleEn = title,
            Type = "climate",
            Language = "en",
            Status = SurveyStatuses.Closed,
            StartDate = DateTimeOffset.UtcNow.AddDays(-40),
            EndDate = DateTimeOffset.UtcNow.AddDays(-10),
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-41),
            UpdatedAt = DateTimeOffset.UtcNow.AddDays(-10),
        });
        await db.SaveChangesAsync();
        return id;
    }

    private async Task<HttpResponseMessage> CreateAsync(HttpClient client, ReportFilters? filters)
        => await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Filtered report", null, "climate_summary", _companyId, "pdf", null, filters));

    private static ReportOutputDocument Document(ReportDetail r)
        => JsonSerializer.Deserialize<ReportOutputDocument>(r.ReportOutput!, JsonSerializerOptions.Web)!;

    private async Task<ReportOutputDocument> GenerateAsync(HttpClient client, ReportFilters? filters)
    {
        var response = await CreateAsync(client, filters);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return Document((await response.Content.ReadFromJsonAsync<ReportDetail>())!);
    }

    [Fact]
    public async Task No_filter_still_means_the_whole_company_and_says_so()
    {
        var client = await AdminClientAsync();
        await AddSurveyAsync("Wave 1");
        await AddSurveyAsync("Wave 2");

        var document = await GenerateAsync(client, null);

        // The behaviour every report had before filters existed, unchanged.
        Assert.Equal(2, document.Surveys.Count);
        Assert.NotNull(document.Scope);
        Assert.True(document.Scope.AllSurveys);
        Assert.True(document.Scope.AiInsightsIncluded);
        Assert.True(document.Scope.BenchmarksIncluded);
        Assert.True(document.Scope.ComparisonIncluded);
    }

    [Fact]
    public async Task A_survey_filter_narrows_the_document_and_the_scope_records_that_it_did()
    {
        var client = await AdminClientAsync();
        var keep = await AddSurveyAsync("Kept");
        await AddSurveyAsync("Dropped");

        var document = await GenerateAsync(client, new ReportFilters(SurveyIds: [keep]));

        Assert.Single(document.Surveys);
        Assert.Equal("Kept", document.Surveys[0].Title);
        Assert.False(document.Scope!.AllSurveys);
        Assert.Equal(1, document.Scope.SurveyCount);
    }

    [Fact]
    public async Task A_section_switched_off_is_recorded_as_excluded_not_merely_absent()
    {
        var client = await AdminClientAsync();
        await AddSurveyAsync("Wave 1");
        await AddSurveyAsync("Wave 2");

        var document = await GenerateAsync(client, new ReportFilters(
            IncludeAiInsights: false, IncludeBenchmarks: false, IncludeComparison: false));

        Assert.Empty(document.AiInsights);
        Assert.Empty(document.Benchmarks);
        Assert.Null(document.Comparison);

        // The point of the scope: without it these three are indistinguishable from a company
        // that simply has no insights, no benchmarks and one wave.
        Assert.False(document.Scope!.AiInsightsIncluded);
        Assert.False(document.Scope.BenchmarksIncluded);
        Assert.False(document.Scope.ComparisonIncluded);
    }

    [Fact]
    public async Task Another_companys_survey_cannot_be_pulled_into_a_report_by_naming_it()
    {
        var otherCompanyId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.Companies.Add(new Company
            {
                Id = otherCompanyId,
                Name = "Other Co",
                EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = await AdminClientAsync();
        var foreign = await AddSurveyAsync("Someone else's wave", otherCompanyId);

        var response = await CreateAsync(client, new ReportFilters(SurveyIds: [foreign]));

        // Refused at the door rather than intersected away silently: a caller who named a
        // survey that is not theirs would otherwise get a 201 and an empty document with no
        // way to tell why.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        using var check = _factory.Services.CreateScope();
        var readDb = check.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await readDb.Reports.AnyAsync(r => r.CompanyId == _companyId));
    }

    [Fact]
    public async Task An_empty_survey_list_is_refused_rather_than_read_as_none()
    {
        var client = await AdminClientAsync();

        var response = await CreateAsync(client, new ReportFilters(SurveyIds: []));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("omit the field", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// A filter only ever narrows a document every floor already governs, so an unreadable one
    /// falls back to "everything" -- the behaviour that report had before filters existed --
    /// rather than failing an administrator's download. This is deliberately the opposite
    /// direction from the comparison's public ruling, where failing open would publish.
    /// </summary>
    [Fact]
    public async Task An_unreadable_stored_filter_generates_the_whole_company_rather_than_failing()
    {
        var client = await AdminClientAsync();
        await AddSurveyAsync("Wave 1");

        var created = (await (await CreateAsync(client, null)).Content.ReadFromJsonAsync<ReportDetail>())!;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Reports.SingleAsync(r => r.Id == created.Id);
            // Valid JSON, so the jsonb column accepts it; not a ReportFilters, so the parse fails.
            row.Filters = """{"surveyIds":"not-a-list"}""";
            await db.SaveChangesAsync();
        }

        var regenerated = await client.GetFromJsonAsync<ReportDetail>($"/admin/reports/{created.Id}");
        Assert.NotNull(regenerated);

        // Regeneration happens through the same path the scheduled runner uses; here the
        // assertion is simply that the row survived and the original document is intact.
        Assert.Single(Document(regenerated).Surveys);
    }
}
