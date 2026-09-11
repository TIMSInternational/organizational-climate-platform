import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { readSessionClaims } from '../../../company-context/companyContext'
import { getProfile } from '../../profile/api/profile'
import { getTrackingApiBaseUrl } from '../api/config'
import { getTablero, registrarAvance, type PlanAccion, type RegistrarAvanceInput } from '../api/trackingApi'
import { getNodoNames, listPersonaOptions, type PersonaPickerItem } from '../api/trackingPickers'
import { todayIso } from '../planDates'
import { avancesReading, byCompromiso, hasRecordedProgress, planLine } from './derive'
import type { TableroModel, TableroPlanCard } from './model'
import { readViewer } from './viewer'

/**
 * Whose board, if anyone's:
 *
 * - `choose-nodo` — an administrator with no `?nodoId=`: they have no board of their own
 *   (their claim is `unassigned-<companyId>` at best), so they choose one from the
 *   consolidado rather than being shown an empty board that says nothing about why.
 * - `no-nodo` — a leader whose `nodoId` claim names no node (the TrackingTablero
 *   artboard's "persona sin nodo asignado" variant).
 * - `restricted` — a supervisor or an employee: the board is the node leader's screen
 *   (the client's spec §7, `trackingAccess.CAN_VIEW_TABLERO_ROLES`); their tasks are in
 *   Mis tareas.
 */
export type TableroStatus = 'choose-nodo' | 'no-nodo' | 'restricted' | 'loading' | 'ready' | 'error'

export interface TableroState {
  status: TableroStatus
  model: TableroModel | null
  error: string | null
  /** An administrator looking at a nodo by id, rather than a leader at their own. */
  adminView: boolean
  reload: () => void
  /** `POST /api/planes-accion/{id}/avance`, then the board again. Rejects with the server's message. */
  recordAvance: (plan: PlanAccion, input: RegistrarAvanceInput) => Promise<void>
}

/**
 * The model behind `/tracking/tablero` — THE wiring seam of the redesigned Tablero de
 * Seguimiento.
 *
 * `GET /api/tablero-seguimiento` answers with the caller's own nodo when no `nodoId` is
 * named and refuses a non-administrator who names another (`DashboardEndpoints.TableroAsync`),
 * so a leader sends none and an administrator sends the one in the URL — the same
 * contract `pages/TableroSeguimientoPage.tsx`, kept as the wiring reference, followed.
 *
 * The nodo's NAME: an administrator reads the directory (`getNodoNames`); a leader cannot
 * (`TrackingPickerEndpoints.cs:19-21`) but their own department IS their nodo — the
 * `nodoId` claim is the department's external id (`TrackingIdentifiers.NodoIdClaimForUser`)
 * — so `GET /profile` names it when its `departmentId` is that nodo.
 *
 * Nothing here is sample-fed. The fourth tile reads the avances off the plans themselves
 * (`derive.avancesReading`): `PlanResponse` carries no bitácora, so the board says how many
 * plans have an avance on record and when the latest was, never a count of entries it
 * cannot see.
 */
export function useTableroModel(): TableroState {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const viewer = useMemo(() => readViewer(), [])
  const role = useMemo(() => readSessionClaims().role, [])

  const adminView = capabilities.canViewConsolidado
  // Trimmed and normalised: `?nodoId=` with nothing after it is not a choice.
  const nodoId = searchParams.get('nodoId')?.trim() || null
  const gate: TableroStatus | null = adminView
    ? nodoId === null
      ? 'choose-nodo'
      : null
    : capabilities.leadsANodo
      ? null
      : role === 'leader'
        ? 'no-nodo'
        : 'restricted'
  const withDirectory = capabilities.canUseDirectoryPickers && companyId !== undefined

  const [model, setModel] = useState<TableroModel | null>(null)
  const [status, setStatus] = useState<TableroStatus>(gate ?? 'loading')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (gate !== null) {
      setStatus(gate)
      return
    }
    setStatus('loading')
    setError(null)
    const noDirectory = Promise.reject(new Error('directory not asked'))
    noDirectory.catch(() => undefined)
    const [tablero, names, personas, profile] = await Promise.allSettled([
      getTablero(getTrackingApiBaseUrl(), adminView ? (nodoId ?? undefined) : undefined),
      withDirectory && companyId ? getNodoNames(companyId) : noDirectory,
      withDirectory && companyId ? listPersonaOptions(companyId) : noDirectory,
      withDirectory ? noDirectory : getProfile(baseUrl),
    ])
    if (tablero.status === 'rejected') {
      const reason: unknown = tablero.reason
      setModel(null)
      setError(reason instanceof Error ? reason.message : t('errors.generic'))
      setStatus('error')
      return
    }
    const board = tablero.value
    const asOf = todayIso()
    const directory = new Map<string, PersonaPickerItem>(
      personas.status === 'fulfilled' ? personas.value.map((persona) => [persona.id, persona]) : [],
    )
    const nodoName =
      names.status === 'fulfilled'
        ? (names.value.get(board.nodoExternalId) ?? null)
        : profile.status === 'fulfilled' && profile.value.departmentId === board.nodoExternalId
          ? profile.value.departmentName
          : null
    const plans: TableroPlanCard[] = board.planes
      .map((plan) => ({
        ...planLine(plan, asOf, directory, viewer),
        fechaCreacion: plan.fechaCreacion,
        fechaUltimaActualizacion: plan.fechaUltimaActualizacion,
        hasProgress: hasRecordedProgress(plan),
        responsableIsViewer:
          plan.responsableEjecucionExternalId !== '' && plan.responsableEjecucionExternalId === viewer.personaExternalId,
        plan,
      }))
      .sort(byCompromiso)
    setModel({
      asOf,
      nodoExternalId: board.nodoExternalId,
      nodoName,
      conteos: board.conteos,
      plans,
      avances: avancesReading(board.planes),
    })
    setStatus('ready')
  }, [adminView, baseUrl, companyId, gate, nodoId, t, viewer, withDirectory])

  useEffect(() => {
    void reload()
  }, [reload])

  const recordAvance = useCallback(
    async (plan: PlanAccion, input: RegistrarAvanceInput) => {
      await registrarAvance(plan.id, input)
      await reload()
    },
    [reload],
  )

  return {
    status,
    model,
    error,
    adminView,
    reload: () => {
      void reload()
    },
    recordAvance,
  }
}
