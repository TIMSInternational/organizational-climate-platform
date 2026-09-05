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
/// The generator's half of the period-over-period section (#88 follow-up).
///
/// <para><see cref="ClimateProject.UnitTests"/>' <c>ReportComparisonTests</c> covers the
/// projection itself, mutation by mutation. What it cannot cover is the <b>wiring</b>: which
/// surveys <c>ReportGeneration</c> feeds the matrix, and whether the section reaches the stored
/// document at all. A filter on the wrong status, or a section computed and never assigned,
/// would leave every unit test green.</para>
///
/// <para>Neither test here seeds responses. That is the point: with no completed responses both
/// waves fall below the anonymity floor, which is the state the section has to <b>fail closed</b>
/// in, and it is reached without building a population.</para>
/// </summary>
[Collection("Postgres")]
public class ReportComparisonGenerationTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"cmp-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportComparisonGenerationTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Comparison Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
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
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task AddSurveyAsync(string title, string status, DateTimeOffset endDate)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var creator = await db.Users.FirstAsync(u => u.CompanyId == _companyId);
        db.Surveys.Add(new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            CreatedBy = creator.Id,
            TitleEn = title,
            Type = "climate",
            Language = "en",
            Status = status,
            StartDate = endDate.AddDays(-30),
            EndDate = endDate,
            CreatedAt = endDate.AddDays(-31),
            UpdatedAt = endDate,
        });
        await db.SaveChangesAsync();
    }

    private static ReportOutputDocument Document(ReportDetail report)
        => JsonSerializer.Deserialize<ReportOutputDocument>(report.ReportOutput!, JsonSerializerOptions.Web)!;

    private async Task<ReportDetail> GenerateAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Comparison report", null, "climate_summary", _companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!;
    }

    [Fact]
    public async Task One_closed_survey_is_not_a_period_to_compare_so_the_section_is_absent()
    {
        var client = await AdminClientAsync();
        await AddSurveyAsync("Wave 1", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-60));

        var document = Document(await GenerateAsync(client));

        // Null, not a suppressed section. "Nothing to compare" and "compared and withheld" are
        // different statements and the renderer prints different sentences for them.
        Assert.Null(document.Comparison);
    }

    [Fact]
    public async Task An_active_survey_is_not_a_closed_wave_and_does_not_make_a_comparison()
    {
        var client = await AdminClientAsync();
        await AddSurveyAsync("Closed wave", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-60));

        // Non-draft, so ReportGeneration builds a SECTION for it -- but still collecting, so its
        // reading is not final and it must not become the other end of a movement. A filter of
        // "not draft" instead of "closed or archived" passes every unit test and fails here.
        await AddSurveyAsync("Still open", SurveyStatuses.Active, DateTimeOffset.UtcNow.AddDays(30));

        var document = Document(await GenerateAsync(client));

        Assert.Equal(2, document.Surveys.Count);
        Assert.Null(document.Comparison);
    }

    [Fact]
    public async Task Two_closed_waves_below_the_floor_produce_a_section_that_says_so_and_carries_no_rows()
    {
        var client = await AdminClientAsync();
        await AddSurveyAsync("Wave 1", SurveyStatuses.Closed, DateTimeOffset.UtcNow.AddDays(-120));
        await AddSurveyAsync("Wave 2", SurveyStatuses.Archived, DateTimeOffset.UtcNow.AddDays(-30));

        var document = Document(await GenerateAsync(client));

        Assert.NotNull(document.Comparison);

        // Neither wave has a single completed response, so both are below the survey floor and
        // the movement between them is withheld -- reported as withheld, not as an empty table.
        Assert.True(document.Comparison.IsSuppressed);
        Assert.Empty(document.Comparison.Dimensions);

        // Archived counts as a closed wave, and the later of the two is the later end.
        Assert.Equal("Wave 1", document.Comparison.EarlierSurveyTitle);
        Assert.Equal("Wave 2", document.Comparison.LaterSurveyTitle);
    }

    [Fact]
    public async Task The_generation_note_no_longer_claims_the_comparison_is_missing()
    {
        var client = await AdminClientAsync();

        var document = Document(await GenerateAsync(client));

        // A note that keeps claiming a gap it no longer has teaches a consumer to stop reading
        // it -- the reason this file's note shrinks rather than accumulating.
        Assert.DoesNotContain("period-over-period comparative analysis, report configuration",
            document.GenerationNote, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("report configuration/filters", document.GenerationNote, StringComparison.OrdinalIgnoreCase);
    }
}
