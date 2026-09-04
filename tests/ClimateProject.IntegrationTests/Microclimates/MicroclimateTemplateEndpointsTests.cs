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
    private Guid _otherCompanyId;

    public MicroclimateTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "MC Template Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;

        // A second tenant, so "may not write another company's scope" is a real denial and
        // not just a rejected random Guid. Its own domain: companies.email_domain carries a
        // filtered unique index.
        var other = new Company { Id = Guid.NewGuid(), Name = "MC Other Co", EmailDomain = $"other-{Guid.NewGuid():N}.test", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(other);
        _otherCompanyId = other.Id;

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Signs a user up under this class's email domain and then re-homes them onto
    /// <paramref name="companyId"/> -- <c>null</c> for a global super_admin, who belongs to
    /// no tenant. Signup itself derives the company from the email domain and cannot
    /// produce a tenant-less user, which is why the row is rewritten before the token is
    /// minted.
    /// </summary>
    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        signup.EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = role == Roles.SuperAdmin ? companyId : companyId ?? _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task<HttpClient> ClientAsync(string role, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, role, companyId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    // Awaited inside the scope on purpose: returning the Task would dispose the DbContext
    // before the query ran.
    private async Task<int> GlobalTemplateCountAsync(string name)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.MicroclimateTemplates.CountAsync(t => t.CompanyId == null && t.Name == name);
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

    // ------------------------------------------------------------------
    // #256 -- tenant scope on create. CompanyId == null is GLOBAL here: ListAsync returns
    // those rows to every tenant and IsSystemTemplate is derived from the same null, so an
    // omitted companyId is the most privileged value the field can take, not a missing one.
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_company_admin_may_NOT_create_a_GLOBAL_template_by_omitting_companyId()
    {
        // The denial that matters, and the one the old guard missed: it was conditioned on
        // request.CompanyId.HasValue, so omitting the field skipped the check entirely
        // while still setting IsSystemTemplate = true. The present-but-wrong companyId case
        // below already passed before the fix and is not the bug.
        var client = await ClientAsync(Roles.CompanyAdmin, _companyId);
        const string name = "Sneaky global template";

        var response = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            name, "Should never become a system template", "engagement", null));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        // Assert the row too: a 403 that still wrote would be the same breach.
        Assert.Equal(0, await GlobalTemplateCountAsync(name));
    }

    [Fact]
    public async Task A_super_admin_may_still_create_a_global_template()
    {
        var client = await ClientAsync(Roles.SuperAdmin, null);
        const string name = "Platform standard pulse";

        var response = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            name, "Ships with the platform", "engagement", null));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<MicroclimateTemplateDetail>();
        Assert.Null(created!.CompanyId);
        Assert.True(created.IsSystemTemplate);
        Assert.Equal(1, await GlobalTemplateCountAsync(name));
    }

    [Fact]
    public async Task A_super_admin_may_create_a_template_scoped_to_any_company()
    {
        var client = await ClientAsync(Roles.SuperAdmin, null);

        var response = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Scoped by the platform", "For one tenant", "engagement", _otherCompanyId));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<MicroclimateTemplateDetail>();
        Assert.Equal(_otherCompanyId, created!.CompanyId);
        Assert.False(created.IsSystemTemplate);
    }

    [Fact]
    public async Task A_company_admin_may_NOT_create_a_template_scoped_to_another_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Someone else's template", "Wrong tenant", "engagement", _otherCompanyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    public async Task A_non_admin_may_not_create_a_template_at_all(string role)
    {
        // Folding the old Roles.Admin.Contains check into CanWriteTemplate must not have
        // widened who may write -- CanWriteTemplate returns false for every other role.
        var client = await ClientAsync(role, _companyId);

        var ownScope = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Not allowed", "Not allowed", "engagement", _companyId));
        var globalScope = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Not allowed", "Not allowed", "engagement", null));

        Assert.Equal(HttpStatusCode.Forbidden, ownScope.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, globalScope.StatusCode);
    }
}
