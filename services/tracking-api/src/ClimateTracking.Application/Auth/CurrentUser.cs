using System.Security.Claims;

namespace ClimateTracking.Application.Auth;

public sealed record CurrentUser(
    string PersonaExternalId,
    string Role,
    string NodoExternalId,
    string Email,
    string Name,
    string CompanyId,
    bool IsActive);

public static class ClaimsPrincipalExtensions
{
    public static CurrentUser GetCurrentUser(this ClaimsPrincipal principal)
    {
        var personaExternalId = principal.FindFirst("sub")?.Value
            ?? throw new InvalidOperationException("Token is missing the required 'sub' claim.");

        return new CurrentUser(
            PersonaExternalId: personaExternalId,
            Role: principal.FindFirst("role")?.Value ?? string.Empty,
            NodoExternalId: principal.FindFirst("nodoId")?.Value ?? string.Empty,
            Email: principal.FindFirst("email")?.Value ?? string.Empty,
            Name: principal.FindFirst("name")?.Value ?? string.Empty,
            CompanyId: principal.FindFirst("companyId")?.Value ?? string.Empty,
            IsActive: bool.TryParse(principal.FindFirst("isActive")?.Value, out var isActive) && isActive);
    }

    /// <summary>
    /// True when the token itself says the account is deactivated.
    /// </summary>
    /// <remarks>
    /// A deliberate mirror of climate-project-api's
    /// <c>ClimateProject.Application.Auth.ClaimsPrincipalExtensions.HasDeactivatedAccountClaim</c>
    /// (#280), because both services validate the same tokens off the same shared secret and
    /// disagreeing about what one of its claims means is the failure mode of this whole seam
    /// (#153). <c>CrossServiceTokenTests.The_two_services_read_the_isActive_claim_identically</c>
    /// compiles against both copies and compares them on every value that reaches either; that
    /// test is why there are two copies rather than one, since no assembly under <c>src/</c> on
    /// either side may reference the other.
    ///
    /// Deliberately not <c>!GetCurrentUser().IsActive</c>: that property is <c>false</c> for a
    /// token minted before the claim existed, and refusing those would lock out every session
    /// held by a caller of an issuer that never wrote it. A missing claim means "unknown", and
    /// unknown is treated as active. A claim that is present but does not parse as <c>true</c>
    /// is treated as deactivated: climate-project-api's <c>JwtTokenService</c> writes it only
    /// as "true" or "false", so a value outside that set means something is wrong.
    ///
    /// <b>This is not revocation and must not be described as such.</b> The claim carries the
    /// account's state at MINT time, so a token minted while the account was active says
    /// "true" for as long as it lives, however deactivated the account becomes afterwards.
    /// What ends those sessions is climate-project-api's <c>SecurityStamp</c> rotation, which
    /// this service cannot check — see <c>docs/decisions/cross-service-session-revocation.md</c>.
    /// </remarks>
    public static bool HasDeactivatedAccountClaim(this ClaimsPrincipal principal)
    {
        var claim = principal.FindFirst("isActive")?.Value;
        return claim is not null && !(bool.TryParse(claim, out var isActive) && isActive);
    }
}
