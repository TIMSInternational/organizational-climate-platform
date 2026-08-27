import { useState, type FormEvent } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  FormControl,
  FormItem,
  FormLabel,
  Input,
  SwitchField,
  TextField,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { SystemSettingsData } from '../api/systemSettings'

interface SystemSettingsFormProps {
  settings: SystemSettingsData
  onSubmit: (values: {
    loginEnabled: boolean
    maintenanceMode: boolean
    maintenanceMessage: string
    maxLoginAttempts: number
    sessionTimeoutMinutes: number
  }) => Promise<void>
}

/**
 * The platform's system-wide controls — a `super_admin`-only surface
 * (`CompanyEndpoints`-style role gate lives in `SystemSettingsEndpoints`).
 *
 * ## Why the two groups are not one list
 *
 * `loginEnabled` and `maintenanceMode` decide whether *anyone* can sign in to the
 * product; `maxLoginAttempts` and `sessionTimeoutMinutes` are policy numbers that
 * the API stores but does not yet enforce. Presenting all five as one undifferentiated
 * run of controls — which is what this form used to do, in raw `<label><input>` pairs
 * with no gap between the box and its text — put a switch that can lock every user
 * out of the platform next to a number that currently does nothing, with no visual
 * signal that they carry different consequences. They are two cards now, and the
 * destructive positions announce themselves: turning login off, or maintenance on,
 * raises a `destructive` Alert naming who is affected *before* the operator saves.
 *
 * ## Password policy and email delivery are read-only here, deliberately
 *
 * `getSystemSettings` returns `passwordPolicy` and `emailSettings`, and this form
 * used to drop both on the floor — a `super_admin` had no way to see, anywhere in
 * the product, what password rule was in force or which SMTP host the platform was
 * sending through. They are surfaced, but as read-only summaries: `onSubmit`'s
 * signature carries neither, so rendering them as editable controls would build a
 * form whose Save silently discards half of what it shows. Making them writable is
 * an API-shaped change, not a presentation one.
 */
