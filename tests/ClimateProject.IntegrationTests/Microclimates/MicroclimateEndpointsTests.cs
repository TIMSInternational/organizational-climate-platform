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
    public async Task Employee_cannot_update_a_microclimate()
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Employee cannot touch this", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var employeeToken = await SignUpAndGetTokenAsync(client, Roles.Employee, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var updateResponse = await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.Forbidden, updateResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var getResponse = await client.GetAsync($"/microclimates/{created.Id}");
        var unchanged = await getResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("draft", unchanged!.Status);
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

    [Fact]
    public async Task GetAsync_still_requires_authentication_for_a_completely_anonymous_caller()
    {
        // Locks in the exact defect from the Task 7 review: a genuinely anonymous caller
        // (no Authorization header at all) hitting the authenticated `GET /microclimates/{id}`
        // route must 401, not silently succeed with an omitted-token bearer header. This is
        // the route the public respond page must NOT call.
        var adminClient = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin, _companyADomain, _companyAId);
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await adminClient.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Auth required", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var anonymousClient = _factory.CreateClient(); // deliberately no Authorization header
        var anonymousGet = await anonymousClient.GetAsync($"/microclimates/{created!.Id}");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousGet.StatusCode);
    }

    [Fact]
    public async Task Anonymous_visitor_can_read_public_respond_details_without_any_token()
    {
        var adminClient = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin, _companyADomain, _companyAId);
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await adminClient.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Public pulse", "Tell us how you feel", _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null,
            new List<CreateQuestionInput> { new("How are you?", "open_text", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await adminClient.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var anonymousClient = _factory.CreateClient(); // deliberately no Authorization header
        var publicGet = await anonymousClient.GetAsync($"/microclimates/{created.Id}/respond");
        Assert.Equal(HttpStatusCode.OK, publicGet.StatusCode);

        var body = await publicGet.Content.ReadAsStringAsync();
        var publicDetail = await publicGet.Content.ReadFromJsonAsync<PublicMicroclimateDetail>();
        Assert.Equal("Public pulse", publicDetail!.Title);
        Assert.Equal("active", publicDetail.Status);
        Assert.Single(publicDetail.Questions);
        Assert.Equal("How are you?", publicDetail.Questions[0].Text);

        // Must not leak internal/admin-only fields to an anonymous caller.
        Assert.DoesNotContain("companyId", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("createdBy", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("responseCount", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("targetParticipantCount", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Public_respond_details_returns_404_for_an_unknown_id_without_requiring_auth()
    {
        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.GetAsync($"/microclimates/{Guid.NewGuid()}/respond");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Public_respond_details_returns_404_for_a_microclimate_that_requires_authentication_to_respond()
    {
        // Locks in the whole-branch review fix: GET /microclimates/{id}/respond must not
        // serve title/description/questions for a microclimate with AnonymousResponses ==
        // false, even though the route is AllowAnonymous. Otherwise this becomes an
        // unauthenticated read surface for non-public microclimates.
        var adminClient = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin, _companyADomain, _companyAId);
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await adminClient.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Members only pulse", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: false, TemplateId: null, Questions: null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await adminClient.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var anonymousClient = _factory.CreateClient();
        var publicGet = await anonymousClient.GetAsync($"/microclimates/{created.Id}/respond");
        Assert.Equal(HttpStatusCode.NotFound, publicGet.StatusCode);
    }

    [Fact]
    public async Task Public_respond_details_returns_404_for_an_unpublished_draft_microclimate()
    {
        // Locks in the whole-branch review fix: an unpublished draft's question wording is
        // exactly the kind of internal/admin-only data PublicMicroclimateDetail's own
        // comment says must not leak, even when AnonymousResponses is true.
        var adminClient = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin, _companyADomain, _companyAId);
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await adminClient.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Still being drafted", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: true, TemplateId: null,
            Questions: new List<CreateQuestionInput> { new("Secret draft question", "open_text", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("draft", created!.Status);

        var anonymousClient = _factory.CreateClient();
        var publicGet = await anonymousClient.GetAsync($"/microclimates/{created.Id}/respond");
        Assert.Equal(HttpStatusCode.NotFound, publicGet.StatusCode);
    }

    [Fact]
    public async Task Submitting_a_response_to_a_non_anonymous_microclimate_as_an_authenticated_company_member_succeeds()
    {
        // The public /respond page can never reach a non-anonymous microclimate (see the
        // 404 tests above), but the authenticated submission path itself must still work
        // for a genuinely authenticated same-company caller -- this is the intended way to
        // respond to a members-only microclimate.
        var adminClient = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(adminClient, Roles.CompanyAdmin, _companyADomain, _companyAId);
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await adminClient.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Members only pulse", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: false, TemplateId: null,
            Questions: new List<CreateQuestionInput> { new("How are you?", "open_text", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await adminClient.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        var employeeToken = await SignUpAndGetTokenAsync(adminClient, Roles.Employee, _companyADomain, _companyAId);
        var employeeClient = _factory.CreateClient();
        employeeClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", employeeToken);

        var submit = await employeeClient.PostAsJsonAsync(
            $"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [created.Questions[0].Id] = "Doing fine" }));
        Assert.Equal(HttpStatusCode.Created, submit.StatusCode);
    }
}
