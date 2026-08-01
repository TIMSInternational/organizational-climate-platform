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
public class MicroclimateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"mca-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"mcb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public MicroclimateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "MC Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "MC Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.Role = role;
        user.CompanyId = companyId;
        await db.SaveChangesAsync();

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task CompanyAdmin_can_create_a_microclimate_with_questions_then_read_it_back()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: "Weekly pulse",
            Description: "How's the team feeling",
            CompanyId: _companyAId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 10,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: new List<CreateQuestionInput> { new("How are you feeling today?", "open_text", null, true, 1) }));

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Single(created!.Questions);
        Assert.Equal("draft", created.Status);

        var getResponse = await client.GetAsync($"/microclimates/{created.Id}");
        var fetched = await getResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("Weekly pulse", fetched!.Title);

        var listResponse = await client.GetAsync($"/microclimates?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<MicroclimateListResponse>();
        Assert.Contains(list!.Microclimates, m => m.Id == created.Id);
    }

    [Fact]
    public async Task CompanyAdmin_can_update_status_to_activate_a_microclimate()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "To activate", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var updateResponse = await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("active", updated!.Status);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_access_another_companys_microclimates()
    {
        var client = _factory.CreateClient();
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "B's microclimate", null, _companyBId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        var crossGet = await client.GetAsync($"/microclimates/{created!.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, crossGet.StatusCode);
    }
}
