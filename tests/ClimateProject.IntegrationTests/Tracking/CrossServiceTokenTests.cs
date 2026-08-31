using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Profile;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ProjectAuth = ClimateProject.Application.Auth;
using TrackingAuth = ClimateTracking.Application.Auth;

namespace ClimateProject.IntegrationTests.Tracking;

/// <summary>
/// #153. The seam between the two services: this API mints a JWT, climate-tracking accepts it,
/// and the only thing they share is the symmetric <c>TrackingJwtSecret</c>. There is no issuer
/// and no audience on either side, so nothing in the token itself says who it was minted for
/// or by — a disagreement about a claim's NAME or its VALUE is not an error anywhere, it is a
/// user who quietly loses their role, their nodo or their whole tenant.
/// </summary>
/// <remarks>
/// <para>
/// What made this the largest untested seam in the system is that both halves were covered and
/// the join was not. This suite proves the mint (<c>NodoClaimTests</c>, <c>LoginEndpointTests</c>,
/// <c>SecurityStampRevocationTests</c>); climate-tracking's suite proves its own validation
/// (<c>JwtAuthenticationTests</c> 401s an expired token, 403s a wrong tenant). But every test
/// over there hand-builds the <c>ClaimsPrincipal</c> it validates — including the one that
/// hand-builds a JWT with its own literal claim list — so no test anywhere fed a token this API
/// actually produced into the parameters that API actually validates with. Both suites stay
/// green through any drift between them.
/// </para>
/// <para>
/// The mint side here is real all the way down: a seeded row, HTTP <c>/auth/signup</c> and
/// <c>/auth/login</c>, through <c>AuthEndpoints.IssueTokenForAsync</c> (the single mint) and
/// <c>JwtTokenService</c>. The validation side is real by reference:
/// <see cref="TrackingAuth.TrackingTokenValidation"/> and
/// <see cref="TrackingAuth.ClaimsPrincipalExtensions.GetCurrentUser"/> are the types
/// climate-tracking's own <c>Program.cs</c> and endpoints use, compiled from
/// <c>services/tracking-api/</c> — see the ProjectReference note in the .csproj. Re-deriving
/// them here would make this test agree with itself and nothing else.
/// </para>
/// <para>
/// <b>Not covered here:</b> the bearer middleware wiring on the other side (that
/// climate-tracking's <c>Program.cs</c> hands these parameters to the handler and this
/// requirement to the default policy). That is what its own <c>JwtAuthenticationTests</c>
/// asserts end to end over HTTP. Together the two say: those parameters are what the service
/// runs, and a token minted here satisfies them.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class CrossServiceTokenTests : IAsyncLifetime
{
    /// <summary>
    /// One secret, two services, no other shared state. In a deployment this is the same
    /// string in both services' configuration; here it is the value this API is configured
    /// with, handed to climate-tracking's parameters exactly as an operator would.
    /// </summary>
    private const string SharedTrackingJwtSecret = AuthWebApplicationFactory.TestJwtSecret;

    private const string Password = "a-good-password";

    /// <summary>Satisfies the default password policy, like <c>SecurityStampRevocationTests</c>'.</summary>
    private const string ReplacementPassword = "Rep1acementPass";

    private readonly AuthWebApplicationFactory _factory;
    private readonly JsonSerializerOptions _snakeCaseOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private readonly string _emailDomain = $"crossservice-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _departmentId;
    private string _nodoExternalId = null!;

    public CrossServiceTokenTests(PostgresContainerFixture postgres)
    {
        // The collection's shared host, not a per-class factory: xUnit builds a new class
        // instance per [Fact], so `new AuthWebApplicationFactory(...)` here is one host per
        // test CASE -- the #279 pattern the HostBudget guard in CreateHost refuses. This
        // class was written before that conversion landed and merged past it unrebased;
        // the guard caught the combination on main's first full run.
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        _companyId = Guid.NewGuid();
        _departmentId = Guid.NewGuid();
        _nodoExternalId = $"ND-{Guid.NewGuid():N}";

        db.Companies.Add(new Company
        {
            Id = _companyId,
            Name = "Cross Service Co",
            EmailDomain = _emailDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        db.Departments.Add(new Department
        {
            Id = _departmentId,
            CompanyId = _companyId,
            Name = "Operaciones",
            LegacyExternalId = _nodoExternalId,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Validates a token the way climate-tracking's bearer handler does: its parameters, its
    /// MapInboundClaims setting, and <see cref="JsonWebTokenHandler"/>, which is what
    /// JwtBearerOptions.TokenHandlers holds by default.
    /// </summary>
    private static async Task<ClaimsPrincipal> ValidateAsTrackingDoesAsync(string token)
    {
        var result = await ValidateAsync(token, SharedTrackingJwtSecret);

        Assert.True(result.IsValid, $"climate-tracking would reject this token: {result.Exception?.Message}");

        return new ClaimsPrincipal(result.ClaimsIdentity);
    }

    private static Task<TokenValidationResult> ValidateAsync(string token, string trackingJwtSecret)
    {
        var handler = new JsonWebTokenHandler
        {
            MapInboundClaims = TrackingAuth.TrackingTokenValidation.MapInboundClaims,
        };

        return handler.ValidateTokenAsync(
            token,
            TrackingAuth.TrackingTokenValidation.CreateParameters(trackingJwtSecret));
    }

    /// <summary>
    /// climate-tracking's tenant gate, the requirement its default authorization policy adds
    /// to every authorized endpoint, run against a principal from a real token.
    /// </summary>
    private static async Task<bool> PassesTrackingTenantGateAsync(ClaimsPrincipal user, string procomerCompanyId)
    {
        var handler = new TrackingAuth.MatchingTenantHandler();
        var context = new AuthorizationHandlerContext(
            [new TrackingAuth.MatchingTenantRequirement(procomerCompanyId)], user, resource: null);

        await handler.HandleAsync(context);

        return context.HasSucceeded;
    }

    /// <summary>
    /// A token minted the way a real one is: signed up over HTTP, then logged in over HTTP,
    /// through <c>AuthEndpoints.IssueTokenForAsync</c> and <c>JwtTokenService</c>.
    /// </summary>
    /// <remarks>
    /// The row is rewritten between the two calls because signup always derives the company
    /// from the email domain and always creates a department-less employee, so a leader (or a
    /// company-less super_admin) can only be produced by setting the columns and re-minting.
    /// Same approach, and same reason, as <c>CompanyLessSuperAdminTests</c>: no endpoint
    /// provisions these users.
    /// </remarks>
    private async Task<string> SignUpAndLogInAsync(
        HttpClient client,
        string email,
        string name,
        string role,
        Guid? departmentId,
        Guid? companyId)
    {
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest(name, email, Password));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.DepartmentId = departmentId;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, Password));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private Task<string> LeaderTokenAsync(HttpClient client, string email, string name = "Maria Rodriguez")
        => SignUpAndLogInAsync(client, email, name, role: "leader", departmentId: _departmentId, companyId: _companyId);

    /// <summary>A client presenting <paramref name="token"/> to this API, over HTTP.</summary>
    private HttpClient ClientWith(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [Fact]
    public async Task Every_claim_the_tracking_service_reads_survives_a_real_login()
    {
        // THE regression test for #153. It reads every field of climate-tracking's CurrentUser
        // out of a token this API minted, using climate-tracking's own reader.
        //
        // One assertion per field, because only ONE of these claims fails loudly. GetCurrentUser
        // throws on a missing sub; every other claim it cannot find becomes string.Empty. So a
        // renamed or dropped role, nodoId, email, name or companyId does not lock anyone out of
        // climate-tracking — it authenticates them and then scopes them as if they led nothing,
        // which is the failure this whole file exists to make impossible to ship.
        var client = _factory.CreateClient();
        var email = $"leader@{_emailDomain}";
        var token = await LeaderTokenAsync(client, email);

        var principal = await ValidateAsTrackingDoesAsync(token);
        var currentUser = TrackingAuth.ClaimsPrincipalExtensions.GetCurrentUser(principal);

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            userId = (await db.Users.AsNoTracking().FirstAsync(u => u.Email == email)).Id;
        }

        // sub: no PersonaExternalId has been assigned to this row, so the mint falls back to
        // the primary key. Either way it is the id climate-tracking compares against
        // PlanDeAccion.ResponsableEjecucionExternalId and its persona cache.
        Assert.Equal(userId.ToString(), currentUser.PersonaExternalId);
        Assert.Equal("leader", currentUser.Role);
        Assert.Equal(_nodoExternalId, currentUser.NodoExternalId);
        Assert.Equal(email, currentUser.Email);
        Assert.Equal("Maria Rodriguez", currentUser.Name);
        Assert.Equal(_companyId.ToString(), currentUser.CompanyId);
        Assert.True(currentUser.IsActive);
    }

    [Fact]
    public async Task The_companyId_claim_opens_the_tenant_gate_for_its_own_company_and_no_other()
    {
        // climate-tracking compares the claim to its configured ProcomerCompanyId with string
        // equality, so this is a statement about the VALUE's shape, not just its presence: the
        // claim is Guid.ToString(), i.e. lowercase 8-4-4-4-12, which is what a deployment must
        // put in ProcomerCompanyId. A mint that ever emitted "N" format, braces, uppercase or
        // a legacy company code would 403 every request in the tracking module while every
        // test on both sides stayed green.
        var client = _factory.CreateClient();
        var token = await LeaderTokenAsync(client, $"tenant@{_emailDomain}");

        var principal = await ValidateAsTrackingDoesAsync(token);

        Assert.True(await PassesTrackingTenantGateAsync(principal, _companyId.ToString()));
        Assert.False(await PassesTrackingTenantGateAsync(principal, Guid.NewGuid().ToString()));
    }

    [Fact]
    public async Task The_sub_claim_is_the_persona_id_that_internal_personas_reports()
    {
        // The #151 guarantee, for sub rather than nodoId. climate-tracking fills PersonaCache
        // from /api/internal/personas and then authorizes on the sub claim
        // (CurrentUser.PersonaExternalId is compared to PlanDeAccion.ResponsableEjecucionExternalId
        // and to InvolucradosExternalIds). Those two values are compared against each other, so
        // they must be produced by one derivation — both now call
        // TrackingIdentifiers.ExternalPersonaId.
        var client = _factory.CreateClient();
        var email = $"persona@{_emailDomain}";
        var token = await LeaderTokenAsync(client, email);

        var principal = await ValidateAsTrackingDoesAsync(token);
        var sub = TrackingAuth.ClaimsPrincipalExtensions.GetCurrentUser(principal).PersonaExternalId;

        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/internal/personas?company_id={_companyId}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);
        var response = await client.SendAsync(request);
        Assert.True(response.IsSuccessStatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<PersonasData>>(_snakeCaseOptions);
        var persona = Assert.Single(envelope!.Data.Personas, p => p.Correo == email);

        Assert.NotEmpty(sub);
        Assert.Equal(persona.PersonaId, sub);
    }

    [Fact]
    public async Task A_company_less_super_admin_passes_a_configured_tenant_but_never_a_blank_one()
    {
        // Two rules that look alike and are not, stated across the seam rather than at the
        // handler — which is the only place the CLAIM and the GATE are both real.
        //
        // **The blank tenant is still refused, and that is #153.** This API mints
        // `companyId: user.CompanyId?.ToString() ?? string.Empty`, so a company-less
        // super_admin (#191) really does carry a blank tenant claim — asserted below rather
        // than assumed, because the whole hazard rests on it. climate-tracking's
        // appsettings.json ships `"ProcomerCompanyId": ""`, so a deployment that never
        // overrode it expected a blank tenant too, and blank-equals-blank handed a user
        // belonging to NO company the run of a tenant's entire API. Program.cs refuses to
        // start on a blank value and the handler refuses to match one.
        //
        // **The configured tenant is now ADMITTED, and that is deliberate.** This test used
        // to assert the opposite, and it was right to until the policy changed: the service
        // is single-tenant by construction (nothing in ClimateTracking.Domain carries a
        // company column, and ProcomerCompanyId pins the deployment), `PlanAccessHandler`
        // already holds that admin roles always pass, and the platform operator was excluded
        // only as a SIDE EFFECT of closing the blank-blank hole — never as a decision.
        // Ruled explicitly on 2026-08-27 rather than inferred from the code.
        //
        // The role split this rests on is `Roles.SuperAdmin` and NOT `Roles.Admin`: a
        // company_admin belongs to exactly one tenant, so admitting them on the role alone
        // would hand this deployment's data to another company's administrator.
        // `MatchingTenantHandlerTests` holds that pair, and four sibling cases, at the unit
        // level; this one proves the claim a REAL login mints reaches the gate intact.
        var client = _factory.CreateClient();
        var token = await SignUpAndLogInAsync(
            client,
            $"global-admin@{_emailDomain}",
            "Global Admin",
            role: "super_admin",
            departmentId: null,
            companyId: null);

        var principal = await ValidateAsTrackingDoesAsync(token);
        var currentUser = TrackingAuth.ClaimsPrincipalExtensions.GetCurrentUser(principal);

        // The hazard the rest of this test is about is only real because this is blank.
        Assert.Equal(string.Empty, currentUser.CompanyId);

        // No tenant configured: nobody passes, whatever their role. Fail-closed (#153).
        Assert.False(await PassesTrackingTenantGateAsync(principal, string.Empty));

        // A tenant IS configured: the platform operator reaches it.
        Assert.True(await PassesTrackingTenantGateAsync(principal, _companyId.ToString()));
    }

    [Fact]
    public async Task A_token_signed_with_any_other_secret_is_rejected()
    {
        // Keeps the rest of this class honest. Every assertion above is worth exactly as much
        // as the validator's ability to say no, and a TokenValidationParameters that had lost
        // its signature check would pass all of them.
        var client = _factory.CreateClient();
        var token = await LeaderTokenAsync(client, $"wrong-secret@{_emailDomain}");

        var result = await ValidateAsync(token, "a-completely-different-secret-value-1234567890");

        Assert.False(result.IsValid);
        Assert.IsType<SecurityTokenSignatureKeyNotFoundException>(result.Exception);
    }

    // ------------------------------------------------------------ revocation, and its limit

    /// <summary>
    /// A KNOWN, BOUNDED GAP, asserted end to end so that it is a decision rather than a
    /// surprise. Read <c>docs/decisions/cross-service-session-revocation.md</c> before
    /// changing this test.
    /// </summary>
    /// <remarks>
    /// The two halves below run against the same token: this API refuses it, and
    /// climate-tracking's validation contract accepts it. Both are real — the refusal is an
    /// HTTP request through the bearer handler and its <c>OnTokenValidated</c> hook, and the
    /// acceptance is <see cref="TrackingAuth.TrackingTokenValidation"/>, the type
    /// climate-tracking's own <c>Program.cs</c> configures its handler from.
    /// </remarks>
    [Fact]
    public async Task A_session_this_api_has_ended_is_still_accepted_by_climate_tracking()
    {
        // #284's headline case, told across the seam: a user changes their password because
        // they believe they are compromised. Every session this API knows about dies at the
        // rotation. The one in the other service does not.
        var client = _factory.CreateClient();
        var email = $"revoked@{_emailDomain}";
        var token = await LeaderTokenAsync(client, email);

        // Live on BOTH sides first, so neither assertion below is about a token that never
        // worked in the first place.
        Assert.Equal(HttpStatusCode.OK, (await ClientWith(token).GetAsync("/profile")).StatusCode);
        Assert.True(await PassesTrackingTenantGateAsync(await ValidateAsTrackingDoesAsync(token), _companyId.ToString()));

        var change = await ClientWith(token).PutAsJsonAsync(
            "/profile/password",
            new ChangePasswordRequest(Password, ReplacementPassword));
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        // This API, from the next request: refused. SecurityStampValidation compared the
        // token's securityStamp claim against the row the rotation just wrote.
        Assert.Equal(HttpStatusCode.Unauthorized, (await ClientWith(token).GetAsync("/profile")).StatusCode);

        // climate-tracking, with the same token: admitted, and admitted as the same person.
        // It has no users table to compare that claim against, and a password change moves
        // none of the things it does check — the signature is untouched, the token has not
        // expired, the tenant claim is the same tenant, and the isActive claim still says
        // what it said when it was minted.
        var principal = await ValidateAsTrackingDoesAsync(token);
        Assert.True(await PassesTrackingTenantGateAsync(principal, _companyId.ToString()));
        Assert.False(TrackingAuth.ClaimsPrincipalExtensions.HasDeactivatedAccountClaim(principal));
        Assert.Equal(email, TrackingAuth.ClaimsPrincipalExtensions.GetCurrentUser(principal).Email);
    }

    /// <summary>
    /// The size of the window the test above leaves open, pinned to the number the decision
    /// record publishes. If the mint's lifetime changes, this fails and that record is wrong
    /// until someone updates it.
    /// </summary>
    [Fact]
    public async Task The_window_a_revoked_token_stays_live_over_there_for_is_the_token_lifetime()
    {
        var client = _factory.CreateClient();
        var token = await LeaderTokenAsync(client, $"lifetime@{_emailDomain}");

        var jwt = new JsonWebTokenHandler().ReadJsonWebToken(token);

        // Off the token, not off JwtTokenService.TokenLifetime: that field is private, and a
        // test reading the constant would agree with the constant no matter what the token
        // ended up carrying. exp and iat are both whole seconds truncated from the same
        // instant, so their difference is exact rather than approximate.
        var issuedAt = DateTimeOffset.FromUnixTimeSeconds(long.Parse(jwt.GetClaim("iat").Value));
        var expires = new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero);

        Assert.Equal(TimeSpan.FromHours(24), expires - issuedAt);
    }

    /// <summary>
    /// The one revocation-adjacent claim both services DO read, read the same way by both.
    /// </summary>
    /// <remarks>
    /// Two implementations exist because no assembly under <c>src/</c> on either side may
    /// reference the other; this is the only place both are on one compile path, so it is the
    /// only place the copies can be held together. It is not revocation — see the test above
    /// for what the claim cannot say — but a service that refused a token the other served,
    /// or served one the other refused, would be the same class of silent split-brain.
    /// </remarks>
    [Theory]
    [InlineData(null, false)]
    [InlineData("true", false)]
    [InlineData("True", false)]
    [InlineData("false", true)]
    [InlineData("yes", true)]
    [InlineData("", true)]
    public void The_two_services_read_the_isActive_claim_identically(string? claim, bool expectedDeactivated)
    {
        var claims = new List<Claim> { new("sub", "PER-0231") };
        if (claim is not null)
        {
            claims.Add(new Claim("isActive", claim));
        }

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "Test"));

        // Asserted against a stated expectation, not just against each other: two predicates
        // that both answered false to everything would agree perfectly and protect nothing.
        Assert.Equal(expectedDeactivated, ProjectAuth.ClaimsPrincipalExtensions.HasDeactivatedAccountClaim(principal));
        Assert.Equal(expectedDeactivated, TrackingAuth.ClaimsPrincipalExtensions.HasDeactivatedAccountClaim(principal));
    }

    [Fact]
    public async Task The_minted_token_carries_no_issuer_and_no_audience()
    {
        // Both services validate with ValidateIssuer and ValidateAudience false, which is only
        // safe while this stays true: the day the mint starts stamping an `iss` or an `aud`,
        // turning either check on over there becomes possible — and until then, leaving them
        // off is a deliberate consequence of the mint, not an oversight to be "fixed" by
        // enabling a check that would reject every token this API produces.
        var client = _factory.CreateClient();
        var token = await LeaderTokenAsync(client, $"no-iss@{_emailDomain}");

        var jwt = new JsonWebTokenHandler().ReadJsonWebToken(token);

        Assert.True(string.IsNullOrEmpty(jwt.Issuer), $"unexpected iss: {jwt.Issuer}");
        Assert.Empty(jwt.Audiences);
    }
}
