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

    /// <summary>
    /// The one survey this session may see, when it was opened with a per-survey credential.
    /// Absent on every other session, which means "every survey you are targeted by".
    /// </summary>
    /// <remarks>
    /// A constant for the same reason the two above are: silent on both sides. Written and
    /// not read means a per-survey respondent sees every survey they are in -- exactly the
    /// shared-account view the mode exists to avoid -- and read but not written means a
    /// refresh drops the scope and widens the session halfway through answering. The only
    /// writer is <c>JwtTokenService</c>; the only reader is <c>CurrentUser</c>.
    /// </remarks>
    public const string SurveyScope = "surveyScope";
}
