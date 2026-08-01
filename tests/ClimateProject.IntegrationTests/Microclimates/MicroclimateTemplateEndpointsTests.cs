using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

[Collection("Postgres")]
public class MicroclimateTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"mctmpl-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "MC Template Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_can_create_and_list_their_own_companys_templates()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Weekly check-in", "Standard weekly pulse", "engagement", _companyId));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateTemplateDetail>();

        var listResponse = await client.GetAsync($"/microclimate-templates?companyId={_companyId}");
        var list = await listResponse.Content.ReadFromJsonAsync<MicroclimateTemplateListResponse>();
        Assert.Contains(list!.Templates, t => t.Id == created!.Id);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_system_template_by_omitting_CompanyId()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Sneaky system template", "Should not be allowed", "engagement", null));

        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);

        // Confirm no system template leaked into the DB (would otherwise surface to every
        // other company's template list via ListAsync's `t.CompanyId == null` clause).
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.MicroclimateTemplates.AnyAsync(t => t.Name == "Sneaky system template"));
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_template_for_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var otherCompanyId = Guid.NewGuid();
        var createResponse = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Cross-tenant template", "Should not be allowed", "engagement", otherCompanyId));

        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);
    }
}
