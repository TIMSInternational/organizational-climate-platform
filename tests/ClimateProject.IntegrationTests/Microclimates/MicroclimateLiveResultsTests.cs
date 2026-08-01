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
    private readonly string _companyBDomain = $"live-b-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _companyBId;

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
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Live Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(company, companyB);
        _companyId = company.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
        => SignUpAndGetTokenForCompanyAsync(client, role, _companyDomain, _companyId);

    private async Task<string> SignUpAndGetTokenForCompanyAsync(HttpClient client, string role, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test Admin", email, "a-good-password"));
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

    [Fact]
    public async Task Authenticated_user_from_a_different_company_cannot_submit_to_a_non_anonymous_microclimate()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: false);

        var otherClient = _factory.CreateClient();
        var otherCompanyToken = await SignUpAndGetTokenForCompanyAsync(otherClient, Roles.Employee, _companyBDomain, _companyBId);
        otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", otherCompanyToken);

        var response = await otherClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "hello" }));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Submitting_with_missing_answers_returns_bad_request_instead_of_throwing()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, _) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsync(
            $"/microclimates/{microclimateId}/responses",
            new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Word_cloud_only_counts_answers_to_open_text_questions()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Mixed questions", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput>
            {
                new("How do you feel?", "open_text", null, true, 1),
                new("Are you satisfied?", "yes_no", null, true, 2),
            }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var openTextQuestionId = created.Questions.First(q => q.Type == "open_text").Id;
        var yesNoQuestionId = created.Questions.First(q => q.Type == "yes_no").Id;

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string>
            {
                [openTextQuestionId] = "great",
                [yesNoQuestionId] = "yes",
            }));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        anonymousClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await anonymousClient.GetAsync($"/microclimates/{created.Id}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();

        Assert.Contains(live!.WordCloud, w => w.Text == "great");
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "yes");
    }
}
