namespace ClimateProject.Application.Surveys;

/// <summary>
/// Resolves a <c>survey_invitations</c> row's bearer token at the moment it is needed, from
/// the row's id.
///
/// <para>
/// <b>Why this exists at all.</b> The queued notification carries the invitation's id and
/// deliberately not its token (<see cref="ClimateProject.Application.Notifications.SurveyNotificationData"/>),
/// so somebody has to make the trip to the database between "a row said mail this person"
/// and "here is the URL that opens their survey". That somebody is the sender, and this is
/// the one thing the sender needs a database for.
/// </para>
/// <para>
/// <b>Why it is an interface rather than a <c>DbContext</c> in the sender's constructor.</b>
/// Two reasons, both load-bearing. It keeps <c>EmailNotificationSender</c> -- the class that
/// decides what a recipient actually reads -- provable without a container: the whole of its
/// link behaviour, including the "look nothing up" case, is asserted in the unit suite
/// against a counting fake. And it keeps the seam narrow: a sender holding a
/// <c>ClimateProjectDbContext</c> can read and write every table in the product, which is
/// more authority than composing an email should carry.
/// </para>
/// </summary>
public interface ISurveyInvitationTokens
{
    /// <summary>
    /// The token for <paramref name="invitationId"/>, or <c>null</c> when there is no live
    /// one to hand out.
    ///
    /// <para>
    /// Null covers three cases and the caller must treat them identically, because from the
    /// recipient's side they are: the row is gone, the row is <c>revoked</c>, or the row
    /// carries no token at all. A revoked invitation is a decision an administrator made
    /// about this person, and mailing them a link that greets them with "this invitation has
    /// been revoked" is worse than mailing them no link.
    /// </para>
    /// <para>
    /// Expiry is deliberately <b>not</b> consulted. An expired token still resolves, and
    /// <c>GET /survey-invitations/{token}</c> answers it with a specific, informative
    /// "this invitation has expired" -- which tells the recipient more than a link-less
    /// email does. Revocation and expiry are different facts and this method treats them as
    /// different facts, exactly as the token route does.
    /// </para>
    /// </summary>
    Task<string?> LiveTokenAsync(Guid invitationId, CancellationToken cancellationToken);
}
