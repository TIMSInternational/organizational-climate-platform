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
public class CompanyLicenseEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"lic-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public CompanyLicenseEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Licence Co", EmailDomain = _domain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> TokenAsync(string role)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"))).EnsureSuccessStatusCode();

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

    private async Task<HttpClient> ClientAsync(string role)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await TokenAsync(role));
        return client;
    }

    [Fact]
    public async Task Super_admin_lists_every_metered_service_unlicensed_by_default()
    {
        var client = await ClientAsync(Roles.SuperAdmin);

        var http = await client.GetAsync($"/admin/companies/{_companyId}/licenses");
        Assert.Equal(HttpStatusCode.OK, http.StatusCode);
        var body = (await http.Content.ReadFromJsonAsync<CompanyLicensesResponse>())!;

        Assert.Equal(ClimateServiceTypes.Metered.Count, body.Services.Count);
        Assert.All(body.Services, s => Assert.False(s.Licensed));
        Assert.All(body.Services, s => Assert.Equal(0, s.SeatsTotal));
        Assert.Contains(body.Services, s => s.ServiceType == ClimateServiceTypes.GeneralClimate);
    }

    [Fact]
    public async Task Granting_a_licence_creates_it_and_a_second_grant_adjusts_it()
    {
        var client = await ClientAsync(Roles.SuperAdmin);

        var granted = await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.GeneralClimate}", new GrantLicenseRequest(100, "PO-1"));
        Assert.Equal(HttpStatusCode.OK, granted.StatusCode);
        var view = (await granted.Content.ReadFromJsonAsync<CompanyServiceLicenseView>())!;
        Assert.True(view.Licensed);
        Assert.Equal(100, view.SeatsTotal);
        Assert.Equal(0, view.SeatsUsed);

        (await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.GeneralClimate}", new GrantLicenseRequest(250, "PO-2")))
            .EnsureSuccessStatusCode();

        var list = (await (await client.GetAsync($"/admin/companies/{_companyId}/licenses"))
            .Content.ReadFromJsonAsync<CompanyLicensesResponse>())!;
        var general = list.Services.Single(s => s.ServiceType == ClimateServiceTypes.GeneralClimate);
        Assert.True(general.Licensed);
        Assert.Equal(250, general.SeatsTotal);
        Assert.Equal("PO-2", general.Notes);
    }

    [Fact]
    public async Task Granting_a_non_metered_service_is_rejected()
    {
        var client = await ClientAsync(Roles.SuperAdmin);

        var http = await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/licenses/custom", new GrantLicenseRequest(10, null));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    [Fact]
    public async Task Granting_negative_seats_is_rejected()
    {
        var client = await ClientAsync(Roles.SuperAdmin);

        var http = await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.Microclimate}", new GrantLicenseRequest(-1, null));

        Assert.Equal(HttpStatusCode.BadRequest, http.StatusCode);
    }

    [Fact]
    public async Task Granting_for_a_missing_company_is_not_found()
    {
        var client = await ClientAsync(Roles.SuperAdmin);

        var http = await client.PutAsJsonAsync(
            $"/admin/companies/{Guid.NewGuid()}/licenses/{ClimateServiceTypes.GeneralClimate}", new GrantLicenseRequest(10, null));

        Assert.Equal(HttpStatusCode.NotFound, http.StatusCode);
    }

    [Fact]
    public async Task Suspend_then_reactivate_moves_the_licence_status()
    {
        var client = await ClientAsync(Roles.SuperAdmin);
        (await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.GeneralClimate}", new GrantLicenseRequest(50, null)))
            .EnsureSuccessStatusCode();

        var suspended = await client.PostAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.GeneralClimate}/suspend", null);
        Assert.Equal(HttpStatusCode.OK, suspended.StatusCode);
        Assert.Equal(LicenseStatuses.Suspended, (await suspended.Content.ReadFromJsonAsync<CompanyServiceLicenseView>())!.Status);

        var reactivated = await client.PostAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.GeneralClimate}/reactivate", null);
        Assert.Equal(HttpStatusCode.OK, reactivated.StatusCode);
        Assert.Equal(LicenseStatuses.Active, (await reactivated.Content.ReadFromJsonAsync<CompanyServiceLicenseView>())!.Status);
    }

    [Fact]
    public async Task Suspending_a_service_with_no_licence_is_not_found()
    {
        var client = await ClientAsync(Roles.SuperAdmin);

        var http = await client.PostAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.Microclimate}/suspend", null);

        Assert.Equal(HttpStatusCode.NotFound, http.StatusCode);
    }

    [Fact]
    public async Task A_non_super_admin_cannot_read_or_grant_licences()
    {
        var client = await ClientAsync(Roles.CompanyAdmin);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/admin/companies/{_companyId}/licenses")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/licenses/{ClimateServiceTypes.GeneralClimate}", new GrantLicenseRequest(10, null))).StatusCode);
    }
}
