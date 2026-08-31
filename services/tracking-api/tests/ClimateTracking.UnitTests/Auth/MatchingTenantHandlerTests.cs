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

    private static ClaimsPrincipal UserWith(string? companyId, string? role) => new(
        new ClaimsIdentity(
            [
                .. companyId is null ? Array.Empty<Claim>() : [new Claim("companyId", companyId)],
                .. role is null ? Array.Empty<Claim>() : [new Claim("role", role)],
            ],
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

    // ------------------------------------------------------------------
    // The platform operator.
    // ------------------------------------------------------------------

    /// <summary>
    /// A global super_admin has no company since #191, so their `companyId` claim is blank
    /// and can never match the pin. That kept them out of a service whose own
    /// PlanAccessHandler says "Admin roles (company_admin, super_admin) always pass" — an
    /// unintended side effect of closing the blank==blank hole, not a decision.
    /// </summary>
    [Fact]
    public async Task A_super_admin_with_no_company_of_their_own_passes()
    {
        Assert.True(await Authorize(UserWith(companyId: null, role: "super_admin"), ProcomerCompanyId));
        Assert.True(await Authorize(UserWith(companyId: "", role: "super_admin"), ProcomerCompanyId));
    }

    /// <summary>
    /// #153 outranks the arm above, and this is the test that proves the ordering rather than
    /// trusting it. "No tenant configured" must fail closed for EVERY caller — the one thing
    /// a second arm could quietly undo.
    /// </summary>
    [Fact]
    public async Task A_super_admin_still_does_not_pass_when_no_tenant_is_configured()
    {
        Assert.False(await Authorize(UserWith(companyId: null, role: "super_admin"), string.Empty));
        Assert.False(await Authorize(UserWith(companyId: null, role: "super_admin"), "   "));
    }

    /// <summary>
    /// The failure this arm invites. `Roles.Admin` holds company_admin as well, so admitting
    /// on "is an admin role" would hand this deployment's plans to the administrator of a
    /// DIFFERENT tenant — the exact property the gate exists to hold.
    /// </summary>
    [Fact]
    public async Task A_company_admin_from_another_tenant_still_does_not_pass()
    {
        var otherTenant = Guid.NewGuid().ToString();
        Assert.False(await Authorize(UserWith(otherTenant, "company_admin"), ProcomerCompanyId));
        Assert.False(await Authorize(UserWith(companyId: null, role: "company_admin"), ProcomerCompanyId));
    }

    /// <summary>
    /// And a company_admin of THIS tenant is unaffected by the new arm — they pass on their
    /// company claim, exactly as before.
    /// </summary>
    [Fact]
    public async Task A_company_admin_of_this_tenant_still_passes()
    {
        Assert.True(await Authorize(UserWith(ProcomerCompanyId, "company_admin"), ProcomerCompanyId));
    }

    /// <summary>
    /// A role nobody grants must not be a way in. Guards against an arm written as
    /// "anything that is not blank" or a typo'd constant.
    /// </summary>
    [Fact]
    public async Task An_unknown_role_does_not_pass_on_the_role_alone()
    {
        Assert.False(await Authorize(UserWith(companyId: null, role: "superadmin"), ProcomerCompanyId));
        Assert.False(await Authorize(UserWith(companyId: null, role: "SUPER_ADMIN"), ProcomerCompanyId));
        Assert.False(await Authorize(UserWith(companyId: null, role: "leader"), ProcomerCompanyId));
    }
}
