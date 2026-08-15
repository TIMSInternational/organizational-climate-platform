import { useState } from 'react'
import RoleSelector from './RoleSelector'
import type { Invitation } from '../api/invitations'
import { useTranslation } from '../../../i18n'
import { Button, SectionLabel, Separator } from '../../../components/ui'

interface ShareableLinkPanelProps {
  onCreate: (role: string) => Promise<Invitation>
}

/**
 * The second invite path: a link rather than an address.
 *
 * It shares a card with `InvitationForm`, so it needs a rule and a heading of its
 * own — without them the role select read as a second, unlabelled copy of the
 * form's own role control directly above it, which is what it looked like on the
 * page before this. The generated URL is a token and is set in mono.
 */
export default function ShareableLinkPanel({ onCreate }: ShareableLinkPanelProps) {
  const { t } = useTranslation()
  const [role, setRole] = useState('employee')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setError(null)
    setCreating(true)
    try {
      const invitation = await onCreate(role)
      setLink(`${window.location.origin}/accept-invitation/${invitation.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <Separator className="my-panel-gap" />
      <SectionLabel>{t('users.shareableLinkTitle')}</SectionLabel>
      <p className="max-w-prose text-fg-secondary">{t('users.shareableLinkDescription')}</p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap items-end gap-inline">
        <label className="mb-0">
          {t('users.role')}
          <RoleSelector value={role} onChange={setRole} />
        </label>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? t('common.creating') : t('users.createShareableLink')}
        </Button>
      </div>
      {link && (
        <p className="mt-panel-gap">
          {t('users.linkAcceptOnce')}{' '}
          <code className="font-mono text-sm tabular-nums">{link}</code>
        </p>
      )}
    </div>
  )
}
