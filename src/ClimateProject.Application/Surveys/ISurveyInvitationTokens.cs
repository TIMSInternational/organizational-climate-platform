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
    /// one this recipient is entitled to.
    ///
    /// <para>
    /// <b>The scope arguments are the security boundary, not bookkeeping.</b> The invitation
    /// id reaching this method comes out of <c>notifications.data</c>, and
    /// <c>POST /notifications</c> writes that column from the request body verbatim. A
    /// CompanyAdmin may therefore choose <i>which invitation id</i> is looked up. Keyed on the
    /// id alone, that is a working exfiltration primitive: post a <c>survey_invitation</c> to
    /// your own user, in your own company, naming <i>another employee's</i> -- or another
    /// <i>tenant's</i> -- invitation id, and the sender resolves that victim's live token and
    /// mails it to you. You then open their survey as them.
    /// </para>
    /// <para>
    /// That is precisely the capability the producer-side design removed when it kept tokens
    /// out of <c>data</c>, so re-admitting it through the lookup key would have undone the
    /// whole point. The row must therefore match all three: the id asked for, the
    /// <paramref name="recipientUserId"/> the mail is actually addressed to, and the
    /// <paramref name="companyId"/> the notification belongs to. A token can then only ever be
    /// mailed to the person it was minted for, and only inside its own tenant -- and the
    /// caller's choice of id stops being a choice of victim.
    /// </para>
    /// <para>
    /// Null otherwise, covering four cases the caller must treat identically because from the
    /// recipient's side they are identical: the row is gone, it belongs to somebody else, it is
    /// <c>revoked</c>, or it carries no token. A revoked invitation is a decision an
    /// administrator made about this person, and mailing them a link that greets them with
    /// "this invitation has been revoked" is worse than mailing them no link.
    /// </para>
    /// <para>
    /// Expiry is deliberately <b>not</b> consulted. An expired token still resolves, and
    /// <c>GET /survey-invitations/{token}</c> answers it with a specific, informative
    /// "this invitation has expired" -- which tells the recipient more than a link-less
    /// email does. Revocation and expiry are different facts and this method treats them as
    /// different facts, exactly as the token route does.
    /// </para>
    /// </summary>
    /// <param name="recipientUserId">
    /// The user the mail is being addressed to -- taken from the resolved
    /// <c>NotificationRecipient</c>, i.e. the row whose e-mail address is about to receive
    /// this. Deliberately that rather than <c>Notification.UserId</c>: the binding that matters
    /// is between the token and the mailbox it lands in.
    /// </param>
    /// <param name="companyId">The notification's tenant, already authorised against the caller by the endpoint.</param>
    Task<string?> LiveTokenAsync(
        Guid invitationId,
        Guid recipientUserId,
        Guid companyId,
        CancellationToken cancellationToken);
}
