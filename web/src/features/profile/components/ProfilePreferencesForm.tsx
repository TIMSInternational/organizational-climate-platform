import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SelectField,
  TextField,
} from '../../../components/ui'
import { useTranslation, LOCALES, isLocale } from '../../../i18n'
import { setAdminThemeMode } from '../../../theme/adminTheme'
import {
  PROFILE_THEMES,
  type ProfileDisplayPreferences,
  type ProfileTheme,
} from '../api/profile'

const LOCALE_LABEL_PATH: Record<string, string> = {
  en: 'language.english',
  es: 'language.spanish',
}

/**
 * Catalogue paths for the three themes, keyed by the API's own vocabulary — so a value the
 * server accepts can never render as a blank option. Reuses the shell's existing copy
 * rather than adding a second set of words for the same three things.
 */
const THEME_LABEL_PATH: Record<ProfileTheme, string> = {
  light: 'shell.themeLight',
  dark: 'shell.themeDark',
  system: 'shell.themeSystem',
}

function isTheme(value: string): value is ProfileTheme {
  return (PROFILE_THEMES as readonly string[]).includes(value)
}

export interface ProfilePreferencesFormProps {
  preferences: ProfileDisplayPreferences
  onSubmit: (values: ProfileDisplayPreferences) => Promise<void>
}

/**
 * Display preferences: language, timezone, theme.
 *
 * ## Saving applies the choice, it does not merely record it
 *
 * Language and theme already have a client-side home — `preferredLocale` and `admin-theme`
 * in `localStorage`, which is what the shell's pickers write and what the app actually
 * reads at boot. Persisting the same two values on the server without applying them here
 * would produce the one thing this codebase refuses elsewhere: a preference the product
 * stores and then ignores. So a successful save writes both, and the page changes language
 * and theme immediately.
 *
 * The server copy is not redundant with the browser copy — it is what makes the choice
 * follow the person to another device, and what lets outbound mail be composed in their
 * language (`InvitationEmailComposer` already reads `Preferences.Language`). The browser
 * copy is what survives a cold boot before any API call has returned.
 *
 * ## What is not here
 *
 * - **Notification preferences.** Same store, different page: this card links to
 *   `/settings/notifications` rather than restating four consent switches that already have
 *   a home. Two editors for one set of opt-outs is how they start disagreeing.
 * - **Dashboard layout.** Reported by the API, owned by #133, and not writable anywhere yet.
 */
export default function ProfilePreferencesForm({
  preferences,
  onSubmit,
}: ProfilePreferencesFormProps) {
  const { t, setLocale } = useTranslation()
  const [values, setValues] = useState<ProfileDisplayPreferences>(preferences)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function update(patch: Partial<ProfileDisplayPreferences>) {
    setSaved(false)
    setValues((current) => ({ ...current, ...patch }))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setSaved(true)

      // Only after the server has accepted them. Applying first would leave the app in a
      // language the stored preference disagrees with if the save then failed.
      if (isLocale(values.language)) setLocale(values.language)
      if (isTheme(values.theme)) setAdminThemeMode(values.theme)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.preferencesTitle')}</CardTitle>
        <CardDescription>{t('profile.preferencesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-panel-gap">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {saved && (
            <Alert role="status">
              <AlertDescription>{t('profile.preferencesSaved')}</AlertDescription>
            </Alert>
          )}

          <SelectField
            label={t('profile.language')}
            value={values.language}
            onChange={(next) => update({ language: next })}
            options={LOCALES.map((option) => ({
              value: option,
              label: t(LOCALE_LABEL_PATH[option]),
            }))}
          />

          <SelectField
            label={t('shell.theme')}
            value={values.theme}
            onChange={(next) => update({ theme: next })}
            options={PROFILE_THEMES.map((option) => ({
              value: option,
              label: t(THEME_LABEL_PATH[option]),
            }))}
          />

          {/* A free-text field, not a picker over a hardcoded list. The server validates
              against the runtime's own tz database, which is far larger than any list worth
              shipping here, and it rejects anything it cannot resolve — so a typo comes back
              as a message rather than being stored. */}
          <TextField
            label={t('profile.timezone')}
            description={t('profile.timezoneDescription')}
            value={values.timezone}
            maxLength={100}
            onChange={(next) => update({ timezone: next })}
          />

          <p className="text-sm text-fg-tertiary">
            <Link to="/settings/notifications">{t('profile.notificationPreferencesLink')}</Link>{' '}
            {t('profile.notificationPreferencesNote')}
          </p>

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
