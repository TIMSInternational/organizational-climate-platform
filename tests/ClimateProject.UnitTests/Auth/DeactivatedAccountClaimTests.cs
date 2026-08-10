using System.Security.Claims;
using ClimateProject.Application.Auth;

namespace ClimateProject.UnitTests.Auth;

/// <summary>
/// The predicate behind the API's server-side deactivation check (#280).
/// </summary>
public class DeactivatedAccountClaimTests
{
    private static ClaimsPrincipal PrincipalWith(string? isActiveClaim)
    {
        var claims = new List<Claim> { new("sub", "user-1") };
        if (isActiveClaim is not null)
        {
            claims.Add(new Claim("isActive", isActiveClaim));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationType: "Test"));
    }

    [Fact]
    public void A_token_saying_false_is_deactivated()
    {
        // The exact string JwtTokenService writes for IsActive: false.
        Assert.True(PrincipalWith("false").HasDeactivatedAccountClaim());
    }

    [Fact]
    public void A_token_saying_true_is_not()
    {
        Assert.False(PrincipalWith("true").HasDeactivatedAccountClaim());
    }

    [Theory]
    [InlineData("True")]
    [InlineData("TRUE")]
    public void The_claim_is_read_case_insensitively_so_another_issuer_is_not_locked_out(string claim)
    {
        // bool.TryParse accepts these; a .NET issuer setting a bool claim emits "True".
        Assert.False(PrincipalWith(claim).HasDeactivatedAccountClaim());
    }

    [Fact]
    public void A_token_minted_before_the_claim_existed_is_treated_as_active()
    {
        // Not !GetCurrentUser().IsActive, which is false for an absent claim and would lock
        // out every such session. Same rule web/src/app/RequireAuth.tsx spells out.
        Assert.False(PrincipalWith(null).HasDeactivatedAccountClaim());
        Assert.False(PrincipalWith(null).GetCurrentUser().IsActive);
    }

    [Fact]
    public void A_claim_that_is_present_but_unparseable_is_refused_rather_than_trusted()
    {
        Assert.True(PrincipalWith("yes").HasDeactivatedAccountClaim());
        Assert.True(PrincipalWith(string.Empty).HasDeactivatedAccountClaim());
    }
}
