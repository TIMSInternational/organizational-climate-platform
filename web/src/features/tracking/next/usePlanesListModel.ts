import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { listPlanesAccion, type PlanAccion } from '../api/trackingApi'
import { listNodoOptions, listPersonaOptions, type NodoPickerItem, type PersonaPickerItem } from '../api/trackingPickers'
import { todayIso } from '../planDates'
import { readViewer } from './viewer'
import type { Viewer } from './derive'

export interface PlanesListState {
  status: 'loading' | 'ready' | 'error'
  plans: readonly PlanAccion[]
  /** The nodo directory; `null` when this viewer may not ask it or it was refused. */
  nodos: readonly NodoPickerItem[] | null
  /** The persona directory; `[]` when this viewer may not ask it or it was refused. */
  personas: readonly PersonaPickerItem[]
  /** An administrator's directory was asked and did not answer — the create form says so. */
  directoryUnavailable: boolean
  asOf: string
  viewer: Viewer
  reload: () => void
}

/**
 * THE wiring seam of *Planes de acción* (`/tracking/planes`): the reads the old
 * `PlanesAccionListPage` made — `GET /api/planes-accion` (the service scopes it: the tenant
 * for an administrator, the caller's nodo, plans they answer for or take part in for anyone
 * else) and, only for a viewer the pickers answer (`canUseDirectoryPickers`,
 * `TrackingPickerEndpoints.cs:19-21`), `GET /tracking/picker/nodos` and `/personas` to name
 * nodos and responsables. A directory failure leaves the list: ids are then unnamed, not guessed.
 */
export function usePlanesListModel(): PlanesListState {
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const withDirectory = capabilities.canUseDirectoryPickers && companyId !== undefined
  const viewer = useMemo(() => readViewer(), [])
  const [status, setStatus] = useState<PlanesListState['status']>('loading')
  const [plans, setPlans] = useState<readonly PlanAccion[]>([])
  const [nodos, setNodos] = useState<readonly NodoPickerItem[] | null>(null)
  const [personas, setPersonas] = useState<readonly PersonaPickerItem[]>([])
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const asOf = useMemo(() => todayIso(), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStatus('loading')
      const noDirectory = Promise.reject(new Error('directory not asked'))
      noDirectory.catch(() => undefined)
      const [planes, nodoItems, personaItems] = await Promise.allSettled([
        listPlanesAccion(),
        withDirectory && companyId ? listNodoOptions(companyId) : noDirectory,
        withDirectory && companyId ? listPersonaOptions(companyId) : noDirectory,
      ])
      if (cancelled) return
      if (planes.status === 'rejected') {
        setStatus('error')
        return
      }
      setPlans(planes.value)
      setNodos(nodoItems.status === 'fulfilled' ? nodoItems.value : null)
      setPersonas(personaItems.status === 'fulfilled' ? personaItems.value : [])
      setDirectoryUnavailable(withDirectory && (nodoItems.status === 'rejected' || personaItems.status === 'rejected'))
      setStatus('ready')
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [attempt, companyId, withDirectory])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { status, plans, nodos, personas, directoryUnavailable, asOf, viewer, reload }
}
