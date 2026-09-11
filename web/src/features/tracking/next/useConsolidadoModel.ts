import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { getConsolidado, listPlanesAccion, type ConsolidadoResponse, type PlanAccion } from '../api/trackingApi'
import { getNodoNames, listPersonaOptions, type PersonaPickerItem } from '../api/trackingPickers'
import { todayIso } from '../planDates'
import { byCompromiso, planLine } from './derive'
import type { ConsolidadoModel, NodoBlock } from './model'
import { readViewer } from './viewer'

export interface ConsolidadoState {
  /** `restricted` for a viewer `GET /api/consolidado` would refuse — no request is made. */
  status: 'restricted' | 'loading' | 'ready' | 'error'
  model: ConsolidadoModel | null
  error: string | null
  reload: () => void
}

/**
 * `GET /consolidado` widened by the one field #125 says renders here, as the page this
 * replaced declared it (`pages/ConsolidadoPage.tsx`, `NodoRow`): absent today, read the
 * moment the service adds it.
 */
type NodoRow = ConsolidadoResponse['porNodo'][number] & { resultadoAnioAnteriorPct?: number | null }

/**
 * The model behind `/tracking` — THE wiring seam of the redesigned Vista Consolidada.
 *
 * - `GET /api/consolidado` — the counts per nodo and for the company. The one request the
 *   screen depends on: its failure is the screen's error state.
 * - `GET /api/planes-accion` — an administrator gets the whole tenant
 *   (`PlanesAccionEndpoints.ListAsync`), grouped here under each nodo so the sheet shows
 *   what each plan is, how far along and when it is due. Failure costs the plan rows,
 *   never the counts.
 * - the nodo and persona directories (`/tracking/picker/*`, climate-project's API) — names
 *   only, silent on failure, asked only when the seam says the viewer may use them.
 *
 * Nothing on this screen can identify a respondent: these are action plans, assignments a
 * jefatura made, and the payloads carry no answer, score or respondent at all (see the
 * module comment of `pages/ConsolidadoPage.tsx`, kept as the wiring reference).
 */
export function useConsolidadoModel(): ConsolidadoState {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const allowed = capabilities.canViewConsolidado
  const withDirectory = capabilities.canUseDirectoryPickers && companyId !== undefined
  const viewer = useMemo(() => readViewer(), [])

  const [model, setModel] = useState<ConsolidadoModel | null>(null)
  const [status, setStatus] = useState<ConsolidadoState['status']>(allowed ? 'loading' : 'restricted')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!allowed) {
      setStatus('restricted')
      return
    }
    setStatus('loading')
    setError(null)
    const noDirectory = Promise.reject(new Error('directory not asked'))
    noDirectory.catch(() => undefined)
    const [consolidado, planes, nodoNames, personas] = await Promise.allSettled([
      getConsolidado(),
      listPlanesAccion(),
      withDirectory && companyId ? getNodoNames(companyId) : noDirectory,
      withDirectory && companyId ? listPersonaOptions(companyId) : noDirectory,
    ])
    if (consolidado.status === 'rejected') {
      const reason: unknown = consolidado.reason
      // A retry that fails must not leave the previous good table under the error.
      setModel(null)
      setError(reason instanceof Error ? reason.message : t('errors.generic'))
      setStatus('error')
      return
    }
    const asOf = todayIso()
    const names: ReadonlyMap<string, string> = nodoNames.status === 'fulfilled' ? nodoNames.value : new Map()
    const directory = new Map<string, PersonaPickerItem>(
      personas.status === 'fulfilled' ? personas.value.map((persona) => [persona.id, persona]) : [],
    )
    const plansByNodo = new Map<string, PlanAccion[]>()
    if (planes.status === 'fulfilled') {
      for (const plan of planes.value) {
        const list = plansByNodo.get(plan.nodoExternalId) ?? []
        list.push(plan)
        plansByNodo.set(plan.nodoExternalId, list)
      }
    }
    const rows: NodoRow[] = consolidado.value.porNodo
    const nodos: NodoBlock[] = rows.map((row) => ({
      nodoExternalId: row.nodoExternalId,
      name: names.get(row.nodoExternalId) ?? null,
      conteos: row.conteos,
      totalPlanes: row.totalPlanes,
      plans:
        planes.status === 'fulfilled'
          ? (plansByNodo.get(row.nodoExternalId) ?? []).map((plan) => planLine(plan, asOf, directory, viewer)).sort(byCompromiso)
          : null,
      resultadoAnioAnteriorPct: row.resultadoAnioAnteriorPct,
    }))
    setModel({
      asOf,
      consultedAt: Date.now(),
      conteos: consolidado.value.conteos,
      nodos,
      directoryNodoCount: nodoNames.status === 'fulfilled' ? nodoNames.value.size : null,
    })
    setStatus('ready')
  }, [allowed, companyId, t, viewer, withDirectory])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    status,
    model,
    error,
    reload: () => {
      void reload()
    },
  }
}
