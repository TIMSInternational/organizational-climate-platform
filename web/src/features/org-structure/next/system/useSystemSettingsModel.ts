import { useCallback, useEffect, useState } from 'react'
import { getSystemSettings, updateSystemSettings, type SystemSettingsData } from '../../api/systemSettings'
import { draftFrom, isDirty, updatePayload, type SettingsDraft } from './settingsDerive'

export interface SystemSettingsModelState {
  loading: boolean
  settings: SystemSettingsData | null
  draft: SettingsDraft | null
  setDraft: (next: SettingsDraft) => void
  dirty: boolean
  /** The load failed; the page keeps its header and offers a retry. */
  loadError: string | null
  saving: boolean
  saved: boolean
  saveError: string | null
  reload: () => void
  save: () => void
  discard: () => void
}

/**
 * The model behind `/admin/system-settings` — THE wiring seam of that screen, over the
 * existing client (`api/systemSettings.ts`): `GET /admin/system-settings` to read, and the
 * same `PUT` the old page made with the same five fields to write (`settingsDerive.ts`).
 * `super_admin` only on the server (`SystemSettingsEndpoints.cs:84`, `:103`).
 *
 * After a save the page reads the settings back, as the old one did, so what it shows is
 * what the server now holds rather than what was typed.
 */
export function useSystemSettingsModel(): SystemSettingsModelState {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [settings, setSettings] = useState<SystemSettingsData | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await getSystemSettings(baseUrl)
      setSettings(next)
      setDraft(draftFrom(next))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '')
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await updateSystemSettings(baseUrl, updatePayload(draft))
      await reload()
      setSaved(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '')
    } finally {
      setSaving(false)
    }
  }, [baseUrl, draft, reload])

  return {
    loading,
    settings,
    draft,
    setDraft: (next) => {
      setSaved(false)
      setDraft(next)
    },
    dirty: settings !== null && draft !== null && isDirty(draft, settings),
    loadError,
    saving,
    saved,
    saveError,
    reload: () => {
      void reload()
    },
    save: () => {
      void save()
    },
    discard: () => {
      if (settings) setDraft(draftFrom(settings))
      setSaveError(null)
    },
  }
}
