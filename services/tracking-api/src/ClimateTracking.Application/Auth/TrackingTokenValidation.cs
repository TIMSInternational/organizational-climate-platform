using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace ClimateTracking.Application.Auth;

/// <summary>
/// Everything this service requires of an inbound bearer token, in one place because it is
/// only half of a contract. climate-project-api mints the tokens this service accepts, the
/// two are separate solutions with separate deployments, and the only thing they share is the
/// symmetric <c>TrackingJwtSecret</c> -- there is no issuer, no audience and no discovery
/// document to catch a disagreement, so a drift between mint and validation is silent until a
/// real user's request is refused.
/// </summary>
/// <remarks>
/// Lifted out of <c>ClimateTracking.Api/Program.cs</c> (#153) so the other side of the seam
/// can compile against it: <c>ClimateProject.IntegrationTests.Tracking.CrossServiceTokenTests</c>
/// mints a token through the real climate-project-api path and validates it with exactly
/// these values. A test that built an equivalent-looking <see cref="TokenValidationParameters"/>
/// of its own would only prove the test agrees with itself, which is precisely the gap it
/// exists to close -- every other test on both sides hand-builds its own
/// <c>ClaimsPrincipal</c> and so never touches this contract at all.
///
/// Keep this the single definition: <c>Program.cs</c> reads both members below and sets
/// nothing else on the bearer handler.
///
/// <b>What this contract cannot check: revocation.</b> climate-project-api refuses a token
/// whose session has been ended, by comparing a <c>securityStamp</c> claim against the user
/// row it was minted from on every request (#284). That row is in the other service's
/// database. This service has no access to it, so a token whose session was ended over there
/// -- by a password change, an administrator's credential reset, or a deactivation -- still
/// satisfies everything below until it expires. The window is real, it is bounded by the
/// token's remaining lifetime, and it is written down in
/// <c>docs/decisions/cross-service-session-revocation.md</c> along with what closing it would
/// take. Do not describe this type, or the handler it configures, as validating a session.
/// </remarks>
public static class TrackingTokenValidation
{
    /// <summary>
    /// The claim <c>ClaimsIdentity.Name</c> resolves to. climate-project-api mints the acting
    /// persona's external id into <c>sub</c>.
    /// </summary>
    public const string NameClaimType = "sub";

    /// <summary>
    /// False, and load-bearing. The handler's default (true) rewrites the well-known short
    /// claim names on the way in -- <c>sub</c> to the NameIdentifier URI, <c>role</c> to the
    /// Role URI -- before <see cref="ClaimsPrincipalExtensions.GetCurrentUser"/> looks them up
    /// under the raw names climate-project-api actually mints. Nothing would throw: a leader
    /// would simply arrive role-less and nodo-less, and every scoping decision downstream
    /// would be made on empty strings.
    /// </summary>
    public const bool MapInboundClaims = false;

    /// <summary>
    /// The signature and lifetime half of the contract. Tenant scoping is authorization, not
    /// authentication, and lives in <see cref="MatchingTenantRequirement"/>.
    /// </summary>
    public static TokenValidationParameters CreateParameters(string trackingJwtSecret) => new()
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(trackingJwtSecret)),

        // climate-project-api's JwtTokenService mints neither an `iss` nor an `aud`, so both
        // checks are off: turning either on rejects every token the other service issues.
        // The shared secret is what proves provenance instead.
        ValidateIssuer = false,
        ValidateAudience = false,

        ValidateLifetime = true,
        NameClaimType = NameClaimType,
    };
}
