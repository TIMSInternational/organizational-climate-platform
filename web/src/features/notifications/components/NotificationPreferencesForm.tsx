import { useState, type FormEvent } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  RadioField,
  SwitchField,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import {
  DIGEST_FREQUENCIES,
  type DigestFrequency,
  type NotificationPreferences,
} from '../api/notificationPreferences'

/**
 * Catalogue paths for the four digest values.
 *
 * A lookup keyed by the API's own vocabulary rather than an inline list, so a value the
 * server accepts can never render as a blank option: adding a fifth frequency to
 * `DIGEST_FREQUENCIES` fails to typecheck here until it has copy.
 */
const DIGEST_LABEL_PATH: Record<DigestFrequency, string> = {
  daily: 'notifications.preferences.digestDaily',
  weekly: 'notifications.preferences.digestWeekly',
  monthly: 'notifications.preferences.digestMonthly',
  never: 'notifications.preferences.digestNever',
}

export interface NotificationPreferencesFormProps {
  /** The values currently persisted for this user. */
  preferences: NotificationPreferences
  onSubmit: (values: NotificationPreferences) => Promise<void>
}

/**
 * The five exposed preferences (#103). **Push is not one of them** and must not be added
 * here — the platform has no push delivery path, so a toggle would be decorative. See
 * `api/notificationPreferences.ts`.
 *
 * ## Why each switch states its position in words
 *
 * Four of the five are email opt-outs, i.e. consent state in everything but name. A
 * switch alone communicates "on" only through its rendered position, which a user
 * reading quickly — or a screen-reader user who lands on the description before the
 * control — can easily read as a suggestion rather than as what is actually stored. Each
 * row therefore carries an explicit "Currently on/off" line describing the *saved*
 * value's meaning, and the page says outright that nothing changes until Save. The one
 * thing this page must never do is let a default look like a decision the user made.
 *
 * Account and security mail is shown as a non-optional category with no control at all,
 * rather than as a disabled switch: a disabled toggle still reads as a setting, and there
 * is no setting.
 */
export default function NotificationPreferencesForm({
  preferences,
  onSubmit,
}: NotificationPreferencesFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<NotificationPreferences>(preferences)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function setFlag(key: keyof Omit<NotificationPreferences, 'digestFrequency'>, next: boolean) {
    setSaved(false)
    setValues((current) => ({ ...current, [key]: next }))
  }

  function emailState(checked: boolean): string {
    return checked ? t('notifications.preferences.stateOn') : t('notifications.preferences.stateOff')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-panel-gap">
      <p className="text-sm text-fg-tertiary">{t('notifications.preferences.currentStateNote')}</p>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {saved && (
        <Alert role="status">
          <AlertDescription>{t('notifications.preferences.saved')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.preferences.emailSectionTitle')}</CardTitle>
          <CardDescription>{t('notifications.preferences.emailSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-panel-gap">
          <SwitchField
            label={t('notifications.preferences.emailSurveys')}
            description={`${t('notifications.preferences.emailSurveysDescription')} ${emailState(values.emailSurveys)}`}
            checked={values.emailSurveys}
            onChange={(next) => setFlag('emailSurveys', next)}
          />
          <SwitchField
            label={t('notifications.preferences.emailMicroclimates')}
            description={`${t('notifications.preferences.emailMicroclimatesDescription')} ${emailState(values.emailMicroclimates)}`}
            checked={values.emailMicroclimates}
            onChange={(next) => setFlag('emailMicroclimates', next)}
          />
          <SwitchField
            label={t('notifications.preferences.emailActionPlans')}
            description={`${t('notifications.preferences.emailActionPlansDescription')} ${emailState(values.emailActionPlans)}`}
            checked={values.emailActionPlans}
            onChange={(next) => setFlag('emailActionPlans', next)}
          />
          <SwitchField
            label={t('notifications.preferences.emailReminders')}
            description={`${t('notifications.preferences.emailRemindersDescription')} ${emailState(values.emailReminders)}`}
            checked={values.emailReminders}
            onChange={(next) => setFlag('emailReminders', next)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.preferences.digestTitle')}</CardTitle>
          <CardDescription>{t('notifications.preferences.digestDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* A radio group rather than a select: all four choices and the one actually
              stored are visible at once, which a collapsed control cannot do. */}
          <RadioField
            label={t('notifications.preferences.digestLabel')}
            value={values.digestFrequency}
            onChange={(next) => {
              setSaved(false)
              setValues((current) => ({ ...current, digestFrequency: next as DigestFrequency }))
            }}
            options={DIGEST_FREQUENCIES.map((frequency) => ({
              value: frequency,
              label: t(DIGEST_LABEL_PATH[frequency]),
            }))}
          />
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>
          {t('notifications.preferences.alwaysSentTitle')}{' '}
          <Badge variant="secondary">{t('notifications.preferences.alwaysSentBadge')}</Badge>
        </AlertTitle>
        <AlertDescription>{t('notifications.preferences.alwaysSentDescription')}</AlertDescription>
      </Alert>

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}
