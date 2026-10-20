namespace ClimateProject.Application.Auth;

/// <param name="SecurityStamp">
/// The issuing user's <c>User.SecurityStamp</c> at mint time (#284).
///
/// A positional member with no default, on purpose: it makes supplying the stamp a
/// compile-time obligation of every caller that builds a <see cref="TokenClaims"/>. A
/// defaulted or omitted stamp would mint a token that either never revokes (missing claim)
/// or never validates (a value belonging to no user), and neither failure shows up until
/// somebody's session is on the line.
/// </param>
public sealed record TokenClaims(
    string Sub,
    string Role,
    string? NodoId,
    string Email,
    string Name,
    string CompanyId,
    bool IsActive,
    Guid SecurityStamp,
    /// <param name="SurveyScope">
    /// The single survey this session may see, set only when sign-in resolved a
    /// <c>SurveyCredential</c>. Null -- the default, and every pre-existing caller -- means
    /// the session sees every survey its holder is targeted by, which is what a shared
    /// account has always meant.
    /// </param>
    Guid? SurveyScope = null);
