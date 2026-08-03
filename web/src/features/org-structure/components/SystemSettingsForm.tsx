import { useState, type FormEvent } from 'react'
import type { SystemSettingsData } from '../api/systemSettings'
import { useTranslation } from '../../../i18n'

interface SystemSettingsFormProps {
  settings: SystemSettingsData
  onSubmit: (values: { loginEnabled: boolean; maintenanceMode: boolean; maintenanceMessage: string; maxLoginAttempts: number; sessionTimeoutMinutes: number }) => Promise<void>
}

export default function SystemSettingsForm({ settings, onSubmit }: SystemSettingsFormProps) {
  const { t } = useTranslation()
  const [loginEnabled, setLoginEnabled] = useState(settings.loginEnabled)
  const [maintenanceMode, setMaintenanceMode] = useState(settings.maintenanceMode)
  const [maintenanceMessage, setMaintenanceMessage] = useState(settings.maintenanceMessage ?? '')
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(settings.maxLoginAttempts)
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(settings.sessionTimeoutMinutes)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ loginEnabled, maintenanceMode, maintenanceMessage, maxLoginAttempts, sessionTimeoutMinutes })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        <input type="checkbox" checked={loginEnabled} onChange={(e) => setLoginEnabled(e.target.checked)} />
        {t('settings.loginEnabled')}
      </label>
      <label>
        <input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} />
        {t('settings.maintenanceMode')}
      </label>
      <label>
        {t('settings.maintenanceMessage')}
        <input value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)} />
      </label>
      <p>
        <em>
          {t('settings.enforcedOnEveryLoginNote')}
        </em>
      </p>
      <label>
        {t('settings.maxLoginAttempts')}
        <input type="number" value={maxLoginAttempts} onChange={(e) => setMaxLoginAttempts(Number(e.target.value))} min={1} />
      </label>
      <label>
        {t('settings.sessionTimeoutMinutes')}
        <input type="number" value={sessionTimeoutMinutes} onChange={(e) => setSessionTimeoutMinutes(Number(e.target.value))} min={1} />
      </label>
      <p>
        <em>
          {t('settings.notYetEnforcedNote')}
        </em>
      </p>
      <button type="submit" disabled={submitting}>{submitting ? t('common.saving') : t('common.save')}</button>
    </form>
  )
}
