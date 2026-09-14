import { useEffect, useMemo, useState } from 'react'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { getNotificationPreferences, type NotificationPreferences } from '../../notifications/api/notificationPreferences'
import { listPlanesAccion } from '../../tracking/api/trackingApi'
import { readViewer } from '../../tracking/next/viewer'
import { getMyDataExport, type SubjectAccessExport } from '../api/gdpr'
import { getProfile, type Profile } from '../api/profile'

export interface PrivacyState {
  /** The caller's identity for an erasure request; `null` until read or when it failed. */
  profile: Profile | null
  /** Their email choices — the one consent they change; `null` until read or when it failed. */
  notifications: NotificationPreferences | null
  /**
   * The tracking plans the caller answers for, by code — `null` when the tracking service was
   * not asked or did not answer, so the note never says "none" about a list it never read.
   */
  responsibleFor: readonly string[] | null
  /** Ask for the full export: the audited read, made only when the person asks for the file. */
  requestExport: () => Promise<SubjectAccessExport>
}

/**
 * THE wiring seam of *Privacidad* (`/settings/privacy`, PrivacySettings artboard).
 *
 * `GET /gdpr/access` is read ONLY when the person presses "Descargar mis datos": the old page
 * already disclosed nothing until asked, and the artboard goes further — every read of it is
 * written to the audit, so the counts and the consent columns live in the file, not on the
 * screen. What the screen does read is not audited and not the subject's data held elsewhere:
 * `GET /profile` (the identifiers an erasure request needs), `GET /notifications/preferences`
 * (the email choices, the one consent a person changes) and the tracking service's scoped
 * `GET /api/planes-accion` (which plans name them as responsable — the part the export cannot
 * include). Each fails on its own.
 */
export function usePrivacyModel(): PrivacyState {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const capabilities = useViewerCapabilities()
  const viewer = useMemo(() => readViewer(), [])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(null)
  const [responsibleFor, setResponsibleFor] = useState<readonly string[] | null>(null)
  // The tracking list answers whoever the service admits; a caller with no tenant claim is
  // refused before any read (`MatchingTenantRequirement`), so it is not asked.
  const askTracking = capabilities.seesWholeCompany || capabilities.seesTeam || capabilities.seesOnlySelf

  useEffect(() => {
    let cancelled = false
    getProfile(baseUrl)
      .then((result) => {
        if (!cancelled) setProfile(result)
      })
      .catch(() => undefined)
    getNotificationPreferences(baseUrl)
      .then((result) => {
        if (!cancelled) setNotifications(result)
      })
      .catch(() => undefined)
    if (askTracking && viewer.personaExternalId) {
      listPlanesAccion()
        .then((plans) => {
          if (cancelled) return
          setResponsibleFor(
            plans
              .filter((plan) => plan.responsableEjecucionExternalId === viewer.personaExternalId)
              .map((plan) => plan.planCode)
              .sort(),
          )
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [askTracking, baseUrl, viewer.personaExternalId])

  return { profile, notifications, responsibleFor, requestExport: () => getMyDataExport(baseUrl) }
}
