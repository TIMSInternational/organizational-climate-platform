using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// The read half of #284: a token stops working the moment the user it was minted for gets a
/// new <c>SecurityStamp</c>.
/// </summary>
/// <remarks>
/// ## What this closes
///
/// Tokens here are stateless HS256 with a 24-hour lifetime, so before this ran, changing a
/// password ended no session at all: the new hash stopped a future *login*, and every token
/// already in somebody's hands — including an attacker's — kept working until it expired.
/// Somebody changing their password because they believe they are compromised is the exact
/// case the feature exists for, and it was the case it did not serve.
///
/// ## Why a stamp rather than a denylist or a refresh table
///
/// A denylist has to be keyed on something a token carries. This API mints no <c>jti</c>, so
/// adding one means storing a row per issued token and keeping it until that token expires —
/// a write on every login, to serve a revocation that happens almost never. And "end all of
/// this user's sessions" cannot be expressed against tokens you never enumerated, so a
/// denylist ends up carrying a per-user cutoff row anyway: a security stamp, reached through
/// a table with worse write behaviour.
///
/// A server-side refresh/session table (the issue's option 2) is the richer answer and the
/// one a per-device "active sessions" list on <c>/profile</c> would need. It is also a change
/// to how every client holds credentials — short-lived access tokens, a refresh cycle, a
/// token store — which is a much larger change than the hole justifies on its own. When that
/// surface is built, this column stays useful: it is what "sign out everywhere" would rotate.
///
/// An <c>iat</c>-versus-<c>password_changed_at</c> comparison (option 3) needs the same
/// per-request user read this does and adds a clock. <c>iat</c> is minted in whole seconds,
/// so a token issued in the same second as the change is genuinely ambiguous: reject it and
/// a user is bounced by their own successful save, accept it and a token stolen during that
/// second survives. Equality against an opaque value has no such edge, and it generalises —
/// a stamp can be rotated for any reason, where a password timestamp only ever means
/// "password".
///
/// ## What it costs, plainly
///
/// One extra database round trip on every authenticated request that presents a token
/// carrying the claim. That is a real cost and it is not hidden behind a cache: a cache with
/// a TTL is a window in which a revoked token still works, and the window is the bug. See
/// <see cref="ActingUserResolver.ResolveSecurityStampAsync"/> for why it is one round trip
/// and not the two the general-purpose resolver needs.
///
/// ## A token with no stamp claim is let through, and that is a deliberate limit
///
/// <c>TrackingJwtSecret</c> is shared with the legacy climate-tracking application, which
/// mints its own tokens against it and knows nothing about this column; the same reasoning
/// #280 applied to the <c>isActive</c> claim applies here. Tokens this API issued before the
/// column existed have no claim either, and they keep working until they expire — at most 24
/// hours after deployment, once.
///
/// This does not weaken the property the issue asks for. The threat is a token minted by
/// *this* API and held by somebody who should no longer have it, and every such token carries
/// the claim. Stripping it would mean re-signing, which needs the signing secret; an attacker
/// holding that has no need of a stolen session in the first place.
///
/// ## Failing closed on an unresolvable subject
///
/// A token that carries a stamp claim was minted by this API for a row that existed. If that
/// <c>sub</c> now resolves to nothing the row is gone, and there is no stamp to agree with,
/// so the token is refused rather than waved through. That is a change of behaviour for a
/// deleted user with a live token, and the intended one — pinned by
/// <c>SecurityStampRevocationTests.A_token_whose_subject_no_longer_exists_is_refused</c>,
/// which is the only fact in that suite presenting a <c>sub</c> that resolves to nothing, and
/// so the only one that can tell this apart from a fail-open comparison.
/// </remarks>
public static class SecurityStampValidation
{
    /// <summary>
    /// Rejection text. One message for both refusals (stamp mismatch, and a <c>sub</c> that
    /// resolves to no row) so the header cannot be used to tell those two states apart. No
    /// human reads it in this product: it reaches only the <c>WWW-Authenticate</c> header's
    /// <c>error_description</c>, and the web client's <c>authFetch</c> discards the response
    /// on any 401, clears the token and redirects to <c>/login</c>
    /// (<c>web/src/api/authFetch.ts</c>). It is worded for whoever reads the raw response —
    /// an API client, or a developer with the header in front of them.
    /// </summary>
    internal const string RejectionMessage = "This session has been signed out. Sign in again.";

    /// <summary>
    /// Hooked up as <c>JwtBearerEvents.OnTokenValidated</c> in <c>Program.cs</c>. It runs
    /// during authentication, before authorization — so it covers <c>POST /auth/refresh</c>
    /// too, which would otherwise trade a revoked token for a fresh one and undo the whole
    /// mechanism.
    /// </summary>
    public static async Task ValidateAsync(TokenValidatedContext context)
    {
        var presentedClaim = context.Principal?.FindFirst(TokenClaimNames.SecurityStamp)?.Value;
        if (presentedClaim is null)
        {
            return;
        }

        if (!Guid.TryParse(presentedClaim, out var presented))
        {
            context.Fail(RejectionMessage);
            return;
        }

        var sub = context.Principal?.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            context.Fail(RejectionMessage);
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<ClimateProjectDbContext>();
        var current = await ActingUserResolver.ResolveSecurityStampAsync(
            sub, db, context.HttpContext.RequestAborted);

        if (current != presented)
        {
            context.Fail(RejectionMessage);
        }
    }
}
