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

    [Fact]
    public async Task Anonymous_visitor_can_read_reduced_details_of_an_active_microclimate_configured_for_anonymous_responses()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Public pulse", "Internal-only description", _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: true, null,
            new List<CreateQuestionInput> { new("How are you feeling?", "open_text", null, true, 1) }));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        // Anonymous visibility requires the microclimate to actually be active, not merely
        // configured for anonymous responses -- a draft is not yet publicly readable.
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        // No Authorization header at all -- a genuinely anonymous respondent, not a logged-in
        // user with an expired/absent token.
        var anonymousClient = _factory.CreateClient();
        var getResponse = await anonymousClient.GetAsync($"/microclimates/{created.Id}");

        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var fetched = await getResponse.Content.ReadFromJsonAsync<PublicMicroclimateDetail>();
        Assert.Equal("Public pulse", fetched!.Title);
        Assert.Equal("active", fetched.Status);
        Assert.Single(fetched.Questions);

        // The reduced public payload must not leak internal fields -- confirm via the raw JSON
        // rather than the strongly-typed DTO (which would just default-initialize anything
        // missing and mask the leak).
        var raw = await getResponse.Content.ReadAsStringAsync();
        using var json = System.Text.Json.JsonDocument.Parse(raw);
        Assert.False(json.RootElement.TryGetProperty("companyId", out _));
        Assert.False(json.RootElement.TryGetProperty("createdBy", out _));
        Assert.False(json.RootElement.TryGetProperty("description", out _));
        Assert.False(json.RootElement.TryGetProperty("responseCount", out _));
        Assert.False(json.RootElement.TryGetProperty("targetParticipantCount", out _));
    }

    [Fact]
    public async Task Anonymous_visitor_cannot_read_a_draft_microclimate_even_when_configured_for_anonymous_responses()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Not yet launched", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal("draft", created!.Status);

        var anonymousClient = _factory.CreateClient();
        var getResponse = await anonymousClient.GetAsync($"/microclimates/{created.Id}");

        Assert.Equal(HttpStatusCode.Unauthorized, getResponse.StatusCode);
    }

    [Fact]
    public async Task Anonymous_visitor_cannot_read_a_closed_microclimate_even_when_configured_for_anonymous_responses()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Finished pulse", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "closed", null));

        var anonymousClient = _factory.CreateClient();
        var getResponse = await anonymousClient.GetAsync($"/microclimates/{created.Id}");

        Assert.Equal(HttpStatusCode.Unauthorized, getResponse.StatusCode);
    }

    [Fact]
    public async Task Anonymous_visitor_cannot_read_details_of_a_microclimate_not_configured_for_anonymous_responses()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Private pulse", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5,
            AnonymousResponses: false, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var anonymousClient = _factory.CreateClient();
        var getResponse = await anonymousClient.GetAsync($"/microclimates/{created!.Id}");

        Assert.Equal(HttpStatusCode.Unauthorized, getResponse.StatusCode);
    }

    // --- Privilege-escalation regression coverage (final whole-branch review finding #1) ---
    // Every test above signs up as CompanyAdmin, which made the pre-fix CanAccessCompany bug
    // (missing the Roles.CompanyAdmin clause, so *any* authenticated role in the company passed)
    // invisible to the suite. These sign up as non-admin roles explicitly.

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    public async Task Non_admin_roles_cannot_list_their_companys_microclimates(string role)
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Admin-only listing", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));

        var nonAdminToken = await SignUpAndGetTokenAsync(client, role, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", nonAdminToken);

        var listResponse = await client.GetAsync($"/microclimates?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    public async Task Non_admin_roles_cannot_update_a_microclimate_in_their_own_company(string role)
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Not for employees to activate", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var nonAdminToken = await SignUpAndGetTokenAsync(client, role, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", nonAdminToken);

        var updateResponse = await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        Assert.Equal(HttpStatusCode.Forbidden, updateResponse.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    public async Task Non_admin_roles_cannot_create_a_microclimate(string role)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, role, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Should be forbidden", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));

        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Supervisor)]
    [InlineData(Roles.Leader)]
    public async Task Non_admin_roles_cannot_view_live_results_for_a_microclimate_in_their_own_company(string role)
    {
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Not for employees to view", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null));
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var nonAdminToken = await SignUpAndGetTokenAsync(client, role, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", nonAdminToken);

        var liveResultsResponse = await client.GetAsync($"/microclimates/{created!.Id}/live-results");
        Assert.Equal(HttpStatusCode.Forbidden, liveResultsResponse.StatusCode);
    }

    [Fact]
    public async Task Creating_a_microclimate_with_an_unknown_template_id_returns_400_not_500()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Bad template ref", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true,
            TemplateId: Guid.NewGuid(), Questions: null));

        Assert.Equal(HttpStatusCode.BadRequest, createResponse.StatusCode);
    }

    [Fact]
    public async Task Creating_a_microclimate_with_another_companys_template_id_returns_400()
    {
        var client = _factory.CreateClient();
        var tokenB = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyBDomain, _companyBId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var templateResponse = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Company B's template", "Only for company B", "engagement", _companyBId));
        var template = await templateResponse.Content.ReadFromJsonAsync<MicroclimateTemplateDetail>();

        var tokenA = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Cross-tenant template ref", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true,
            TemplateId: template!.Id, Questions: null));

        Assert.Equal(HttpStatusCode.BadRequest, createResponse.StatusCode);
    }

    [Fact]
    public async Task Creating_a_microclimate_from_a_valid_template_increments_its_usage_count()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var templateResponse = await client.PostAsJsonAsync("/microclimate-templates", new CreateMicroclimateTemplateRequest(
            "Weekly check-in", "Standard weekly pulse", "engagement", _companyAId));
        var template = await templateResponse.Content.ReadFromJsonAsync<MicroclimateTemplateDetail>();
        Assert.Equal(0, template!.UsageCount);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "From template", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true,
            TemplateId: template.Id, Questions: null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var listResponse = await client.GetAsync($"/microclimate-templates?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<MicroclimateTemplateListResponse>();
        Assert.Equal(1, list!.Templates.Single(t => t.Id == template.Id).UsageCount);
    }

    [Fact]
    public async Task Creating_a_multiple_choice_question_with_fewer_than_2_options_is_rejected()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Broken multiple choice", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null,
            new List<CreateQuestionInput> { new("Pick one", "multiple_choice", null, true, 1) }));

        Assert.Equal(HttpStatusCode.BadRequest, createResponse.StatusCode);
    }

    [Fact]
    public async Task Creating_a_microclimate_with_a_timezone_persists_it_on_scheduling()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Timezone test", null, _companyAId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddHours(1), 5, true, null, null,
            Timezone: "America/Bogota"));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var microclimate = await db.Microclimates.FirstAsync(m => m.Id == created!.Id);
        Assert.Equal("America/Bogota", microclimate.Scheduling.Timezone);
    }
}
