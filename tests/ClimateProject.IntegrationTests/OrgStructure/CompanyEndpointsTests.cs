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
public class CompanyEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"orgco-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public CompanyEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Org Co",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        if (role != Roles.Employee)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            await db.SaveChangesAsync();

            // Re-login to get a token carrying the updated role claim.
            var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
            token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        }

        return token;
    }

    [Fact]
    public async Task Non_admin_role_is_forbidden_from_listing_companies()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/admin/companies");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_is_forbidden_from_listing_companies()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/admin/companies");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_list_create_and_update_a_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var list = await client.GetAsync("/admin/companies");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var listBody = await list.Content.ReadFromJsonAsync<CompanyListResponse>();
        Assert.Contains(listBody!.Companies, c => c.Id == _companyId);

        var createResponse = await client.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest(
            Name: "New Co",
            EmailDomain: $"newco-{Guid.NewGuid():N}.test",
            Industry: "Software",
            Size: "small",
            Country: "US",
            SubscriptionTier: null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<CompanyDetail>();
        Assert.Equal("basic", created!.SubscriptionTier);

        var updateResponse = await client.PutAsJsonAsync($"/admin/companies/{created.Id}", new UpdateCompanyRequest(
            Name: "New Co Renamed",
            EmailDomain: null,
            Industry: null,
            Size: null,
            Country: null,
            SubscriptionTier: null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<CompanyDetail>();
        Assert.Equal("New Co Renamed", updated!.Name);
        Assert.Equal("Software", updated.Industry);
    }

    [Fact]
    public async Task Create_rejects_a_malformed_domain()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest(
            Name: "Bad Domain Co",
            EmailDomain: "not a domain",
            Industry: "Software",
            Size: "small",
            Country: "US",
            SubscriptionTier: null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_duplicate_domain()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest(
            Name: "Duplicate Co",
            EmailDomain: _domain,
            Industry: "Software",
            Size: "small",
            Country: "US",
            SubscriptionTier: null));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}
