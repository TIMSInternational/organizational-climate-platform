using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Microclimates;

/// <summary>
/// Where a microclimate invitation token is addressed, and how one is minted.
///
/// <para>
/// <b>Minting and shape-checking are <see cref="SurveyAccessTokens"/>'s, on purpose.</b>
/// A <c>microclimate_invitations.invitation_token</c> is the same kind of thing as a
/// <c>survey_invitations.invitation_token</c> -- a bearer credential in a URL, on an
/// unauthenticated route -- and it wants the same 256 bits from
/// <c>RandomNumberGenerator</c>. Re-typing five lines of base64url here would create a
/// second token implementation that starts identical and is one careless edit away from
/// being weaker, in the domain that will get less attention. So this class owns the
/// <i>path</i>, which genuinely differs, and delegates the <i>bytes</i>, which must not.
/// The naming is the only cost: <c>SurveyAccessTokens</c> lives under Surveys and is used
/// from here.
/// </para>
/// </summary>
public static class MicroclimateInvitationLinks
{
    /// <summary>
    /// The path prefix a per-invitee microclimate token is addressed under.
    ///
    /// <para>
    /// Site-relative, never absolute: whoever emits one resolves it against the origin they
    /// are configured for (<c>EmailOptions.AppBaseUrl</c>), which is what stops staging mail
    /// from sending a recipient into production.
    /// </para>
    /// <para>
    /// The same literal names three things that must agree: this constant, the API's
    /// <c>/microclimate-invitations/{token}</c> route group in
    /// <c>MicroclimateInvitationEndpoints</c>, and the web app's
    /// <c>/microclimate-invitations/:token</c> route in <c>web/src/app/router.tsx</c>. The
    /// first two are held together by a C# reference; the third is a TypeScript file no
    /// reference can reach, so renaming the web route still breaks a mailed link and no .NET
    /// test will notice. Said plainly rather than implying a guarantee that stops at the
    /// language boundary.
    /// </para>
    /// </summary>
    public const string LinkPrefix = "/microclimate-invitations/";

    /// <summary>A fresh, opaque, cryptographically random token. 43 base64url characters.</summary>
    public static string Mint() => SurveyAccessTokens.Mint();

    /// <summary>
    /// Whether a caller-supplied token even looks like one of ours. A cheap reject for
    /// garbage before a <c>varchar(255)</c> index lookup; never used in place of the real
    /// lookup, and it discloses nothing because the encoding is public.
    /// </summary>
    public static bool HasExpectedShape(string? token) => SurveyAccessTokens.HasExpectedShape(token);

    /// <summary>
    /// Where the holder of <paramref name="token"/> goes to take part -- the destination of
    /// the link a microclimate invitation email carries.
    /// </summary>
    public static string LinkPath(string token) => LinkPrefix + token;
}
