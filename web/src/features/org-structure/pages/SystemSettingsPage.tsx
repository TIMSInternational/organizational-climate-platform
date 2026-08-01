import { useEffect, useState } from 'react'
import { getSystemSettings, updateSystemSettings, type SystemSettingsData } from '../api/systemSettings'
import SystemSettingsForm from '../components/SystemSettingsForm'

export default function SystemSettingsPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [settings, setSettings] = useState<SystemSettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try {
      const result = await getSystemSettings(baseUrl)
      setSettings(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system settings')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleSubmit(values: { loginEnabled: boolean; maintenanceMode: boolean; maintenanceMessage: string; maxLoginAttempts: number; sessionTimeoutMinutes: number }) {
    await updateSystemSettings(baseUrl, values)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>System settings</h1>
      {settings ? <SystemSettingsForm settings={settings} onSubmit={handleSubmit} /> : <p>Loading…</p>}
    </div>
  )
}
