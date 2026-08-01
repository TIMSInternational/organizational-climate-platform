import { authFetch } from '../../../api/authFetch'
import { getTrackingApiBaseUrl } from './config'

// NOT YET USABLE FROM A BROWSER IN PRODUCTION: climate-tracking has no CORS configuration
// today, and authFetch always sets both Authorization and Content-Type: application/json,
// which forces a preflight on every cross-origin call this client makes. Every export
// below will fail until climate-tracking's CORS policy allows this frontend's origin(s) --
// tracked as #56's Plan B (climate-tracking-side change, not fixable here). Don't build UI
// that depends on this client succeeding until that lands. See
// docs/superpowers/specs/2026-07-31-tracking-integration-design.md ("Requires: ...CORS...").
//
// No page in this repo calls this client yet -- the plan's own "Global Constraints"
// explicitly scope tracking-page UI out of this plan, so there's deliberately no caller
// here (not an oversight). Each export still defaults `baseUrl` to
// `getTrackingApiBaseUrl()` (reads VITE_TRACKING_API_BASE_URL, see ./config.ts) so a future
// page can call these with zero wiring, and pass an explicit `baseUrl` only to override it
// (e.g. in tests). trackingApi.live.test.ts is an opt-in test, skipped unless
// TRACKING_API_LIVE_URL is set, for verifying this client against a real running
// climate-tracking instance once CORS is configured there -- the 9 tests in
// trackingApi.test.ts only ever exercise a stubbed fetch.

export interface SemaforoCounts {
  rojo: number
  amarillo: number
  verde: number
}

export interface PlanAccion {
  id: string
  planCode: string
  nodoExternalId: string
  liderExternalId: string
  hallazgoExternalId: string | null
  descripcionQue: string
  metodologiaComo: string
  responsableEjecucionExternalId: string
  fechaCreacion: string
  fechaCompromiso: string
  porcentajeAvance: number
  estadoSemaforo: string
  cicloEncuestaExternalId: string | null
  fechaUltimaActualizacion: string
  cumplido: boolean
  involucradosExternalIds: string[]
}

export interface TableroResponse {
  nodoExternalId: string
  conteos: SemaforoCounts
  planes: PlanAccion[]
}

export interface NodoConsolidado {
  nodoExternalId: string
  conteos: SemaforoCounts
  totalPlanes: number
}

export interface ConsolidadoResponse {
  conteos: SemaforoCounts
  porNodo: NodoConsolidado[]
}

export interface CreatePlanAccionInput {
  nodoExternalId: string
  hallazgoExternalId?: string | null
  descripcionQue: string
  metodologiaComo: string
  responsableEjecucionExternalId: string
  fechaCompromiso: string
  involucrados?: string[] | null
}

export interface RegistrarAvanceInput {
  porcentajeAvance: number
  comentario?: string | null
  fecha: string
}

export interface MarcarCumplidoInput {
  fecha: string
}

export interface AgregarInvolucradoInput {
  personaExternalId: string
}

export interface ListPlanesAccionFilters {
  nodoId?: string
  estado?: string
}

export async function getConsolidado(baseUrl: string = getTrackingApiBaseUrl()): Promise<ConsolidadoResponse> {
  const response = await authFetch(`${baseUrl}/api/consolidado`)
  return response.json() as Promise<ConsolidadoResponse>
}

export async function getTablero(baseUrl: string = getTrackingApiBaseUrl(), nodoId?: string): Promise<TableroResponse> {
  const query = nodoId ? `?nodoId=${encodeURIComponent(nodoId)}` : ''
  const response = await authFetch(`${baseUrl}/api/tablero-seguimiento${query}`)
  return response.json() as Promise<TableroResponse>
}

export async function getMisTareas(baseUrl: string = getTrackingApiBaseUrl()): Promise<PlanAccion[]> {
  const response = await authFetch(`${baseUrl}/api/mis-tareas`)
  return response.json() as Promise<PlanAccion[]>
}

export async function listPlanesAccion(baseUrl: string = getTrackingApiBaseUrl(), filters: ListPlanesAccionFilters = {}): Promise<PlanAccion[]> {
  const params = new URLSearchParams()
  if (filters.nodoId) params.set('nodoId', filters.nodoId)
  if (filters.estado) params.set('estado', filters.estado)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await authFetch(`${baseUrl}/api/planes-accion${query}`)
  return response.json() as Promise<PlanAccion[]>
}

export async function getPlanAccion(baseUrl: string = getTrackingApiBaseUrl(), id: string): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}`)
  return response.json() as Promise<PlanAccion>
}

export async function createPlanAccion(baseUrl: string = getTrackingApiBaseUrl(), input: CreatePlanAccionInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function registrarAvance(baseUrl: string = getTrackingApiBaseUrl(), id: string, input: RegistrarAvanceInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/avance`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function marcarCumplido(baseUrl: string = getTrackingApiBaseUrl(), id: string, input: MarcarCumplidoInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/cumplir`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function agregarInvolucrado(baseUrl: string = getTrackingApiBaseUrl(), id: string, input: AgregarInvolucradoInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/involucrados`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}
