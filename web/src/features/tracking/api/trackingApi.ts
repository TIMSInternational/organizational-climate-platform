import { authFetch } from '../../../api/authFetch'

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

export async function getConsolidado(baseUrl: string): Promise<ConsolidadoResponse> {
  const response = await authFetch(`${baseUrl}/api/consolidado`)
  return response.json() as Promise<ConsolidadoResponse>
}

export async function getTablero(baseUrl: string, nodoId?: string): Promise<TableroResponse> {
  const query = nodoId ? `?nodoId=${encodeURIComponent(nodoId)}` : ''
  const response = await authFetch(`${baseUrl}/api/tablero-seguimiento${query}`)
  return response.json() as Promise<TableroResponse>
}

export async function getMisTareas(baseUrl: string): Promise<PlanAccion[]> {
  const response = await authFetch(`${baseUrl}/api/mis-tareas`)
  return response.json() as Promise<PlanAccion[]>
}

export async function listPlanesAccion(baseUrl: string, filters: ListPlanesAccionFilters = {}): Promise<PlanAccion[]> {
  const params = new URLSearchParams()
  if (filters.nodoId) params.set('nodoId', filters.nodoId)
  if (filters.estado) params.set('estado', filters.estado)
  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await authFetch(`${baseUrl}/api/planes-accion${query}`)
  return response.json() as Promise<PlanAccion[]>
}

export async function getPlanAccion(baseUrl: string, id: string): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}`)
  return response.json() as Promise<PlanAccion>
}

export async function createPlanAccion(baseUrl: string, input: CreatePlanAccionInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function registrarAvance(baseUrl: string, id: string, input: RegistrarAvanceInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/avance`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function marcarCumplido(baseUrl: string, id: string, input: MarcarCumplidoInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/cumplir`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}

export async function agregarInvolucrado(baseUrl: string, id: string, input: AgregarInvolucradoInput): Promise<PlanAccion> {
  const response = await authFetch(`${baseUrl}/api/planes-accion/${id}/involucrados`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<PlanAccion>
}
