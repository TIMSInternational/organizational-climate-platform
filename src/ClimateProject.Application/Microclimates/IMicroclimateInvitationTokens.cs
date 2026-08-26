namespace ClimateProject.Application.Microclimates;

/// <summary>
/// Resolves a <c>microclimate_invitations</c> row's bearer token at the moment it is needed,
/// from the row's id.
///
/// <para>
/// <b>Why this exists at all.</b> The queued notification carries the invitation's id and
/// deliberately not its token
/// (<see cref="ClimateProject.Application.Notifications.MicroclimateNotificationData"/>), so
/// somebody has to make the trip to the database between "a row said mail this person" and
/// "here is the URL that opens their pulse". That somebody is the sender, and this is the one
/// thing the sender needs a database for.
/// </para>
/// <para>
/// <b>Why it is a second interface rather than a second method on
/// <c>ISurveyInvitationTokens</c>.</b> Because they read different tables, and the whole
/// class of bug this slice was warned about is a microclimate id used where a survey id was
/// meant. A single interface with two methods invites a caller to pick the wrong one and get
/// a plausible-looking null; two interfaces make the sender name the table it means, at the
/// constructor, where the compiler is watching.
/// </para>
/// </summary>
public interface IMicroclimateInvitationTokens
{
    /// <summary>
    /// The token for <paramref name="invitationId"/>, or <c>null</c> when there is no live
    /// one this recipient is entitled to.
    ///
    /// <para>
    /// <b>The scope arguments are the security boundary, not bookkeeping.</b> The invitation
    /// id reaching this method comes out of <c>notifications.data</c>, and
    /// <c>POST /notifications</c> writes that column from the request body verbatim. A
    /// CompanyAdmin may therefore choose <i>which invitation id</i> is looked up. Keyed on the
    /// id alone, that is a working exfiltration primitive: post a
    /// <c>microclimate_invitation</c> notification to your own user, in your own company,
    /// naming <i>another employee's</i> -- or another tenant's -- invitation id, and the
    /// sender resolves that victim's live token and mails it to you. The survey side had
    /// exactly this hole and closed it by scoping the lookup; this one does not get to
    /// rediscover it.
    /// </para>
    /// <para>
    /// <b>What a stolen token actually buys, stated precisely.</b> Not impersonation. It reads
    /// the microclimate's title and description through
    /// <c>GET /microclimate-invitations/{token}</c>, and on a <i>non-anonymous</i>
    /// microclimate it can <c>POST .../completed</c> -- which sets <c>CompletedAt</c>, cannot
    /// be undone because <c>MicroclimateInvitationStatuses.Advances</c> is strictly monotonic,
    /// makes the real invitee's own link report "already answered", and corrupts the
    /// participation rate. On an anonymous microclimate -- the default -- it buys even less,
    /// because everything past <c>opened</c> is suppressed and never written at all.
    /// Answering is a different surface entirely:
    /// <c>MicroclimateEndpoints.SubmitResponseAsync</c> never consults an invitation token, it
    /// keys on the microclimate's own GUID and decides by
    /// <c>RealtimeSettings.AnonymousResponses</c>. So the loss is denial of participation and
    /// falsified tracking, which is serious enough on its own and is what this doc should say.
    /// </para>
    /// <para>
    /// The row must therefore match all three: the id asked for, the
    /// <paramref name="recipientUserId"/> the mail is actually addressed to, and the
    /// <paramref name="companyId"/> the notification belongs to. A token can then only ever be
    /// mailed to the person it was minted for, and only inside its own tenant -- and the
    /// caller's choice of id stops being a choice of victim.
    /// </para>
    /// <para>
    /// Null otherwise, covering four cases the caller must treat identically because from the
    /// recipient's side they are identical: the row is gone, it belongs to somebody else, it
    /// is <c>revoked</c>, or it carries no token. A revoked invitation is a decision an
    /// administrator made about this person, and mailing them a link that greets them with
    /// "this invitation has been revoked" is worse than mailing them no link.
    /// </para>
    /// <para>
    /// <b>Only revocation suppresses the link. Expiry and completion deliberately do not.</b>
    /// An expired or already-completed invitation still resolves, and
    /// <c>GET /microclimate-invitations/{token}</c> answers it with a specific, informative
    /// "this invitation has expired" or "you have already taken part" -- each of which tells
    /// the recipient more than a link-less email does. The three are different facts and this
    /// method keeps them different, exactly as the token route does.
    /// </para>
    /// </summary>
    /// <param name="recipientUserId">
    /// The user the mail is being addressed to -- <c>NotificationRecipient.UserId</c>, the row
    /// whose e-mail address is about to receive this.
    /// </param>
    /// <param name="companyId">The notification's tenant, already authorised against the caller by the endpoint.</param>
    Task<string?> LiveTokenAsync(
        Guid invitationId,
        Guid recipientUserId,
        Guid companyId,
        CancellationToken cancellationToken);
}
