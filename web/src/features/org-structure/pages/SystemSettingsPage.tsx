import { useEffect, useState } from 'react'
import { getSystemSettings, updateSystemSettings, type SystemSettingsData } from '../api/systemSettings'
import SystemSettingsForm from '../components/SystemSettingsForm'
import { useTranslation } from '../../../i18n'

export default function SystemSettingsPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [settings, setSettings] = useState<SystemSettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    try {
      const result = await getSystemSettings(baseUrl)
      setSettings(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
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
      <h1>{t('navigation.systemSettings')}</h1>
      {settings ? (
        <SystemSettingsForm settings={settings} onSubmit={handleSubmit} />
      ) : (
        <p>{t('common.loading')}</p>
      )}
    </div>
  )
}
