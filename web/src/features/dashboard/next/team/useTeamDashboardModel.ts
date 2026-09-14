import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { getDepartmentAdminDashboard, type DepartmentAdminDashboardResult } from '../../api/dashboard'
import { useDashboardData, type DashboardData } from '../../useDashboardData'
import { listMySurveys } from '../../../surveys/api/surveys'
import { getMisTareas, getTablero } from '../../../tracking/api/trackingApi'
import { isTrackingEnabled } from '../../../tracking/api/config'
import { readViewer } from '../../../tracking/next/viewer'
import { CLIMATE_TARGET } from '../compose'
import { ORGANIZATION_SAMPLE } from './sampleModel'
import { composeLeaderDashboard, composeSupervisorDashboard, type TrackingRead } from './compose'
import type { LeaderDashboardModel, SupervisorDashboardModel } from './model'

/**
 * What the page draws before the model: the department read is the page's reason, so its
 * outcome decides the whole screen — a skeleton, the error band with a retry, the employee
 * Home for a person with no department (#138), or the one true sentence for a token with no
 * user row at all. `ready` is the only gate with a model behind it.
 */
export type TeamGate = 'loading' | 'failed' | 'no-department' | 'no-user-record' | 'ready'

export interface TeamDashboardState<M> {
  gate: TeamGate
  /** `null` until every read the page waits for has settled. */
  model: M | null
  error: string | null
  reload: () => void
}

function gateOf(department: DashboardData<DepartmentAdminDashboardResult>): TeamGate {
  if (department.failed) return 'failed'
  if (department.data === null) return 'loading'
  if (department.data.kind === 'no-department') return 'no-department'
  if (department.data.kind === 'no-user-record') return 'no-user-record'
  return 'ready'
}

/**
 * `GET /dashboard/department-admin`, with **no department id**: the server reads the
 * caller's own user row (`DashboardEndpoints.LoadDepartmentAdminAsync`), because people move
 * teams and a token minted before a transfer would keep serving the old team. Naming a
 * department would be a scope the client chose, and the server refuses one that is not the
 * caller's own. The same contract `DepartmentAdminDashboardView` — the wiring reference —
 * followed.
 */
function useDepartment(): DashboardData<DepartmentAdminDashboardResult> {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const load = useCallback(() => getDepartmentAdminDashboard(baseUrl, { lang: locale }), [baseUrl, locale])
  return useDashboardData(load)
}

/**
 * One read of the tracking service, settled into a `TrackingRead`: `off` without asking
 * when `enabled` is false, `null` while the request is out, then `ok` or `failed`. Keyed by
 * `nonce`, so a reload never shows the previous answer as the new one.
 */
function useTrackingRead<T>(enabled: boolean, read: () => Promise<T>, nonce: number): TrackingRead<T> | null {
  const [settled, setSettled] = useState<{ nonce: number; read: TrackingRead<T> } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    read()
      .then((value) => {
        if (!cancelled) setSettled({ nonce, read: { status: 'ok', value } })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setSettled({ nonce, read: { status: 'failed', error: reason instanceof Error ? reason.message : null } })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, read, nonce])
  if (!enabled) return { status: 'off' }
  return settled !== null && settled.nonce === nonce ? settled.read : null
}

/**
 * **The wiring seam of the leader's Panel de Control** (the canvas's LeaderDashboard).
 * The view below it never fetches.
 *
 * | Region                                   | Endpoint                                    |
 * |------------------------------------------|---------------------------------------------|
 * | the three tiles, the team's reading, the open wave's participation | `GET /dashboard/department-admin` |
 * | the organisation's side of the comparison | none for this role — `sampleModel.ts`        |
 * | "El plan que atiende al equipo"          | `GET /api/tablero-seguimiento` (own nodo)  |
 *
 * The board is read only when this deployment has a tracking service AND the reader leads a
 * real nodo (`viewerCapabilities.leadsANodo`): `TableroAsync` answers anyone else with an
 * empty board, which is the API telling the truth to the wrong person. Without it the card
 * counts the department payload's action plans instead. The page does not wait for the
 * board: its card shows its own loading state, so a slow tracking service never blanks the
 * team's reading.
 */
