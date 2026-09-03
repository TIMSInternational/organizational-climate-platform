using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// #151. The <c>nodoId</c> JWT claim used to be minted from <c>User.NodoId</c>, a column no
/// code path ever wrote, so it was always the empty string -- while climate-tracking
/// authorizes tablero and plan scoping on exactly that claim
/// (<c>CurrentUser.NodoExternalId</c>) and fills its persona cache from
/// <c>/api/internal/personas</c>, which derived the value correctly from
/// <c>User.DepartmentId</c>. These tests pin that both sides now agree.
/// </summary>
[Collection("Postgres")]
public class NodoClaimTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private readonly string _emailDomain = $"nodoclaim-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _departmentId;
    private string _legacyNodoId = null!;

    public NodoClaimTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        _companyId = Guid.NewGuid();
        _departmentId = Guid.NewGuid();
        _legacyNodoId = $"legacy-nodo-{Guid.NewGuid():N}";

        db.Companies.Add(new Company
        {
            Id = _companyId,
            Name = "Nodo Claim Co",
            EmailDomain = _emailDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.Departments.Add(new Department
        {
            Id = _departmentId,
            CompanyId = _companyId,
            Name = "Engineering",
            LegacyExternalId = _legacyNodoId,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private static string DecodeNodoClaim(string token)
        => new JwtSecurityTokenHandler().ReadJwtToken(token).Claims.Single(c => c.Type == "nodoId").Value;

    private const string Password = "A-good-passw0rd";

    /// <summary>Signs a user up and returns their signup token.</summary>
    private async Task<string> SignupAsync(HttpClient client, string email, string name)
    {
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest(name, email, Password));
        Assert.True(signup.IsSuccessStatusCode, $"signup failed: {(int)signup.StatusCode} {await signup.Content.ReadAsStringAsync()}");
        return (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task AssignDepartmentAsync(string email, Guid departmentId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = await db.Users.FirstAsync(u => u.Email == email);
        user.DepartmentId = departmentId;
        await db.SaveChangesAsync();
    }

    private async Task<string> LoginAsync(HttpClient client, string email)
    {
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, Password));
        Assert.True(login.IsSuccessStatusCode, $"login failed: {(int)login.StatusCode} {await login.Content.ReadAsStringAsync()}");
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    [Fact]
    public async Task Login_mints_the_nodoId_claim_from_the_users_department()
    {
        var client = _factory.CreateClient();
        var email = $"has-dept@{_emailDomain}";
        await SignupAsync(client, email, "Has Department");
        await AssignDepartmentAsync(email, _departmentId);

        var token = await LoginAsync(client, email);

        // Before #151 this was string.Empty for every user alive, department or not.
        Assert.Equal(_legacyNodoId, DecodeNodoClaim(token));
    }

    [Fact]
    public async Task Login_mints_the_synthetic_unassigned_nodo_for_a_user_with_no_department()
    {
        // Plain /auth/signup and Google login never set DepartmentId, so this is the common
        // case, not an edge case. climate-tracking compares the claim verbatim as an
        // authorization key, so it must not be empty.
        var client = _factory.CreateClient();
        var email = $"no-dept@{_emailDomain}";

        var token = await SignupAsync(client, email, "No Department");

        var claim = DecodeNodoClaim(token);
        Assert.NotEmpty(claim);
        Assert.Equal(TrackingIdentifiers.UnassignedNodoId(_companyId), claim);
    }

    [Fact]
    public async Task Refresh_re_derives_the_nodoId_claim_rather_than_dropping_it()
    {
        var client = _factory.CreateClient();
        var email = $"refresh-dept@{_emailDomain}";
        await SignupAsync(client, email, "Refresh Department");
        await AssignDepartmentAsync(email, _departmentId);
        var loginToken = await LoginAsync(client, email);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", loginToken);
        var refresh = await client.SendAsync(request);

        Assert.True(refresh.IsSuccessStatusCode, $"refresh failed: {(int)refresh.StatusCode} {await refresh.Content.ReadAsStringAsync()}");
        var refreshed = (await refresh.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Assert.Equal(_legacyNodoId, DecodeNodoClaim(refreshed));
    }

    [Fact]
    public async Task Refresh_picks_up_a_department_change_made_since_the_token_was_issued()
    {
        // The claim is derived per token, not stored, so moving a user between nodos takes
        // effect on their next token instead of requiring a backfill of a persisted column.
        // This is the property that dropping User.NodoId buys.
        var client = _factory.CreateClient();
        var email = $"moves-dept@{_emailDomain}";
        var signupToken = await SignupAsync(client, email, "Moves Department");
        Assert.Equal(TrackingIdentifiers.UnassignedNodoId(_companyId), DecodeNodoClaim(signupToken));

        await AssignDepartmentAsync(email, _departmentId);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", signupToken);
        var refresh = await client.SendAsync(request);
        var refreshed = (await refresh.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        Assert.Equal(_legacyNodoId, DecodeNodoClaim(refreshed));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_nodoId_claim_matches_the_nodo_id_that_internal_personas_reports(bool withDepartment)
    {
        // THE regression test for #151. climate-tracking's CacheSyncWorker fills
        // PersonaCache.NodoExternalId from /api/internal/personas, while its
        // DashboardEndpoints/PlanesAccionEndpoints/PlanAccessHandler authorize on the nodoId
        // claim. Those two values are compared against each other, so they must be equal --
        // they were not, because the claim came from the always-null User.NodoId column.
        var client = _factory.CreateClient();
        // Lowercase deliberately: /auth/signup stores `request.Email.ToLowerInvariant()`, so a
        // mixed-case literal here (bool.ToString() renders "True") would never match the
        // stored row and both the department assignment and the /personas lookup would miss.
        var email = $"agrees-{(withDepartment ? "with" : "without")}-dept@{_emailDomain}";
        await SignupAsync(client, email, "Agrees");
        if (withDepartment)
        {
            await AssignDepartmentAsync(email, _departmentId);
        }

        var claim = DecodeNodoClaim(await LoginAsync(client, email));

        using var internalRequest = new HttpRequestMessage(HttpMethod.Get, $"/api/internal/personas?company_id={_companyId}");
        internalRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);
        var personasResponse = await client.SendAsync(internalRequest);
        Assert.True(personasResponse.IsSuccessStatusCode);

        var envelope = await personasResponse.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions);
        var persona = Assert.Single(envelope!.Data.Personas, p => p.Correo == email);

        Assert.NotEmpty(claim);
        Assert.Equal(persona.NodoId, claim);
    }
}
