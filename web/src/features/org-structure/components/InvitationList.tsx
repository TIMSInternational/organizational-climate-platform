import { useState } from 'react'
import type { Invitation } from '../api/invitations'
import { useTranslation } from '../../../i18n'
import { Table } from '../../../components/ui'

interface InvitationListProps {
  invitations: Invitation[]
  onResend: (invitation: Invitation) => Promise<void>
}

export default function InvitationList({ invitations, onResend }: InvitationListProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  async function handleResendClick(invitation: Invitation) {
    setError(null)
    setResendingId(invitation.id)
    try {
      await onResend(invitation)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setResendingId(null)
    }
  }

  if (invitations.length === 0) {
    return <p>{t('users.noInvitationsYet')}</p>
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <Table>
        <thead>
          <tr>
            <th>{t('users.email')}</th>
            <th>{t('common.type')}</th>
            <th>{t('users.role')}</th>
            <th>{t('common.status')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr key={invitation.id}>
              <td>{invitation.email ?? t('users.shareableLinkSuffix')}</td>
              <td>{invitation.invitationType}</td>
              <td>{invitation.role}</td>
              <td>{invitation.status}</td>
              <td>
                {invitation.status !== 'accepted' && (
                  <button onClick={() => handleResendClick(invitation)} disabled={resendingId === invitation.id}>
                    {resendingId === invitation.id ? t('users.resending') : t('users.resend')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  )
}
