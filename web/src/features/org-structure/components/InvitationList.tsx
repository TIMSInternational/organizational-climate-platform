import type { Invitation } from '../api/invitations'

export default function InvitationList({ invitations, onResend }: { invitations: Invitation[]; onResend: (invitation: Invitation) => void }) {
  if (invitations.length === 0) {
    return <p>No invitations yet.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Type</th>
          <th>Role</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((invitation) => (
          <tr key={invitation.id}>
            <td>{invitation.email ?? '(shareable link)'}</td>
            <td>{invitation.invitationType}</td>
            <td>{invitation.role}</td>
            <td>{invitation.status}</td>
            <td>
              {invitation.status !== 'accepted' && (
                <button onClick={() => onResend(invitation)}>Resend</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
