import { useCallback, useEffect, useMemo, useState } from 'react'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../company-context'
import { getProfile } from '../../profile/api/profile'
import { getMisTareas, type PlanAccion } from '../api/trackingApi'
import { getNodoNames } from '../api/trackingPickers'
import { todayIso } from '../planDates'
import { canManagePlan, readTrackingClaims } from '../trackingAccess'
import { toTareas, type TareaRow } from './misTareas'

export interface MisTareasState {
  status: 'loading' | 'ready' | 'error'
  /** Ordered by compromiso, nearest first — the board's "ordenadas por compromiso". */
  rows: readonly TareaRow[]
  asOf: string
  /** The reader's own nodo by name, when `GET /profile` answered — else `null`. */
  ownNodoName: string | null
  reload: () => void
}

/**
 * THE wiring seam of *Mis tareas* (`/tracking/mis-tareas`) — the MisTareas and
 * MisTareasAsignadas artboards of 10 Sep.
 *
 * ## One read, and no company parameter
 *
 * `GET /api/mis-tareas` resolves the caller from their own token and takes no company:
 * `MisTareasAsync` matches `PersonaExternalId` against each plan's responsable and
 * involucrados. Deliberately **no `useCompanyScope()` for the request** — a company picker on
 * a page about "my" tasks would imply this list could be somebody else's. The scope is read
 * only to decide whether the nodo directory may be asked at all.
 *
 * ## Names, and the one nodo a non-admin can put a name to
 *
 * The board prints the nodo that records each task's avance. `/tracking/picker/nodos` is
 * admin-only (`TrackingPickerEndpoints.cs:19-21`), so an administrator reads every nodo's
 * name from it and everybody else reads exactly one — their own department, from
 * `GET /profile`. Both are decoration and both fail silently: a name that did not arrive
 * leaves the row saying "la jefatura del nodo", never an external id and never a guess.
 */
export function useMisTareasModel(): MisTareasState {
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const withDirectory = capabilities.canUseDirectoryPickers && companyId !== undefined
  // Read once: the claims come from the stored token and do not change while the page is
  // mounted, and `readTrackingClaims()` decodes on every call.
  const claims = useMemo(() => readTrackingClaims(), [])

  const [status, setStatus] = useState<MisTareasState['status']>('loading')
  const [plans, setPlans] = useState<readonly PlanAccion[]>([])
  const [nodoNames, setNodoNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [ownNodo, setOwnNodo] = useState<{ id: string | null; name: string | null } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const asOf = useMemo(() => todayIso(), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStatus('loading')
      try {
        const tareas = await getMisTareas()
        if (cancelled) return
        setPlans(tareas)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    let cancelled = false
    if (withDirectory && companyId) {
      void getNodoNames(companyId)
        .then((names) => {
          if (!cancelled) setNodoNames(names)
        })
        .catch(() => undefined)
    } else {
      void getProfile(baseUrl)
        .then((profileResponse) => {
          if (!cancelled) setOwnNodo({ id: profileResponse.departmentId, name: profileResponse.departmentName })
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, withDirectory])

  const names = useMemo<ReadonlyMap<string, string>>(() => {
    if (nodoNames.size > 0) return nodoNames
    return ownNodo?.id && ownNodo.name ? new Map([[ownNodo.id, ownNodo.name]]) : new Map()
  }, [nodoNames, ownNodo])

  const rows = useMemo(
    () => toTareas(plans, asOf, claims?.personaExternalId ?? '', names, (plan) => canManagePlan(plan, claims)),
    [plans, asOf, claims, names],
  )

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { status, rows, asOf, ownNodoName: ownNodo?.name ?? null, reload }
}
