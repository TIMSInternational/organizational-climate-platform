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
public class DemographicFieldEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"dfa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"dfb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public DemographicFieldEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "DF Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "DF Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
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
    public async Task CompanyAdmin_can_create_list_and_update_fields_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "gender", "Gender", "select", new List<string> { "Male", "Female", "Other" }, true, 1));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<DemographicFieldDetail>();

        var listResponse = await client.GetAsync($"/admin/demographic-fields?companyId={_companyAId}");
        var list = await listResponse.Content.ReadFromJsonAsync<DemographicFieldListResponse>();
        Assert.Contains(list!.Fields, f => f.Id == created!.Id);

        var updateResponse = await client.PutAsJsonAsync($"/admin/demographic-fields/{created!.Id}", new UpdateDemographicFieldRequest("Gender Identity", null, null, null, false));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<DemographicFieldDetail>();
        Assert.Equal("Gender Identity", updated!.Label);
        Assert.False(updated.IsActive);
    }

    [Fact]
    public async Task Creating_a_field_with_a_key_that_already_exists_for_the_company_returns_409_not_500()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var first = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "tenure", "Tenure", "number", null, false, 1));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // IX_demographic_fields_company_id_field is a UNIQUE index -- this must be a
        // clean 409 (matching CompanyEndpoints' analogous email-domain conflict),
        // never an unhandled 500 from the unique index inside SaveChangesAsync.
        var second = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "tenure", "Tenure (duplicate)", "text", null, false, 2));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(1, await db.DemographicFields.CountAsync(f => f.CompanyId == _companyAId && f.Field == "tenure"));
    }

    [Fact]
    public async Task Select_type_field_requires_non_empty_options()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "region", "Region", "select", null, false, 2));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_manage_fields_in_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyBId, "tenure", "Tenure", "number", null, false, 1));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var listResponse = await client.GetAsync($"/admin/demographic-fields?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);
    }

    [Theory]
    [InlineData(Roles.Employee)]
    [InlineData(Roles.Leader)]
    [InlineData(Roles.Supervisor)]
    public async Task Non_admin_role_cannot_manage_fields_even_in_their_own_company(string role)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, role, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId, "tenure", "Tenure", "number", null, false, 1));
        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);

        var listResponse = await client.GetAsync($"/admin/demographic-fields?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);
    }
}
