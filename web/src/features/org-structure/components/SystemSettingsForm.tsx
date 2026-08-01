import { useState, type FormEvent } from 'react'
import type { SystemSettingsData } from '../api/systemSettings'

interface SystemSettingsFormProps {
  settings: SystemSettingsData
  onSubmit: (values: { loginEnabled: boolean; maintenanceMode: boolean; maintenanceMessage: string; maxLoginAttempts: number; sessionTimeoutMinutes: number }) => Promise<void>
}

export default function SystemSettingsForm({ settings, onSubmit }: SystemSettingsFormProps) {
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
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        <input type="checkbox" checked={loginEnabled} onChange={(e) => setLoginEnabled(e.target.checked)} />
        Login enabled
      </label>
      <label>
        <input type="checkbox" checked={maintenanceMode} onChange={(e) => setMaintenanceMode(e.target.checked)} />
        Maintenance mode
      </label>
      <label>
        Maintenance message
        <input value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)} />
      </label>
      <p>
        <em>
          Login enabled and Maintenance mode are enforced on every login attempt (a SuperAdmin
          account can always still sign in).
        </em>
      </p>
      <label>
        Max login attempts
        <input type="number" value={maxLoginAttempts} onChange={(e) => setMaxLoginAttempts(Number(e.target.value))} min={1} />
      </label>
      <label>
        Session timeout (minutes)
        <input type="number" value={sessionTimeoutMinutes} onChange={(e) => setSessionTimeoutMinutes(Number(e.target.value))} min={1} />
      </label>
      <p>
        <em>
          Max login attempts and Session timeout are saved but not yet enforced by the API --
          they do not currently lock out accounts or expire sessions early.
        </em>
      </p>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
