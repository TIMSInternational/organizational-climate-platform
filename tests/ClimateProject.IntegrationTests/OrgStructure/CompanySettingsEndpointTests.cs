using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

[Collection("Postgres")]
public class CompanySettingsEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"csa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"csb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public CompanySettingsEndpointTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "CS Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "CS Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_can_update_their_own_companys_settings_and_branding()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings", new UpdateCompanySettingsRequest(
            SurveyFrequency: "monthly",
            MicroclimateEnabled: false,
            AiInsightsEnabled: null,
            AnonymousSurveys: true,
            DataRetentionDays: null,
            Timezone: null,
            Language: null,
            LogoUrl: "https://example.test/logo.png",
            PrimaryColor: "#000000",
            SecondaryColor: null,
            FontFamily: null,
            CustomCss: null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<CompanySettingsResponse>();
        Assert.Equal("monthly", result!.Settings.SurveyFrequency);
        Assert.False(result.Settings.MicroclimateEnabled);
        Assert.True(result.Settings.AnonymousSurveys);
        Assert.Equal("https://example.test/logo.png", result.Branding.LogoUrl);
        Assert.Equal("#000000", result.Branding.PrimaryColor);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_update_another_companys_settings()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyBId}/settings", new UpdateCompanySettingsRequest(
            "monthly", null, null, null, null, null, null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Regular_employee_cannot_update_company_settings()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings", new UpdateCompanySettingsRequest(
            "monthly", null, null, null, null, null, null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static UpdateCompanySettingsRequest BandsOnly(UpdateResultBandsRequest bands, string? surveyFrequency = null) =>
        new(surveyFrequency, null, null, null, null, null, null, null, null, null, null, null, bands);

    [Fact]
    public async Task Any_member_of_the_company_reads_the_default_result_bands()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync($"/admin/companies/{_companyAId}/result-bands");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var bands = await response.Content.ReadFromJsonAsync<ResultBandsDto>();
        Assert.Equal(new ResultBandsDto(3.00m, 4.00m, null, null, null), bands);
    }

    [Fact]
    public async Task A_member_of_another_company_cannot_read_its_result_bands()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync($"/admin/companies/{_companyBId}/result-bands");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_saves_result_bands_and_every_member_then_reads_them()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings",
            BandsOnly(new UpdateResultBandsRequest(2.75m, 4.25m, "  Zona roja  ", "", "Fortaleza")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var saved = (await response.Content.ReadFromJsonAsync<CompanySettingsResponse>())!.ResultBands;
        // Trimmed, and a blank name returns to the product's default (null).
        Assert.Equal(new ResultBandsDto(2.75m, 4.25m, "Zona roja", null, "Fortaleza"), saved);

        var reader = _factory.CreateClient();
        var leaderToken = await SignUpAndGetTokenAsync(reader, Roles.Leader, _companyADomain, _companyAId);
        reader.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", leaderToken);
        var read = await reader.GetFromJsonAsync<ResultBandsDto>($"/admin/companies/{_companyAId}/result-bands");
        Assert.Equal(saved, read);
    }

    public static TheoryData<decimal, decimal> RefusedScales => new()
    {
        { 1.00m, 4.00m },   // no room for the critical area
        { 0.50m, 4.00m },
        { 3.00m, 3.00m },   // strength must start above opportunity
        { 3.50m, 3.00m },
        { 3.00m, 5.01m },   // strength past the scale
        { 3.005m, 4.00m },  // three decimals
    };

    [Theory]
    [MemberData(nameof(RefusedScales))]
    public async Task A_scale_with_a_gap_overlap_or_out_of_range_boundary_is_refused_and_nothing_is_saved(decimal opportunityMin, decimal strengthMin)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings",
            BandsOnly(new UpdateResultBandsRequest(opportunityMin, strengthMin, null, null, null), surveyFrequency: "weekly"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = await db.Companies.AsNoTracking().FirstAsync(c => c.Id == _companyAId);
        Assert.Equal(3.00m, company.Settings.ResultBandOpportunityMin);
        Assert.Equal(4.00m, company.Settings.ResultBandStrengthMin);
        // The rest of the same request is not applied either.
        Assert.NotEqual("weekly", company.Settings.SurveyFrequency);
    }

    [Fact]
    public async Task A_name_longer_than_sixty_characters_is_refused()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync($"/admin/companies/{_companyAId}/settings",
            BandsOnly(new UpdateResultBandsRequest(3.00m, 4.00m, new string('x', 61), null, null)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
