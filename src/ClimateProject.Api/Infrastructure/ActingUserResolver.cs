using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Turns the <c>sub</c> JWT claim back into the row it was minted from (#285).
///
/// <c>sub</c> is minted as <c>PersonaExternalId ?? Id.ToString()</c> — see
/// <see cref="ClimateProject.Api.Endpoints.AuthEndpoints.IssueTokenForAsync"/>, the single
/// place this API mints a token — so a resolver has to try both shapes.
///
/// ## PersonaExternalId is tried FIRST, and the order is load-bearing
///
/// <c>PersonaExternalId</c> is a free-form legacy string of up to 64 characters
/// (<c>UserConfiguration</c>), so nothing stops one from being a Guid in canonical form —
/// and #154's ETL is the feature that will start populating the column from legacy Mongo
/// ids. Its unique index is filtered (<c>WHERE persona_external_id IS NOT NULL</c>), which
/// stops two users sharing one value but does nothing about user A's
/// <c>PersonaExternalId</c> equalling user B's <c>Id</c>.
///
/// The moment that collision exists, an Id-first resolver hands A's token B's row: A's
/// <c>sub</c> was minted from A's own <c>PersonaExternalId</c>, the Id lookup finds B, and
/// every handler downstream acts as B. Note this is a *self-inflicted* misresolution as much
/// as an attack — neither party need be complicit, the ETL alone can create the collision.
///
/// Trying <c>PersonaExternalId</c> first is unambiguous, because that is the order the claim
/// was minted in: if the <c>sub</c> matches any row's <c>PersonaExternalId</c> (uniquely
/// indexed) that row is by construction the one the token was issued for. Only a <c>sub</c>
/// that matches no <c>PersonaExternalId</c> can have been minted from an <c>Id</c>.
///
/// Two sequential queries rather than one <c>Id == userId || PersonaExternalId == sub</c>
/// predicate, on purpose: the order has to live in the C#, because an unordered
/// <c>WHERE ... OR ...</c> cannot express it — under a collision that form returns whichever
/// row Postgres reaches first, which is not stable across plans, statistics or a vacuum.
/// The second query only runs for the overwhelmingly common case where the caller has no
/// <c>PersonaExternalId</c> at all.
///
/// As of #285 nothing in <c>src/</c> assigns <c>PersonaExternalId</c> — every reference to it
/// is a read — so the collision is latent rather than live, and #154's ETL is what makes it
/// reachable. That is why this is fixed ahead of the ETL rather than after it.
///
/// One shared implementation, not a copy per endpoint file. Of the six resolvers #285 names,
/// five had the order backwards and only <c>ProfileEndpoints</c> (fixed by #136) had it
/// right, so "make it consistent" was itself a route back into the bug.
///
/// Not every resolver in <c>Endpoints/</c> is on this yet. As of #285,
/// <c>AIInsightEndpoints</c>, <c>SurveyEndpoints</c>, <c>SurveyResponseEndpoints</c> and
/// <c>SurveyDistributionEndpoints</c> still carry their own Id-first copies; the last two
/// also fall back to email, which is a third rule this class does not implement. They were
/// out of #285's scope and want their own tests before they move.
/// </summary>
public static class ActingUserResolver
{
    /// <summary>
    /// The acting user's row, tracked, or null when the <c>sub</c> matches nothing.
    /// </summary>
    /// <remarks>
    /// Null rather than a default: an unresolvable caller must be refused, never fall through
    /// to "the row whose id is all zeroes" or to "the first user".
    /// </remarks>
    public static async Task<User?> ResolveAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var byExternalId = await db.Users.FirstOrDefaultAsync(
            u => u.PersonaExternalId == currentUser.Sub,
            cancellationToken);
        if (byExternalId is not null)
        {
            return byExternalId;
        }

        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            return await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        }

        return null;
    }

    /// <summary>
    /// The acting user's row id, or null when the <c>sub</c> matches nothing.
    /// </summary>
    /// <remarks>
    /// Delegates to <see cref="ResolveAsync"/> rather than repeating the two-step with a
    /// projection: one ordering, in one place, is the entire point of this class.
    /// </remarks>
    public static async Task<Guid?> ResolveIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => (await ResolveAsync(currentUser, db, cancellationToken))?.Id;
}
