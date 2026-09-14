import { useCallback, useEffect, useState } from 'react'
import { getSystemStatus, type SystemStatusResponse } from '../../api/systemStatus'
import { getSystemSettings, type SystemEmailSettings } from '../../api/systemSettings'

export interface SystemHealthModelState {
  loading: boolean
  /** The status payload — an `unhealthy` 503 body included (`getSystemStatus` opts it in). */
  status: SystemStatusResponse | null
  /** The stored SMTP settings for the mail tile, or `null` when that read failed. */
  email: SystemEmailSettings | null
  /** The status request itself failed — no network, or not authorised. Not "unhealthy". */
  failed: boolean
  reload: () => void
}

/**
 * The model behind `/admin/system` — THE wiring seam of that screen, over two existing
 * clients and no new endpoint: `GET /admin/system/status` (`api/systemStatus.ts`, #147/#275)
 * for every component and job, and `GET /admin/system-settings` (`api/systemSettings.ts`)
 * for the one tile the status payload does not carry, mail. Both are `super_admin`-only on
 * the server (`SystemStatusEndpoints.cs`, `SystemSettingsEndpoints.cs:84`).
 *
 * The two reads fail independently: a settings read that fails costs the mail tile its
 * reading and nothing else, because the status payload is what an operator opened the
 * page for. Nothing here is a sample.
 */
export function useSystemHealthModel(): SystemHealthModelState {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<SystemStatusResponse | null>(null)
  const [email, setEmail] = useState<SystemEmailSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const [statusRead, settingsRead] = await Promise.allSettled([getSystemStatus(baseUrl), getSystemSettings(baseUrl)])
    if (statusRead.status === 'fulfilled') {
      setStatus(statusRead.value)
    } else {
      setStatus(null)
      setFailed(true)
    }
    setEmail(settingsRead.status === 'fulfilled' ? settingsRead.value.emailSettings : null)
    setLoading(false)
  }, [baseUrl])

  useEffect(() => {
    void load()
  }, [load])

  return {
    loading,
    status,
    email,
    failed,
    reload: () => {
      void load()
    },
  }
}
