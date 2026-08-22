import { authFetch } from '../../../api/authFetch'
import { getTrackingApiBaseUrl } from './config'

// The client for climate-tracking. Both of the warnings that stood here are now out of
// date, and both are replaced rather than deleted so the next reader does not re-derive
// them from scratch.
//
// **CORS.** The old note said "climate-tracking has no CORS configuration today" and
// "don't build UI that depends on this client succeeding". The configuration exists:
// `ClimateTracking.Api/Program.cs` calls `AddCors()`, builds a "Frontend" policy from
// `Cors:AllowedOrigins` with `AllowAnyHeader().AllowAnyMethod()`, and `UseCors("Frontend")`
// runs ahead of authentication. What is still on the deployer is the LIST: `appsettings.json`
// ships `Cors:AllowedOrigins` as an empty array and nothing in this repo's `infra/` deploys
// the tracking service at all, so each environment must put this frontend's origin in
// `Cors__AllowedOrigins__0` there. `authFetch` always sets Authorization and
// `Content-Type: application/json`, so every call here is preflighted and an unlisted origin
// fails at the preflight rather than at the request. See `web/.env.example`.
//
// **Callers.** "No page in this repo calls this client yet" was true when the tracking-page
// UI was scoped out; #126 brought it in. `features/tracking/pages/` — the plans listing, the
// plan detail and mis-tareas — are the callers now.
//
// Each export defaults `baseUrl` to `getTrackingApiBaseUrl()` (reads
// VITE_TRACKING_API_BASE_URL, see ./config.ts), so a page calls these with zero wiring and
// passes an explicit `baseUrl` only to override it (e.g. in tests).
// trackingApi.live.test.ts is an opt-in test, skipped unless TRACKING_API_LIVE_URL is set,
// for verifying this client against a real running climate-tracking instance; the tests in
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

export async function getPlanAccion(id: string, baseUrl: string = getTrackingApiBaseUrl()): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}`)
  return response.json() as Promise<PlanAccion>
}

export async function createPlanAccion(input: CreatePlanAccionInput, baseUrl: string = getTrackingApiBaseUrl()): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function registrarAvance(id: string, input: RegistrarAvanceInput, baseUrl: string = getTrackingApiBaseUrl()): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/avance`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function marcarCumplido(id: string, input: MarcarCumplidoInput, baseUrl: string = getTrackingApiBaseUrl()): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/cumplir`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function agregarInvolucrado(id: string, input: AgregarInvolucradoInput, baseUrl: string = getTrackingApiBaseUrl()): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/involucrados`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}
