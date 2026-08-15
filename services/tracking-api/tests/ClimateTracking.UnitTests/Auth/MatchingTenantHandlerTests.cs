using System.Security.Claims;
using ClimateTracking.Application.Auth;
using Microsoft.AspNetCore.Authorization;

namespace ClimateTracking.UnitTests.Auth;

/// <summary>
/// The tenant gate every authorized endpoint in this service goes through (Program.cs builds
/// it into the default policy), and #153's fail-closed rule for it.
/// </summary>
public class MatchingTenantHandlerTests
{
    private const string ProcomerCompanyId = "0f8a2c1e-4b6d-4a71-9f2e-5c8d3b7a1e40";

    /// <summary>
    /// Only the claim the handler reads. The principal a real request carries has seven, but
    /// naming just this one keeps it obvious that nothing else takes part in the decision.
    /// </summary>
    private static ClaimsPrincipal UserWithCompanyClaim(string? companyId) => new(
        new ClaimsIdentity(
            companyId is null ? [] : new[] { new Claim("companyId", companyId) },
            "TestAuth"));

    private static async Task<bool> Authorize(ClaimsPrincipal user, string expectedCompanyId)
    {
        var handler = new MatchingTenantHandler();
        var context = new AuthorizationHandlerContext(
            [new MatchingTenantRequirement(expectedCompanyId)], user, resource: null);

        await handler.HandleAsync(context);

        return context.HasSucceeded;
    }

    [Fact]
    public async Task A_token_for_this_deployments_company_passes()
    {
        Assert.True(await Authorize(UserWithCompanyClaim(ProcomerCompanyId), ProcomerCompanyId));
    }

    [Fact]
    public async Task A_token_for_another_company_does_not()
    {
        Assert.False(await Authorize(UserWithCompanyClaim(Guid.NewGuid().ToString()), ProcomerCompanyId));
    }

    [Fact]
    public async Task A_token_with_no_companyId_claim_at_all_does_not()
    {
        Assert.False(await Authorize(UserWithCompanyClaim(null), ProcomerCompanyId));
    }

    /// <summary>
    /// #153's fail-closed rule, and the reason this handler no longer compares two strings and
    /// takes what it gets. Both blanks are reachable at once: climate-project-api mints an
    /// empty companyId claim for a company-less super_admin, and every deployment that left
    /// appsettings.json's <c>"ProcomerCompanyId": ""</c> alone expected an empty one. Plain
    /// equality made that pair a match and granted the whole API to a caller belonging to no
    /// tenant. Program.cs now refuses to start blank, which is the fix; this is the floor
    /// under it, so a requirement built blank anywhere else still authorises nobody.
    /// </summary>
    [Theory]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData("", ProcomerCompanyId)]
    [InlineData(ProcomerCompanyId, "")]
    public async Task A_blank_tenant_on_either_side_never_matches(string claim, string expected)
    {
        Assert.False(await Authorize(UserWithCompanyClaim(claim), expected));
    }
}
