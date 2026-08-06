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

    private Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
        => SignUpAndGetTokenAsync(client, role, _companyDomain, _companyId);

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid companyId)
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
            new List<CreateQuestionInput> { new("How do you feel?", "open_ended", null, true, 1) }));
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
    public async Task Word_cloud_only_counts_open_ended_answers_not_ratings_or_yes_no()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Mixed question types", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput>
            {
                new("How do you feel?", "open_ended", null, true, 1),
                new("Rate your week", "rating", null, true, 2),
                new("Are you happy?", "yes_no", null, true, 3),
            }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var openEndedQuestionId = created.Questions.Single(q => q.Type == "open_ended").Id;
        var ratingQuestionId = created.Questions.Single(q => q.Type == "rating").Id;
        var yesNoQuestionId = created.Questions.Single(q => q.Type == "yes_no").Id;

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string>
            {
                [openEndedQuestionId] = "great amazing",
                [ratingQuestionId] = "5",
                [yesNoQuestionId] = "yes",
            }));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        anonymousClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await anonymousClient.GetAsync($"/microclimates/{created.Id}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();

        // The rating value "5" and the yes/no answer "yes" must not pollute the word cloud --
        // only the open_ended answer's words should be counted.
        Assert.DoesNotContain(live!.WordCloud, w => w.Text == "5");
        Assert.DoesNotContain(live.WordCloud, w => w.Text == "yes");
        Assert.Contains(live.WordCloud, w => w.Text == "great" && w.Value == 1);
        Assert.Contains(live.WordCloud, w => w.Text == "amazing" && w.Value == 1);
    }

    [Fact]
    public async Task Non_anonymous_microclimate_rejects_a_response_from_a_different_companys_authenticated_user()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: false);

        var otherCompanyDomain = $"live-other-{Guid.NewGuid():N}.test";
        Guid otherCompanyId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Co", EmailDomain = otherCompanyDomain, CreatedAt = DateTimeOffset.UtcNow };
            db.Companies.Add(otherCompany);
            otherCompanyId = otherCompany.Id;
            await db.SaveChangesAsync();
        }

        var otherClient = _factory.CreateClient();
        var otherToken = await SignUpAndGetTokenAsync(otherClient, Roles.CompanyAdmin, otherCompanyDomain, otherCompanyId);
        otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", otherToken);

        var response = await otherClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [questionId] = "hello" }));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // Confirm the cross-company attempt did not sneak through and inflate the aggregate.
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await client.GetAsync($"/microclimates/{microclimateId}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();
        Assert.Equal(0, live!.ResponseCount);
    }

    [Fact]
    public async Task Submitting_an_out_of_range_rating_is_rejected()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Rating validation", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput> { new("Rate your week", "rating", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var ratingQuestionId = created.Questions.Single().Id;

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [ratingQuestionId] = "9000" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Submitting_a_yes_no_answer_outside_yes_or_no_is_rejected()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Yes/no validation", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput> { new("Are you happy?", "yes_no", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var yesNoQuestionId = created.Questions.Single().Id;

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [yesNoQuestionId] = "maybe" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Submitting_a_multiple_choice_answer_outside_the_configured_options_is_rejected()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Multiple choice validation", null, _companyId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 4, true, null,
            new List<CreateQuestionInput> { new("Pick one", "multiple_choice", [new(null, "Red"), new(null, "Green"), new(null, "Blue")], true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var choiceQuestionId = created.Questions.Single().Id;

        var anonymousClient = _factory.CreateClient();
        var invalid = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [choiceQuestionId] = "Purple" }));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var valid = await anonymousClient.PostAsJsonAsync($"/microclimates/{created.Id}/responses", new SubmitResponseRequest(
            new Dictionary<Guid, string> { [choiceQuestionId] = "Green" }));
        Assert.Equal(HttpStatusCode.Created, valid.StatusCode);
    }

    [Fact]
    public async Task Concurrent_response_submissions_do_not_lose_updates()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        var (microclimateId, questionId) = await CreateActiveMicroclimateAsync(client, adminToken, anonymous: true);

        const int concurrentSubmissions = 8;
        var tasks = Enumerable.Range(0, concurrentSubmissions).Select(async i =>
        {
            var anonymousClient = _factory.CreateClient();
            return await anonymousClient.PostAsJsonAsync($"/microclimates/{microclimateId}/responses", new SubmitResponseRequest(
                new Dictionary<Guid, string> { [questionId] = $"word{i}" }));
        });

        var responses = await Task.WhenAll(tasks);
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var liveResponse = await client.GetAsync($"/microclimates/{microclimateId}/live-results");
        var live = await liveResponse.Content.ReadFromJsonAsync<LiveResultsDetail>();

        // Without concurrency handling, concurrent read-modify-write races on ResponseCount /
        // WordCloudData would silently drop some increments (lost updates). Every submission
        // must be reflected.
        Assert.Equal(concurrentSubmissions, live!.ResponseCount);
        Assert.Equal(concurrentSubmissions, live.WordCloud.Sum(w => w.Value));
    }
}
