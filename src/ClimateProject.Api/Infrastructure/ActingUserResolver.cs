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
///
/// As of #285 nothing in <c>src/</c> assigns <c>PersonaExternalId</c> — every reference to it
/// is a read — so the collision is latent rather than live, and #154's ETL is what makes it
/// reachable. That is why this is fixed ahead of the ETL rather than after it.
///
/// ## Cost: two round trips where an Id-first resolver short-circuited on one
///
/// The <c>PersonaExternalId</c> SELECT always runs first, so a caller whose
/// <c>PersonaExternalId</c> is null — today every account this API creates, since nothing in
/// <c>src/</c> writes the column — pays a second query for the <c>Id</c> lookup. The
/// resolvers this replaced answered that caller from one, by short-circuiting on the <c>Id</c>
/// match: <c>NotificationEndpoints</c> returned on <c>AnyAsync(u =&gt; u.Id == userId)</c> and
/// never reached its <c>PersonaExternalId</c> query at all, so for that caller its four
/// self-service routes each cost one round trip more than they did before #285.
///
/// That short-circuit is not restorable. Short-circuiting on <c>Id</c> *is* the Id-first
/// order, and the order is the defect: any form that can answer from the <c>Id</c> lookup
/// before consulting <c>PersonaExternalId</c> resolves a colliding caller to the wrong row,
/// however cheaply. Both are single-row lookups on indexed columns — the primary key, and
/// the filtered unique index on <c>persona_external_id</c> — on requests that have already
/// paid for JWT validation, so the deterministic answer is worth the round trip. What was
/// avoidable was the other half of the regression: the resolvers this replaced projected to
/// a bare <c>Guid?</c> and this materialised a tracked <c>User</c>. See
/// <see cref="ResolveIdAsync"/>, which reads through <c>AsNoTracking</c>.
///
/// One shared implementation, not a copy per endpoint file. #285 names six call sites: the
/// five Id-first resolvers (<c>ReportEndpoints</c>, <c>BenchmarkEndpoints</c>,
/// <c>NotificationEndpoints</c>, <c>NotificationTemplateEndpoints</c>,
/// <c>DemographicSnapshotEndpoints</c>) and <c>AuthEndpoints.RefreshAsync</c>, which had no
/// order at all — one unordered <c>OR</c>. <c>ProfileEndpoints</c> is not among the six;
/// #136 had already made it the one correct implementation, and this class is that
/// implementation lifted out of it and pointed at by all seven. "Make it consistent" was
/// itself a route back into the bug, because the majority spelling was the wrong one.
///
/// Not every resolver in <c>Endpoints/</c> is on this yet. As of #285:
/// <list type="bullet">
/// <item><description><c>AIInsightEndpoints.ResolveCurrentUserIdAsync</c> — Id first, then
/// <c>PersonaExternalId</c>, and nothing else. The only one of the five that could move onto
/// this class unchanged.</description></item>
/// <item><description><c>SurveyEndpoints.ResolveActingUserIdAsync</c>,
/// <c>SurveyResponseEndpoints.ResolveActingUserAsync</c> and
/// <c>SurveyDistributionEndpoints.ResolveActingUserIdAsync</c> — Id, then
/// <c>PersonaExternalId</c>, then <b>email</b>. All three carry that third rule, which this
/// class does not implement, so none of them is a drop-in: swapping them onto
/// <see cref="ResolveAsync"/> as-is drops the email fallback and changes who resolves for a
/// caller whose <c>sub</c> matches nothing.</description></item>
/// <item><description><c>InvitationEndpoints.ResolveActingUserIdAsync</c> — email only, and
/// deliberately so; its own comment explains that <c>user_invitations.invited_by</c> is a FK
/// to <c>users.id</c> rather than the <c>sub</c> claim. Out of scope by design, not by
/// omission.</description></item>
/// </list>
/// The four Id-first ones were out of #285's scope and want their own collision tests before
/// they move.
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
    public static Task<User?> ResolveAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => ResolveAsync(currentUser, db.Users, cancellationToken);

    /// <summary>
    /// The acting user's row id, or null when the <c>sub</c> matches nothing.
    /// </summary>
    /// <remarks>
    /// Reads through <c>AsNoTracking</c>. This overload hands back a Guid and never the
    /// entity, so nothing downstream can edit the row it loaded, and a tracked <c>User</c>
    /// no caller can reach is snapshot cost for nothing. It is also the avoidable half of
    /// the regression described on the class: the resolvers #285 replaced projected to a
    /// bare <c>Guid?</c>. The one caller that does go on to write the acting user's own row,
    /// <c>NotificationEndpoints.UpdatePreferencesAsync</c>, re-loads it tracked for itself —
    /// exactly as it had to before #285, when the resolver it called returned a Guid too.
    ///
    /// The entity-returning <see cref="ResolveAsync"/> stays tracked, because
    /// <c>ProfileEndpoints</c> edits the row it gets back — rename and password change both
    /// assign to it and then call <c>SaveChangesAsync</c>.
    ///
    /// It shares the ordering rather than repeating it — one ordering, in one place, is the
    /// entire point of this class, so only the source query differs, never the two steps.
    /// </remarks>
    public static async Task<Guid?> ResolveIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
        => (await ResolveAsync(currentUser, db.Users.AsNoTracking(), cancellationToken))?.Id;

    /// <summary>
    /// The acting user's current <c>SecurityStamp</c>, or null when the <c>sub</c> matches
    /// nothing. One round trip, not two — this one runs on every authenticated request.
    /// </summary>
    /// <remarks>
    /// This is the read half of #284's revocation check, and it is the only caller in this
    /// class that is on the hot path: the JWT bearer handler runs it for every request that
    /// presents a token carrying a <c>securityStamp</c> claim, where
    /// <see cref="ResolveAsync(CurrentUser, ClimateProjectDbContext, CancellationToken)"/>'s
    /// two sequential SELECTs would be two round trips added to every one of them.
    ///
    /// So it fetches both candidate rows in a single statement and applies the ordering in
    /// memory. The result is the same row the two-step resolver returns, for every
    /// <c>sub</c>, including a colliding one — <c>SecurityStampMatchesActingUserResolverTests</c>
    /// asserts that against a seeded collision rather than leaving it as a claim here. What
    /// it must not become is an <c>OR</c> whose ordering is left to the database: the
    /// <c>WHERE</c> here is unordered on purpose *because* nothing downstream of it reads
    /// row order — the <c>PersonaExternalId</c>-first rule is re-applied below, in C#, on a
    /// list that holds at most two rows (<c>persona_external_id</c> is uniquely indexed and
    /// <c>id</c> is the primary key).
    ///
    /// Takes the raw <c>sub</c> string rather than a <see cref="CurrentUser"/>: the caller is
    /// authentication, which runs before anything has decided the token is well-formed
    /// enough to project, and <c>ClaimsPrincipalExtensions.GetCurrentUser</c> throws on a
    /// token with no <c>sub</c> claim.
    /// </remarks>
    public static async Task<Guid?> ResolveSecurityStampAsync(
        string sub,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        Guid? id = Guid.TryParse(sub, out var parsed) ? parsed : null;

        var candidates = await db.Users
            .AsNoTracking()
            .Where(u => u.PersonaExternalId == sub || (id != null && u.Id == id))
            .Select(u => new { u.PersonaExternalId, u.SecurityStamp })
            .ToListAsync(cancellationToken);

        var match = candidates.FirstOrDefault(c => c.PersonaExternalId == sub)
            ?? candidates.FirstOrDefault();

        return match?.SecurityStamp;
    }

    /// <summary>
    /// The one ordering. <c>PersonaExternalId</c>, then — only for a <c>sub</c> that matches
    /// no <c>PersonaExternalId</c>, and only when it parses — <c>Id</c>.
    /// </summary>
    private static async Task<User?> ResolveAsync(
        CurrentUser currentUser,
        IQueryable<User> users,
        CancellationToken cancellationToken)
    {
        var byExternalId = await users.FirstOrDefaultAsync(
            u => u.PersonaExternalId == currentUser.Sub,
            cancellationToken);
        if (byExternalId is not null)
        {
            return byExternalId;
        }

        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            return await users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        }

        return null;
    }
}