export function useLeaderDashboardModel(): TeamDashboardState<LeaderDashboardModel> {
  const department = useDepartment()
  const capabilities = useViewerCapabilities()
  const trackingOn = isTrackingEnabled()
  const [nonce, setNonce] = useState(0)
  // No `nodoId`: the service answers a non-administrator with their own nodo.
  const readBoard = useCallback(() => getTablero(), [])
  const tablero = useTrackingRead(trackingOn && capabilities.leadsANodo, readBoard, nonce)
  const viewer = useMemo(() => readViewer(), [])
  // The clock the day counts are measured against, read once per mount.
  const [asOf] = useState(() => new Date().toISOString())
  const { data, reload: reloadDepartment } = department

  const model = useMemo(() => {
    if (data?.kind !== 'department') return null
    return composeLeaderDashboard({
      department: data.dashboard,
      organization: ORGANIZATION_SAMPLE,
      tablero,
      trackingOn,
      viewer,
      asOf,
      target: CLIMATE_TARGET,
    })
  }, [asOf, data, tablero, trackingOn, viewer])

  return {
    gate: gateOf(department),
    model,
    error: department.error,
    reload: () => {
      reloadDepartment()
      setNonce((n) => n + 1)
    },
  }
}

/**
 * **The wiring seam of the supervisor's Panel de Control** — the canvas's
 * SupervisorDashboard, drawn as a proposal while the ruling on the role is pending.
 *
 * | Region                        | Endpoint                          |
 * |-------------------------------|-----------------------------------|
 * | "Cobertura de la encuesta abierta" | `GET /dashboard/department-admin` |
 * | "Los planes que ejecutas"     | `GET /api/mis-tareas`             |
 * | "Tus tareas" — the surveys owed | `GET /surveys/my`                 |
 *
 * `mis-tareas` is exactly "the plans you execute": the service lists the plans whose
 * responsable or involucrados include the caller (`DashboardEndpoints.MisTareasAsync` in the
 * tracking service). Nothing here is sample-fed, so this page wears no sample chip.
 *
 * The surveys she owes come from `/surveys/my`, her own self-service list, and not from
 * `GET /dashboard/employee`: a role's page asks exactly one role dashboard endpoint, its
 * own (`DashboardPage.test.tsx` guards that). That read feeds only the task list, so its
 * failure drops those tasks and says so in a sentence; it never takes the coverage card down.
 */
export function useSupervisorDashboardModel(): TeamDashboardState<SupervisorDashboardModel> {
  const department = useDepartment()
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const loadPending = useCallback(() => listMySurveys(baseUrl, locale), [baseUrl, locale])
  const pending = useDashboardData(loadPending)
  const capabilities = useViewerCapabilities()
  const trackingOn = isTrackingEnabled()
  const [nonce, setNonce] = useState(0)
  const readTasks = useCallback(() => getMisTareas(), [])
  const misTareas = useTrackingRead(trackingOn, readTasks, nonce)
  const viewer = useMemo(() => readViewer(), [])
  const [asOf] = useState(() => new Date().toISOString())
  const { data, reload: reloadDepartment } = department
  const pendingSettled = pending.data !== null || pending.failed
  const { canRecordProgress } = capabilities

  const model = useMemo(() => {
    if (data?.kind !== 'department' || !pendingSettled || misTareas === null) return null
    return composeSupervisorDashboard({
      department: data.dashboard,
      mySurveys: pending.failed ? null : pending.data,
      misTareas,
      trackingOn,
      mayRecord: canRecordProgress,
      viewer,
      asOf,
    })
  }, [asOf, canRecordProgress, data, misTareas, pending.data, pending.failed, pendingSettled, trackingOn, viewer])

  return {
    gate: gateOf(department),
    model,
    error: department.error,
    reload: () => {
      reloadDepartment()
      pending.reload()
      setNonce((n) => n + 1)
    },
  }
}
