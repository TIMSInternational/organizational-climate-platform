import { useState } from 'react'
import { Send } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Button } from '../../../components/ui'
import { resendCredentials, type User } from '../api/users'

/**
 * Sends a mass-invite account a fresh username and password.
 *
 * This is the recovery the product did not have. An invitation whose mail fails stays
 * `pending`, is listed on the Usuarios page and already has a resend button; a mass-invite
 * account is created ACTIVE, so a person whose credentials email never arrived is
 * indistinguishable from one who simply has not signed in yet. `POST /admin/users/{id}/credentials`
 * has existed since the mass invite shipped and nothing in the client called it, so the only
 * way out was to delete the person and import them again.
 *
 * Renders nothing for an account that signs in by email: it has no generated pair to replace,
 * and the API answers such a request 409 `not_mass_invite`.
 */
export function ResendCredentials({ user, baseUrl }: { user: User; baseUrl: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  if (user.username === null) {
    return null
  }

  async function send() {
    setState('sending')
    try {
      // `delivered`, never "the call returned": the endpoint answers 200 with
      // `delivered: false` when the mail did not go, because the password is replaced first.
      const result = await resendCredentials(baseUrl, user.id)
      setState(result.delivered ? 'sent' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" onClick={() => void send()} disabled={state === 'sending'}>
        <Send aria-hidden="true" />
        {t('users.next.edit.resendCredentials')}
      </Button>
      {/* The replacement is the point, not a detail: the pair already in that person's inbox
          stops working the moment this succeeds. */}
      <span className="text-xs text-fg-tertiary">{t('users.next.edit.resendCredentialsHelper')}</span>
      {state !== 'idle' && state !== 'sending' && (
        <span role="status" className={state === 'sent' ? 'text-xs text-fg-secondary' : 'text-xs text-accent-red'}>
          {t(state === 'sent' ? 'users.next.edit.resendCredentialsDone' : 'users.next.edit.resendCredentialsFailed')}
        </span>
      )}
    </div>
  )
}
