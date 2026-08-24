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
/// The revocation check is a <c>WHERE</c> rather than a filter applied after loading, so a
/// revoked token is never read out of the database into this process at all. The token is a
/// bearer credential; the less far it travels, the fewer places it can be logged from.
/// </para>
/// </summary>
public sealed class SurveyInvitationTokens(ClimateProjectDbContext db) : ISurveyInvitationTokens
{
    public async Task<string?> LiveTokenAsync(Guid invitationId, CancellationToken cancellationToken)
    {
        var token = await db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.Id == invitationId && i.Status != SurveyInvitationStatuses.Revoked)
            .Select(i => i.InvitationToken)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        // FirstOrDefaultAsync gives null for "no such row"; a row whose column is somehow
        // blank is the same answer to the only question the caller asked, so it collapses
        // here rather than becoming a second empty-string case every caller must remember.
        return string.IsNullOrWhiteSpace(token) ? null : token;
    }
}
