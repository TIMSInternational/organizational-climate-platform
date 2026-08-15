using System.Security.Claims;
using ClimateTracking.Application.Auth;

namespace ClimateTracking.UnitTests.Auth;

/// <summary>
/// The predicate behind this service's deactivation check, which its default authorization
/// policy applies to every authorized endpoint (#153).
/// </summary>
/// <remarks>
/// The same table as climate-project-api's <c>DeactivatedAccountClaimTests</c>, because the two
/// services read the same claim out of the same tokens and a disagreement between them is a
/// caller who is refused by one service and served by the other. That the two implementations
/// actually agree is asserted where both are on the compile path --
/// <c>ClimateProject.IntegrationTests.Tracking.CrossServiceTokenTests</c>; this file is what
/// says what THIS side means, for anyone reading it without the other solution open.
/// </remarks>
public class DeactivatedAccountClaimTests
{
    private static ClaimsPrincipal PrincipalWith(string? isActiveClaim)
    {
        var claims = new List<Claim> { new("sub", "PER-0231") };
        if (isActiveClaim is not null)
        {
            claims.Add(new Claim("isActive", isActiveClaim));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "Test"));
    }

    [Fact]
    public void A_token_saying_false_is_deactivated()
    {
        // The exact string climate-project-api's JwtTokenService writes for IsActive: false.
        Assert.True(PrincipalWith("false").HasDeactivatedAccountClaim());
    }

    [Theory]
    [InlineData("true")]
    [InlineData("True")]
    [InlineData("TRUE")]
    public void A_token_saying_true_is_not_in_any_casing_bool_TryParse_accepts(string claim)
    {
        // A .NET issuer setting a bool claim emits "True"; refusing that would lock out a
        // caller for a difference in capitalisation.
        Assert.False(PrincipalWith(claim).HasDeactivatedAccountClaim());
    }

    [Fact]
    public void A_token_minted_before_the_claim_existed_is_treated_as_active()
    {
        // Not !GetCurrentUser().IsActive, which is false for an absent claim and would refuse
        // every token from an issuer that never wrote it.
        Assert.False(PrincipalWith(null).HasDeactivatedAccountClaim());
        Assert.False(PrincipalWith(null).GetCurrentUser().IsActive);
    }

    [Theory]
    [InlineData("yes")]
    [InlineData("")]
    public void A_claim_that_is_present_but_unparseable_is_refused_rather_than_trusted(string claim)
    {
        Assert.True(PrincipalWith(claim).HasDeactivatedAccountClaim());
    }

    [Fact]
    public void A_deactivated_claim_is_the_only_thing_it_reads()
    {
        // Guards the one confusion this predicate invites: it says nothing about whether the
        // session behind the token is still live. A token whose securityStamp climate-project
        // has rotated -- i.e. one that service now refuses -- is not "deactivated" here, and
        // this predicate is not the place to make it so. See
        // docs/decisions/cross-service-session-revocation.md.
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", "PER-0231"), new Claim("isActive", "true"), new Claim("securityStamp", Guid.NewGuid().ToString())],
            authenticationType: "Test"));

        Assert.False(principal.HasDeactivatedAccountClaim());
    }
}
