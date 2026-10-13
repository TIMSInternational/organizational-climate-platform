namespace ClimateProject.Application.Auth;

/// <summary>
/// Claim names this API both writes and reads.
/// </summary>
/// <remarks>
/// Only <see cref="SecurityStamp"/> is here, and the asymmetry is deliberate rather than an
/// unfinished cleanup. The other claims — <c>sub</c>, <c>role</c>, <c>email</c>, <c>name</c>,
/// <c>companyId</c>, <c>nodoId</c>, <c>isActive</c> — are spelled as literals in
/// <c>JwtTokenService</c> and <c>ClaimsPrincipalExtensions</c> because their names are a wire
/// contract shared with the legacy climate-tracking application; a constant would not make
/// them any safer to change, since changing them at all is what breaks. <c>securityStamp</c>
/// is different: a typo on either side does not fail loudly. Written but not read means no
/// token is ever revoked, and read but not written means the claim is simply absent, which
/// the API's <c>SecurityStampValidation</c> treats as "issued by someone else" and lets
/// through. Both failures are silent and both are the whole of #284, so the two sides share
/// one symbol.
/// </remarks>
public static class TokenClaimNames
{
    public const string SecurityStamp = "securityStamp";

    /// <summary>
    /// Unix seconds of first sign-in, carried forward unchanged by every re-mint.
    /// </summary>
    /// <remarks>
    /// Here for the same reason as <see cref="SecurityStamp"/>: a typo on either side fails
    /// silently. Written but not read means the absolute ceiling is never enforced and a
    /// session slides forever; read but not written means every refresh restarts the
    /// ceiling, which is the same hole with a different cause. <see cref="SessionWindows"/>
    /// writes it through <c>JwtTokenService</c> and reads it back in
    /// <see cref="SessionWindows.StartedAt"/>, and those two are the only sides.
    /// </remarks>
    public const string SessionStart = "sessionStart";
}