export default function SystemSettingsForm({ settings, onSubmit }: SystemSettingsFormProps) {
  const { t } = useTranslation()
  const [loginEnabled, setLoginEnabled] = useState(settings.loginEnabled)
  const [maintenanceMode, setMaintenanceMode] = useState(settings.maintenanceMode)
  const [maintenanceMessage, setMaintenanceMessage] = useState(settings.maintenanceMessage ?? '')
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(settings.maxLoginAttempts)
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(settings.sessionTimeoutMinutes)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // The pending position, not the saved one: the warning has to appear while the
  // operator is deciding, which is before `settings` has any of this.
  const locksUsersOut = !loginEnabled || maintenanceMode

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setSubmitting(true)
    try {
      await onSubmit({
        loginEnabled,
        maintenanceMode,
        maintenanceMessage,
        maxLoginAttempts,
        sessionTimeoutMinutes,
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  function yesNo(value: boolean): string {
    return value ? t('common.yes') : t('common.no')
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-panel-gap">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {saved && (
        <Alert role="status">
          <AlertDescription>{t('settings.savedNote')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.availabilityTitle')}</CardTitle>
          <CardDescription>{t('settings.enforcedOnEveryLoginNote')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-panel-gap">
          <SwitchField
            label={t('settings.loginEnabled')}
            description={t('settings.loginEnabledDescription')}
            checked={loginEnabled}
            onChange={(next) => {
              setSaved(false)
              setLoginEnabled(next)
            }}
          />
          <SwitchField
            label={t('settings.maintenanceMode')}
            description={t('settings.maintenanceModeDescription')}
            checked={maintenanceMode}
            onChange={(next) => {
              setSaved(false)
              setMaintenanceMode(next)
            }}
          />
          <TextField
            label={t('settings.maintenanceMessage')}
            description={t('settings.maintenanceMessageDescription')}
            value={maintenanceMessage}
            onChange={(next) => {
              setSaved(false)
              setMaintenanceMessage(next)
            }}
          />

          {locksUsersOut && (
            <Alert variant="destructive" role="status">
              <AlertTitle>{t('settings.lockoutWarningTitle')}</AlertTitle>
              <AlertDescription>{t('settings.lockoutWarningDescription')}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.sessionTitle')}</CardTitle>
          <CardDescription>{t('settings.notYetEnforcedNote')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-panel-gap">
          {/* Composed from FormItem/FormControl rather than `TextField`, which has
              no `min` prop: both inputs carried `min={1}` before this redesign and
              dropping it would quietly widen what the form accepts. */}
          <NumberField
            label={t('settings.maxLoginAttempts')}
            value={maxLoginAttempts}
            onChange={(next) => {
              setSaved(false)
              setMaxLoginAttempts(next)
            }}
          />
          <NumberField
            label={t('settings.sessionTimeoutMinutes')}
            value={sessionTimeoutMinutes}
            onChange={(next) => {
              setSaved(false)
              setSessionTimeoutMinutes(next)
            }}
          />
        </CardContent>
      </Card>

      {/* The commit for the two editable cards above, and nothing below it. Kept
          hard against them, and separated from the read-only summaries by the rule
          under it, so Save never reads as though it also writes the password policy
          or the SMTP host — which it does not. */}
      <div className="flex items-center justify-end gap-inline border-b border-line-default pb-panel-gap">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('common.saving') : t('common.save')}
        </Button>
      </div>

      {/* Read-only from here down — see the component's doc comment. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.passwordPolicyTitle')}</CardTitle>
          <CardDescription>{t('settings.readOnlyNote')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-inline sm:grid-cols-2">
            <SummaryRow
              term={t('settings.passwordMinLength')}
              detail={String(settings.passwordPolicy.minLength)}
            />
            <SummaryRow
              term={t('settings.passwordRequireUppercase')}
              detail={yesNo(settings.passwordPolicy.requireUppercase)}
            />
            <SummaryRow
              term={t('settings.passwordRequireLowercase')}
              detail={yesNo(settings.passwordPolicy.requireLowercase)}
            />
            <SummaryRow
              term={t('settings.passwordRequireNumbers')}
              detail={yesNo(settings.passwordPolicy.requireNumbers)}
            />
            <SummaryRow
              term={t('settings.passwordRequireSpecialChars')}
              detail={yesNo(settings.passwordPolicy.requireSpecialChars)}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.emailDeliveryTitle')}</CardTitle>
          <CardDescription>{t('settings.readOnlyNote')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-panel-gap">
          <div>
            <Chip
              tone={settings.emailSettings.smtpEnabled ? 'good' : 'warning'}
              label={
                settings.emailSettings.smtpEnabled
                  ? t('settings.emailSmtpEnabled')
                  : t('settings.emailSmtpDisabled')
              }
            />
          </div>
          <dl className="grid gap-inline sm:grid-cols-2">
            <SummaryRow
              term={t('settings.emailFrom')}
              detail={settings.emailSettings.fromEmail ?? t('settings.notConfigured')}
            />
            <SummaryRow
              term={t('settings.emailHost')}
              detail={settings.emailSettings.smtpHost ?? t('settings.notConfigured')}
            />
            <SummaryRow
              term={t('settings.emailPort')}
              detail={
                settings.emailSettings.smtpPort === null
                  ? t('settings.notConfigured')
                  : String(settings.emailSettings.smtpPort)
              }
            />
          </dl>
        </CardContent>
      </Card>
    </form>
  )
}

/**
 * A whole-number field that keeps `min={1}`.
 *
 * `TextField` covers every other row on this page, but its prop list has no `min`,
 * and these two inputs are the only ones on the screen where a zero or a negative
 * is meaningless. Composed from the same `FormItem`/`FormLabel`/`FormControl`
 * primitives `TextField` itself uses, so the label association, the `max-w-field`
 * measure and the disabled/invalid wiring are identical.
 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <FormItem className="max-w-field">
      <FormLabel>{label}</FormLabel>
      <FormControl>
        <Input
          type="number"
          min={1}
          value={String(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </FormControl>
    </FormItem>
  )
}

/**
 * One `<dt>`/`<dd>` pair. A description list rather than a two-column grid of
 * `<span>`s so the term/value relationship survives a screen reader, which is the
 * whole reason these summaries are worth rendering at all.
 */
function SummaryRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-fg-tertiary">{term}</dt>
      <dd className="text-sm text-fg-primary">{detail}</dd>
    </div>
  )
}
