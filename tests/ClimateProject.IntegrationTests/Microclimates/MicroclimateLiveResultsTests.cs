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
public class MicroclimateLiveResultsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"live-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateLiveResultsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Live Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Admin", email, "a-good-password"));
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

    private async Task<(Guid Id, Guid QuestionId)> CreateActiveMicroclimateAsync(HttpClient client, string token, bool anonymous)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Live test", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, anonymous, null,
            new List<CreateQuestionInput> { new("How do you feel?", "open_text", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        return (created.Id, created.Questions[0].Id);
    }

    [Fact]
    public async Task Submitting_anonymous_responses_requires_no_auth_token_and_updates_live_results()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        var anonymousClient = _factory.CreateClient(); // deliberately no Authorization header
        var response1 = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "good good great" }));
        Assert.Equal(HttpStatusCode.Created, response1.StatusCode);

        var response2 = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "good stressed" }));
        Assert.Equal(HttpStatusCode.Created, response2.StatusCode);

        anonymousClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await anonymousClient.GetAsync($"/microclimates/{microclimateId}/live-results");
        Assert.Equal(HttpStatusCode.OK, liveResponse.StatusCode);
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();
        Assert.Equal(2, live!.ResponseCount);
        // response1 = "good good great" -> good:2, great:1. response2 = "good stressed" -> good:1, stressed:1.
        // Word counts accumulate cumulatively across responses, so the final count for "good" is 2+1=3.
        Assert.Contains(live.WordCloud, w => w.Text == "good" && w.Value == 3);
    }

    [Fact]
    public async Task Non_anonymous_microclimate_requires_authentication_to_submit_a_response()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: false);

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "hello" }));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
