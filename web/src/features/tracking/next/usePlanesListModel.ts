import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyScope } from '../../../company-context'
import { getProfile } from '../../profile/api/profile'
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
  /**
   * The viewer's own nodo, by name, from `GET /profile` — `null` for an administrator, who
   * has the whole directory instead, and until it answers.
   *
   * The one nodo a non-admin can put a name to. `TrackingPickerEndpoints.cs:19-21` refuses
   * them `/tracking/picker/nodos`, so without this the leader's own board could say
   * "Planes de acción" and nothing else, and every leader-specific sentence on it —
   * "Nuevo plan en Ingeniería", "el plan es de Ingeniería: registras avance" — would have
   * had to name the nodo by its external id or not at all.
   */
  ownNodoName: string | null
  /**
   * What the create form picks from (G25). An administrator's is the directory above; a node
   * leader's is the pickers' answer to them — their own nodo and its people
   * (`TrackingPickerEndpoints.ScopeFor`), asked separately so the board's names and filters
   * stay exactly what they were. `unavailable` when it was asked and did not answer.
   */
  form: { nodos: readonly NodoPickerItem[]; personas: readonly PersonaPickerItem[]; unavailable: boolean }
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
  /** A node leader: the pickers answer them with their own nodo only. */
  const withOwnNodo = !withDirectory && capabilities.leadsANodo && companyId !== undefined
  const viewer = useMemo(() => readViewer(), [])
  const [status, setStatus] = useState<PlanesListState['status']>('loading')
  const [plans, setPlans] = useState<readonly PlanAccion[]>([])
  const [nodos, setNodos] = useState<readonly NodoPickerItem[] | null>(null)
  const [personas, setPersonas] = useState<readonly PersonaPickerItem[]>([])
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false)
  const [ownNodoName, setOwnNodoName] = useState<string | null>(null)
  const [ownNodoForm, setOwnNodoForm] = useState<PlanesListState['form']>({ nodos: [], personas: [], unavailable: false })
  const [attempt, setAttempt] = useState(0)
  const asOf = useMemo(() => todayIso(), [])
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  // Only for a viewer the pickers refuse: an administrator reads every nodo's name from the
  // directory, and asking `/profile` as well would be a second source for the same fact.
  // Silent on failure, exactly as the directory reads are: a name is decoration here, and a
  // list that refused to draw because a name did not arrive would be the worse failure.
  useEffect(() => {
    if (withDirectory) return
    let cancelled = false
    void getProfile(baseUrl)
      .then((profileResponse) => {
        if (!cancelled) setOwnNodoName(profileResponse.departmentName)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [baseUrl, withDirectory])

  // The leader's create form. Its own effect, and silent beyond `unavailable`: the board does
  // not wait on it, and a refusal costs the form its dropdowns, never the list.
  useEffect(() => {
    if (!withOwnNodo || !companyId) return
    let cancelled = false
    void Promise.allSettled([listNodoOptions(companyId), listPersonaOptions(companyId)]).then(([nodoItems, personaItems]) => {
      if (cancelled) return
      setOwnNodoForm({
        nodos: nodoItems.status === 'fulfilled' ? nodoItems.value : [],
        personas: personaItems.status === 'fulfilled' ? personaItems.value : [],
        unavailable: nodoItems.status === 'rejected' || personaItems.status === 'rejected',
      })
    })
    return () => {
      cancelled = true
    }
  }, [attempt, companyId, withOwnNodo])

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

  const form = useMemo<PlanesListState['form']>(
    () =>
      withOwnNodo
        ? ownNodoForm
        : { nodos: nodos ?? [], personas, unavailable: directoryUnavailable || nodos === null },
    [directoryUnavailable, nodos, ownNodoForm, personas, withOwnNodo],
  )

  return { status, plans, nodos, personas, directoryUnavailable, ownNodoName, form, asOf, viewer, reload }
}
