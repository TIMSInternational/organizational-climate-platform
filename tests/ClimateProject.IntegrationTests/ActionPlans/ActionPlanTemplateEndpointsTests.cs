using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.ActionPlans;

[Collection("Postgres")]
public class ActionPlanTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"tmpl-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ActionPlanTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Template Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = _companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_can_create_and_list_their_own_companys_templates()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plan-templates", new CreateActionPlanTemplateRequest(
            "Onboarding template", "Standard onboarding plan", "hr", _companyId, new[] { "onboarding" }));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<ActionPlanTemplateDetail>();

        var listResponse = await client.GetAsync($"/action-plan-templates?companyId={_companyId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanTemplateListResponse>();
        Assert.Contains(list!.Templates, t => t.Id == created!.Id);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_create_a_system_wide_template_with_null_company_id()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/action-plan-templates", new CreateActionPlanTemplateRequest(
            "Malicious system template", "Should not be allowed", "hr", null, new[] { "onboarding" }));
        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.ActionPlanTemplates.AnyAsync(t => t.Name == "Malicious system template"));
    }

    [Fact]
    public async Task System_templates_with_no_company_are_visible_to_everyone()
    {
        // Create a system user to own the system template
        Guid systemUserId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var systemUser = new User { Id = Guid.NewGuid(), Name = "System", Email = "system@system.test", PasswordHash = "hash", Role = Roles.SuperAdmin, CompanyId = _companyId, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
            db.Users.Add(systemUser);
            systemUserId = systemUser.Id;
            db.ActionPlanTemplates.Add(new ActionPlanTemplate
            {
                Id = Guid.NewGuid(),
                Name = "System template",
                Description = "Built-in",
                Category = "general",
                CompanyId = null,
                CreatedBy = systemUserId,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var listResponse = await client.GetAsync($"/action-plan-templates?companyId={_companyId}");
        var list = await listResponse.Content.ReadFromJsonAsync<ActionPlanTemplateListResponse>();
        Assert.Contains(list!.Templates, t => t.Name == "System template");
    }
}
