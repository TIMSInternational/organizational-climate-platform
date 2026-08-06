using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
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
            _companyAId, "gender", "Gender", "select", [new(null, "Male"), new(null, "Female"), new(null, "Other")], true, 1));
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

    [Fact]
    public async Task A_demographic_answer_is_validated_against_the_option_value_not_its_label()
    {
        // Same rule as question options, deliberately -- one rule rather than two.
        // A person's demographic is stored as the option's stable value, so a
        // bilingual company filtering a dashboard by "Ventas"/"Sales" does not split
        // its own headcount in half the moment the labels are translated (#195).
        var client = _factory.CreateClient();
        var adminToken = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var createResponse = await client.PostAsJsonAsync("/admin/demographic-fields", new CreateDemographicFieldRequest(
            _companyAId,
            "department",
            LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Department", ["es"] = "Departamento" }),
            "select",
            [
                new DemographicFieldOptionInput("sales", LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Sales", ["es"] = "Ventas" })),
                new DemographicFieldOptionInput("engineering", LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Engineering", ["es"] = "Ingeniería" })),
            ],
            true,
            1));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var spanish = await (await client.GetAsync($"/admin/demographic-fields?companyId={_companyAId}&lang=es"))
            .Content.ReadFromJsonAsync<DemographicFieldListResponse>();
        var field = Assert.Single(spanish!.Fields, f => f.Field == "department");
        Assert.Equal("Departamento", field.Label);
        Assert.NotNull(field.Options);
        var firstOption = field.Options.First();
        Assert.Equal("Ventas", firstOption.Label);
        // One value behind two labels.
        Assert.Equal("sales", firstOption.Value);

        var employeeClient = _factory.CreateClient();
        await SignUpAndGetTokenAsync(employeeClient, Roles.Employee, _companyADomain, _companyAId);
        Guid employeeId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            employeeId = (await db.Users.OrderByDescending(u => u.CreatedAt)
                .FirstAsync(u => u.CompanyId == _companyAId && u.Role == Roles.Employee)).Id;
        }

        var byValue = await client.PutAsJsonAsync($"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["department"] = "sales" }));
        Assert.Equal(HttpStatusCode.OK, byValue.StatusCode);

        // The label is not an allowed answer, so a client that renders "Ventas" and
        // posts it back cannot quietly store a second value for the same department.
        var byLabel = await client.PutAsJsonAsync($"/admin/users/{employeeId}",
            new UpdateUserRequest(null, null, null, null, new Dictionary<string, string?> { ["department"] = "Ventas" }));
        Assert.Equal(HttpStatusCode.BadRequest, byLabel.StatusCode);
    }
}
