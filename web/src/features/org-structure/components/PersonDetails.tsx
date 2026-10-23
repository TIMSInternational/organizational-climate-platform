import { useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { ANONYMITY_FLOOR } from '../../../components/charts'
import { Alert, AlertDescription, Button, ConfirmationDialog, Input } from '../../../components/ui'
import { PerSurveyPersonError, resetCredentials, type ResetCredentialsResult, type User } from '../api/users'
import type { PersonDetailsState } from './usePersonDetails'
import { CanvasSelect, Field } from '../next/super/parts'

/**
 * The manager select and one input per active demographic field. `people` is the roster the
 * page already holds: a manager must be in the same company, and that is exactly who it lists.
 */
export function PersonDetailsFields({ user, people, state }: { user: User; people: readonly User[]; state: PersonDetailsState }) {
  const { t, locale } = useTranslation()
  const managerSelectId = useId()
  const baseId = useId()

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <Alert variant="warning">
        <AlertDescription>{t('users.next.edit.detailsUnavailable')}</AlertDescription>
      </Alert>
    )
  }

  // Everyone else in the company who is active, plus the current manager whatever their state, so
  // a person reporting to someone since deactivated still reads true.
  const candidates = people
    .filter((person) => person.id !== user.id && (person.isActive || person.id === state.managerId))
    .sort((a, b) => a.name.localeCompare(b.name, locale))

  return (
    <div data-slot="person-details" className="flex flex-col gap-3 border-t border-line-light pt-3">
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
        <Field fieldLabel={t('users.next.edit.manager')} htmlFor={managerSelectId} helper={t('users.next.edit.managerHelper')}>
          <CanvasSelect
            id={managerSelectId}
            className="w-full"
            value={state.managerId}
            onChange={(event) => state.setManagerId(event.target.value)}
          >
            <option value="">{t('users.next.edit.managerNone')}</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </CanvasSelect>
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-xs font-semibold text-fg-secondary">{t('users.next.edit.demographics')}</p>
        <p className="m-0 text-xs text-fg-tertiary">
          {state.fields.length === 0 ? t('users.next.edit.demographicsNone') : t('users.next.edit.demographicsHelper', { floor: ANONYMITY_FLOOR })}
        </p>
      </div>
      {state.fields.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
          {state.fields.map((field) => {
            const id = `${baseId}-${field.field}`
            const value = state.answers[field.field] ?? ''
            const label = field.label ?? field.field
            return (
              <Field key={field.id} fieldLabel={label} htmlFor={id} required={field.required}>
                {field.type === 'select' ? (
                  <CanvasSelect id={id} className="w-full" value={value} onChange={(event) => state.setAnswer(field.field, event.target.value)}>
                    <option value="">{t('users.next.edit.demographicEmpty')}</option>
                    {(field.options ?? [])
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label ?? option.value}
                        </option>
                      ))}
                    {/* An answer no longer among the options still reads as itself, not as blank. */}
                    {value && !(field.options ?? []).some((option) => option.value === value) && <option value={value}>{value}</option>}
                  </CanvasSelect>
                ) : (
                  <Input
                    id={id}
                    type={field.type === 'date' ? 'date' : 'text'}
                    inputMode={field.type === 'number' ? 'decimal' : undefined}
                    value={value}
                    onChange={(event) => state.setAnswer(field.field, event.target.value)}
                    className="w-full"
                  />
                )}
              </Field>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * What deactivating does, said before it is done (audit G5). Every clause is measured:
 * sign-in refuses an inactive account by email and by every per-survey key, with the answer a
 * wrong password gets (`DeactivatedSurveyCredentialSignInTests`); the security stamp rotates
 * (`UserEndpoints.UpdateAsync`); audiences hold active people only (`SurveyQueries.Audience`);
 * reactivating makes the same keys sign in again.
 */
export function DeactivationConfirm({
  open,
  name,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  name: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.next.edit.deactivateTitle', { name })}
      description={t('users.next.edit.deactivateBody')}
      confirmText={t('users.next.edit.deactivateConfirm')}
      cancelText={t('common.cancel')}
      variant="destructive"
      onConfirm={onConfirm}
    />
  )
}

/**
 * Resets an email sign-in account's password (audit G29): the login screen tells a person who
 * forgot theirs to ask an administrator, and `POST /auth/admin/reset-credentials` had no client.
 *
 * The route SENDS NOTHING. It returns the temporary password, so this shows it, once, with who it
 * is for and what it signs in with -- and says that no email went anywhere.
 *
 * Offered only to an active account that signs in by email: a mass-invite account has
 * `ResendCredentials`, which mails a new pair, and an inactive one cannot sign in at all.
 */
export function ResetPassword({
  user,
  baseUrl,
  allowed,
  details,
}: {
  user: User
  baseUrl: string
  allowed: boolean
  /** The detail read: whether this person signs in only with per-survey codes. */
  details: Pick<PersonDetailsState, 'status' | 'surveyCodesOnly'>
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ResetCredentialsResult | null>(null)
  const [failed, setFailed] = useState<null | 'generic' | 'perSurvey'>(null)
  const passwordId = useId()

  // Not until the detail says who this is: offering the button and then withdrawing it would
  // be worse than drawing it a moment later. If the read FAILED the button stays, and the API's
  // refusal is said in Spanish below.
  if (!allowed || user.username || !user.isActive || details.status === 'loading') return null

  // One code, one survey: a reset would give them an email sign-in that opens every survey.
  if (details.surveyCodesOnly) {
    return (
      <p data-slot="reset-password-per-survey" className="m-0 text-xs text-fg-tertiary">
        {t('users.next.edit.resetPerSurvey')}
      </p>
    )
  }

  async function reset() {
    setFailed(null)
    try {
      setResult(await resetCredentials(baseUrl, user.id))
    } catch (err) {
      setFailed(err instanceof PerSurveyPersonError ? 'perSurvey' : 'generic')
      // Closes the dialog rather than leaving it open on a refusal that will not change.
      if (err instanceof PerSurveyPersonError) return
      throw err
    }
  }

  return (
    <div data-slot="reset-password" className="flex flex-col gap-2">
      {result ? (
        <Alert variant="success" data-slot="reset-password-outcome">
          <KeyRound aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1.5 text-sm">
            <span role="status">{t('users.next.edit.resetDone', { name: user.name })}</span>
            <label htmlFor={passwordId} className="m-0 text-xs font-semibold text-fg-secondary">
              {t('users.next.edit.resetPasswordLabel')}
            </label>
            <Input
              id={passwordId}
              readOnly
              value={result.temporaryPassword}
              onFocus={(event) => event.currentTarget.select()}
              className="w-full max-w-sm font-mono"
            />
            <span>{t('users.next.edit.resetSignIn', { name: user.name, email: result.email })}</span>
            <span>{t('users.next.edit.resetSurveyCodes')}</span>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            <KeyRound aria-hidden="true" />
            {t('users.next.edit.resetPassword')}
          </Button>
          <span className="text-xs text-fg-tertiary">{t('users.next.edit.resetPasswordHelper')}</span>
          {failed && (
            <span role="status" className="text-xs text-accent-red">
              {failed === 'perSurvey' ? t('users.next.edit.resetPerSurvey') : t('users.next.edit.resetFailed')}
            </span>
          )}
        </div>
      )}
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('users.next.edit.resetTitle', { name: user.name })}
        description={t('users.next.edit.resetBody', { email: user.email })}
        confirmText={t('users.next.edit.resetConfirm')}
        cancelText={t('common.cancel')}
        onConfirm={reset}
      />
    </div>
  )
}
