using System.Security.Claims;

namespace ClimateProject.Application.Auth;

public sealed record CurrentUser(
    string Sub,
    string Role,
    string? NodoId,
    string Email,
    string Name,
    string CompanyId,
    bool IsActive);

public static class ClaimsPrincipalExtensions
{
    public static CurrentUser GetCurrentUser(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirst("sub")?.Value
            ?? throw new InvalidOperationException("Token is missing the required 'sub' claim.");

        var nodoId = principal.FindFirst("nodoId")?.Value;

        return new CurrentUser(
            Sub: sub,
            Role: principal.FindFirst("role")?.Value ?? string.Empty,
            NodoId: string.IsNullOrEmpty(nodoId) ? null : nodoId,
            Email: principal.FindFirst("email")?.Value ?? string.Empty,
            Name: principal.FindFirst("name")?.Value ?? string.Empty,
            CompanyId: principal.FindFirst("companyId")?.Value ?? string.Empty,
            IsActive: bool.TryParse(principal.FindFirst("isActive")?.Value, out var isActive) && isActive);
    }

    /// <summary>
    /// True when the token itself says the account is deactivated.
    /// </summary>
    /// <remarks>
    /// Deliberately not <c>!GetCurrentUser().IsActive</c>: that property is <c>false</c> for
    /// a token minted before the claim existed, which would lock out every such session.
    /// A missing claim means "unknown", and unknown is treated as active — exactly the rule
    /// <c>web/src/app/RequireAuth.tsx</c> spells out for the same claim. A claim that is
    /// present but does not parse as <c>true</c> is treated as deactivated: only
    /// <c>JwtTokenService</c> writes it, always as "true" or "false", so a value outside that
    /// set means something is wrong and refusing is the safe answer.
    ///
    /// This is the server-side half of the check (#280). Until it existed the sole enforcement
    /// anywhere was that client-side redirect, which is a UI convenience and no obstacle at all
    /// to anyone calling the API directly.
    /// </remarks>
    public static bool HasDeactivatedAccountClaim(this ClaimsPrincipal principal)
    {
        var claim = principal.FindFirst("isActive")?.Value;
        return claim is not null && !(bool.TryParse(claim, out var isActive) && isActive);
    }
}
