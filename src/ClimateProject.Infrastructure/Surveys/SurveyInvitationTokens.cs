using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Surveys;

/// <summary>
/// <see cref="ISurveyInvitationTokens"/> against <c>survey_invitations</c>.
///
/// <para>
/// One projected, no-tracking read of two columns, keyed by primary key. No entity is
/// materialised and nothing is attached to the change tracker: this runs inside the
/// notification dispatch sweep, once per mail, and a tracked <c>SurveyInvitation</c> per
/// send is a graph that grows for the length of a batch and buys nothing -- the sender never
/// writes.
/// </para>
/// <para>
/// <b>Every predicate is in the <c>WHERE</c>, and that is load-bearing rather than tidy.</b>
/// Ownership, tenancy and revocation are all filters, so a token belonging to anybody but this
/// recipient is never read out of the database into this process at all -- there is no moment
/// at which it exists in memory and a later <c>if</c> is what stands between it and an
/// envelope. The token is a bearer credential; the less far it travels, the fewer places it
/// can leak from.
/// </para>
/// <para>
/// See <see cref="ISurveyInvitationTokens.LiveTokenAsync"/> for why the ownership and tenancy
/// predicates exist: the invitation id is caller-controlled, so without them this method is an
/// exfiltration primitive rather than a lookup.
/// </para>
/// </summary>
public sealed class SurveyInvitationTokens(ClimateProjectDbContext db) : ISurveyInvitationTokens
{
    public async Task<string?> LiveTokenAsync(
        Guid invitationId,
        Guid recipientUserId,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        var token = await db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.Id == invitationId
                        && i.UserId == recipientUserId
                        && i.CompanyId == companyId
                        && i.Status != SurveyInvitationStatuses.Revoked)
            .Select(i => i.InvitationToken)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        // FirstOrDefaultAsync gives null for "no such row"; a row whose column is somehow
        // blank is the same answer to the only question the caller asked, so it collapses
        // here rather than becoming a second empty-string case every caller must remember.
        return string.IsNullOrWhiteSpace(token) ? null : token;
    }
}
