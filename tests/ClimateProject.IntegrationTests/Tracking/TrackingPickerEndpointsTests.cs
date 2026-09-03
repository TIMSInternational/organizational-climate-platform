using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Tracking;

[Collection("Postgres")]
public class TrackingPickerEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"picka-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"pickb-{Guid.NewGuid():N}.test";

    // Per-instance, not the literal "legacy-nodo-1" this used to seed. InitializeAsync runs once
    // per [Fact] against a container shared by the whole collection, so a fixed legacy id was
    // re-inserted for every test in this class -- harmless until #155 gave
    // departments.legacy_external_id a unique index, at which point the second test in the class
    // fails on 23505 during seeding. The two sibling classes that seed legacy ids
    // (TrackingInternalEndpointsTests, NodoClaimTests) were already written this way.
    private readonly string _legacyNodoId = $"legacy-nodo-{Guid.NewGuid():N}";
    private Guid _companyAId;
    private Guid _companyBId;

    public TrackingPickerEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Picker Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Picker Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;

        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyAId,
            Name = "Engineering",
            LegacyExternalId = _legacyNodoId,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyAId,
            Name = "Fresh Department",
            LegacyExternalId = null,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        if (role != Roles.Employee)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }
            await db.SaveChangesAsync();

            var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
            token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        }

        return token;
    }

    [Fact]
    public async Task CompanyAdmin_can_list_nodos_for_their_own_company_with_legacy_id_fallback()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync($"/tracking/picker/nodos?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<NodoPickerResponse>();

        Assert.Contains(body!.Nodos, n => n.Id == _legacyNodoId && n.Name == "Engineering");
        Assert.Contains(body.Nodos, n => n.Name == "Fresh Department" && Guid.TryParse(n.Id, out _));
    }

    [Fact]
    public async Task CompanyAdmin_cannot_list_nodos_or_personas_for_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var nodosResponse = await client.GetAsync($"/tracking/picker/nodos?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, nodosResponse.StatusCode);

        var personasResponse = await client.GetAsync($"/tracking/picker/personas?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, personasResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_list_personas_with_persona_external_id_fallback()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync($"/tracking/picker/personas?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<PersonaPickerResponse>();

        // The signed-up user has no PersonaExternalId set, so ExternalPersonaId falls back to their own Guid Id.
        Assert.Contains(body!.Personas, p => Guid.TryParse(p.Id, out _));
    }
}
