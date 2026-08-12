import { useState } from 'react'
import type { Invitation } from '../api/invitations'
import { useTranslation } from '../../../i18n'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { invitationStatusLabelKey, invitationTypeLabelKey, roleLabelKey } from '../labels'

interface InvitationListProps {
  invitations: Invitation[]
  onResend: (invitation: Invitation) => Promise<void>
}

/**
 * Outstanding invitations — the other half of the roster.
 *
 * The status is a badge with a word in it, never a bare colour: `accepted` is the
 * only terminal state and it is the one that removes the resend action, so a
 * reader who cannot separate green from grey still has the word and the missing
 * button telling them the same thing.
 *
 * Status, type and role all arrive as wire tokens (`sent`, `employee_direct`,
 * `company_admin`) and are translated through `../labels.ts`; the expiry date is
 * a reading and is set in mono with tabular figures.
 */
export default function InvitationList({ invitations, onResend }: InvitationListProps) {
  const { t, locale } = useTranslation()
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

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-line-light">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
                {t('users.email')}
              </TableHead>
              <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
                {t('common.type')}
              </TableHead>
              <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
                {t('users.role')}
              </TableHead>
              <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
                {t('common.status')}
              </TableHead>
              <TableHead className="bg-surface-icon-box text-2xs uppercase tracking-label text-fg-secondary">
                {t('users.expiresAt')}
              </TableHead>
              <TableHead className="bg-surface-icon-box text-right text-2xs uppercase tracking-label text-fg-secondary">
                {t('common.actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.length === 0 ? (
              <TableEmpty colSpan={6}>{t('users.noInvitationsYet')}</TableEmpty>
            ) : (
              invitations.map((invitation) => {
                const statusKey = invitationStatusLabelKey(invitation.status)
                const typeKey = invitationTypeLabelKey(invitation.invitationType)
                const roleKey = roleLabelKey(invitation.role)
                return (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-mono text-sm tabular-nums text-fg-secondary">
                      {invitation.email ?? t('users.shareableLinkSuffix')}
                    </TableCell>
                    <TableCell className="text-fg-secondary">
                      {typeKey ? t(typeKey) : invitation.invitationType}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {roleKey ? t(roleKey) : invitation.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={invitation.status === 'accepted' ? 'success' : 'warning'}>
                        {statusKey ? t(statusKey) : invitation.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-fg-secondary">
                      {new Date(invitation.expiresAt).toLocaleDateString(locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      {invitation.status !== 'accepted' && (
                        <Button
                          size="sm"
                          onClick={() => handleResendClick(invitation)}
                          disabled={resendingId === invitation.id}
                        >
                          {resendingId === invitation.id ? t('users.resending') : t('users.resend')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
