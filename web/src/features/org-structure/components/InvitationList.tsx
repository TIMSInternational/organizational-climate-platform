import { useState } from 'react'
import type { Invitation } from '../api/invitations'

interface InvitationListProps {
  invitations: Invitation[]
  onResend: (invitation: Invitation) => Promise<void>
}

export default function InvitationList({ invitations, onResend }: InvitationListProps) {
  const [error, setError] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  async function handleResendClick(invitation: Invitation) {
    setError(null)
    setResendingId(invitation.id)
    try {
      await onResend(invitation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend invitation')
    } finally {
      setResendingId(null)
    }
  }

  if (invitations.length === 0) {
    return <p>No invitations yet.</p>
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
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
                  <button onClick={() => handleResendClick(invitation)} disabled={resendingId === invitation.id}>
                    {resendingId === invitation.id ? 'Resending…' : 'Resend'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
