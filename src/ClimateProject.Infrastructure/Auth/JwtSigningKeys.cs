using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.Infrastructure.Auth;

/// <summary>
/// The set of keys an inbound bearer token may be signed with: the current
/// <c>TrackingJwtSecret</c>, and — only while a rotation is in flight — the previous one.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists (#70).</b> <c>TrackingJwtSecret</c> is one string doing three jobs: this
/// API signs with it (<see cref="JwtTokenService"/>), this API validates with it, and
/// climate-tracking validates with it too. Validation accepted exactly one key, so changing the
/// secret invalidated every live session in <b>both</b> products at the same instant — tokens
/// live 24 hours, so the blast radius was every signed-in user, at whatever moment the rotation
/// happened to land. That made an urgent rotation something nobody wanted to perform, which is
/// the worst property a security control can have.
/// </para>
/// <para>
/// Accepting the previous key as well turns it into a rolling change: new tokens are signed with
/// the new secret from the moment it is deployed, tokens already in the wild keep validating
/// until they expire on their own, and nobody is logged out. Signing is deliberately NOT part of
/// this — <see cref="JwtTokenService"/> takes the current secret alone, so the old key can
/// verify but can never mint.
/// </para>
/// <para>
/// <b>The previous key widens what this service accepts, so it is temporary by construction.</b>
/// Leave it configured past the overlap and a rotation has bought nothing: the compromised value
/// still opens the door. One token lifetime is the whole window — see
/// <c>docs/security/rotation-runbook.md</c> §A, which pairs setting it with removing it.
/// </para>
/// <para>
/// climate-tracking keeps its own copy of this rule in
/// <c>TrackingTokenValidation.CreateParameters</c>. They are separate solutions that cannot
/// reference each other, which is exactly why <c>CrossServiceTokenTests</c> mints on this side
/// and validates on that one rather than trusting the two to agree.
/// </para>
/// </remarks>
public static class JwtSigningKeys
{
    /// <summary>
    /// Builds the validation key set. <paramref name="current"/> is required;
    /// <paramref name="previous"/> is admitted only when it is present and actually different.
    /// </summary>
    /// <remarks>
    /// Blank is treated as absent rather than as an error, because that is how an unset
    /// environment variable and an unpopulated <c>appsettings.json</c> entry both arrive — a
    /// deployment that has never rotated must not fail to start. Ordinal comparison, and a
    /// duplicate is dropped: handing the handler the same key twice would make every signature
    /// failure report two identical attempts, which reads as a configuration bug that is not there.
    /// </remarks>
    public static IReadOnlyList<SecurityKey> ForValidation(string current, string? previous)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(current);

        var keys = new List<SecurityKey> { KeyFrom(current) };

        if (!string.IsNullOrWhiteSpace(previous) && !string.Equals(previous, current, StringComparison.Ordinal))
        {
            keys.Add(KeyFrom(previous));
        }

        return keys;
    }

    private static SymmetricSecurityKey KeyFrom(string secret) => new(Encoding.UTF8.GetBytes(secret));
}
