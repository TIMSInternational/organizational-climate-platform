import { useEffect, useState } from 'react'
import {
  getSystemSettings,
  updateSystemSettings,
  type SystemSettingsData,
} from '../api/systemSettings'
import SystemSettingsForm from '../components/SystemSettingsForm'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Button, ErrorState, LoadingRegion } from '../../../components/ui'

/**
 * `/admin/system-settings` — `super_admin` only.
 *
 * ## The failure state used to erase the page
 *
 * A failed load rendered `<p role="alert">{error}</p>` and *nothing else*: no title,
 * no shell, no way back. The operator saw a bare sentence on a white card and could
 * not tell which screen had failed, whether they had permission, or whether retrying
 * was possible — on the one screen in the product that can turn sign-in off for
 * every user. The page header now survives the failure (so the screen still says
 * what it is), the message renders through `ErrorState` like every other load
 * failure in this app, and it carries a Retry that re-runs the same fetch rather
 * than asking for a browser reload.
 */
export default function SystemSettingsPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [settings, setSettings] = useState<SystemSettingsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setError(null)
    setSettings(null)
    try {
      const result = await getSystemSettings(baseUrl)
      setSettings(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  useEffect(() => {
    reload()
    // `reload` closes over `t`, which is not a stable reference; depending on it
    // would refetch on every render. `baseUrl` is the only real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  async function handleSubmit(values: {
    loginEnabled: boolean
    maintenanceMode: boolean
    maintenanceMessage: string
    maxLoginAttempts: number
    sessionTimeoutMinutes: number
  }) {
    await updateSystemSettings(baseUrl, values)
    await reload()
  }

  return (
    <div className="grid gap-panel-gap">
      <PageTopBar
        title={t('navigation.systemSettings')}
        description={t('navigation.systemSettingsDesc')}
      />

      {error !== null ? (
        <ErrorState
          fill
          title={t('settings.loadError')}
          description={error || undefined}
          action={
            <Button type="button" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <LoadingRegion loading={settings === null} label={t('common.loading')}>
          {settings && <SystemSettingsForm settings={settings} onSubmit={handleSubmit} />}
        </LoadingRegion>
      )}
    </div>
  )
}
