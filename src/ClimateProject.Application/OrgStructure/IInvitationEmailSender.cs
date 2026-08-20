using ClimateProject.Application.Email;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Invitation delivery.
///
/// ## Why this returns an outcome now
///
/// It used to return a bare <c>Task</c>, and <c>EmailInvitationEmailSender</c>'s own doc
/// named the consequence: it had "no vocabulary for 'the provider refused this address'".
/// So the endpoints could not know whether a send had worked, and they wrote
/// <c>Status = sent</c> with a <c>SentAt</c> before calling this at all. A failed send left a
/// row claiming delivery, and the admin invitation list rendered it as "Sent" / "Enviada".
///
/// That comment also judged the fix to be "a schema change and therefore a separate issue".
/// It is not: <c>InvitationValidation.StatusPending</c> already exists, is already what a
/// freshly created invitation is, and the users screen already renders it as "Pending". The
/// honest state after a failed send is the state the row was already in — so recording it
/// needs no new status, no new column and no migration. What it needed was for this method
/// to say what happened.
///
/// <see cref="EmailSendOutcome"/> rather than a new parallel type, because the transport
/// already returns exactly that and notification delivery already maps onto it. One
/// vocabulary for "did the mail go" across both surfaces.
/// </summary>
public interface IInvitationEmailSender
{
    /// <returns>
    /// What the attempt did. A caller must not record an invitation as sent unless
    /// <see cref="EmailSendOutcome.Delivered"/> is true — that is the whole point of the
    /// return value.
    /// </returns>
    Task<EmailSendOutcome> SendAsync(UserInvitation invitation, CancellationToken cancellationToken);
}
