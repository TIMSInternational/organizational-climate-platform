import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  getConsolidado,
  getTablero,
  getMisTareas,
  listPlanesAccion,
  getPlanAccion,
  createPlanAccion,
  registrarAvance,
  marcarCumplido,
  agregarInvolucrado,
} from './trackingApi'

const baseUrl = 'http://tracking.test'

const samplePlan = {
  id: 'p1',
  planCode: 'PA-2026-00001',
  nodoExternalId: 'n1',
  liderExternalId: 'l1',
  hallazgoExternalId: null,
  descripcionQue: 'Improve onboarding',
  metodologiaComo: 'Weekly check-ins',
  responsableEjecucionExternalId: 'r1',
  fechaCreacion: '2026-08-01',
  fechaCompromiso: '2026-09-01',
  porcentajeAvance: 0,
  estadoSemaforo: 'Verde',
  cicloEncuestaExternalId: null,
  fechaUltimaActualizacion: '2026-08-01',
  cumplido: false,
  involucradosExternalIds: [],
}

describe('trackingApi client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('gets consolidado', async () => {
    const result = { conteos: { rojo: 1, amarillo: 2, verde: 3 }, porNodo: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await getConsolidado(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/consolidado`, expect.anything())
    expect(response.conteos.verde).toBe(3)
  })

  it('gets tablero with an optional nodoId filter', async () => {
    const result = { nodoExternalId: 'n1', conteos: { rojo: 0, amarillo: 0, verde: 1 }, planes: [samplePlan] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await getTablero(baseUrl, 'n1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/tablero-seguimiento?nodoId=n1`, expect.anything())
    expect(response.planes).toHaveLength(1)
  })

  it('gets mis tareas', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([samplePlan]), { status: 200 }))

    const response = await getMisTareas(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/mis-tareas`, expect.anything())
    expect(response).toHaveLength(1)
  })

  it('lists planes de accion with filters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([samplePlan]), { status: 200 }))

    await listPlanesAccion(baseUrl, { nodoId: 'n1', estado: 'Verde' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion?nodoId=n1&estado=Verde`, expect.anything())
  })

  it('gets a single plan de accion', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(samplePlan), { status: 200 }))

    const response = await getPlanAccion('p1', baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1`, expect.anything())
    expect(response.id).toBe('p1')
  })

  it('creates a plan de accion', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(samplePlan), { status: 201 }))

    await createPlanAccion({
      nodoExternalId: 'n1',
      descripcionQue: 'Improve onboarding',
      metodologiaComo: 'Weekly check-ins',
      responsableEjecucionExternalId: 'r1',
      fechaCompromiso: '2026-09-01',
    }, baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion`, expect.objectContaining({ method: 'POST' }))
  })

  it('registers avance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...samplePlan, porcentajeAvance: 50 }), { status: 200 }))

    const response = await registrarAvance('p1', { porcentajeAvance: 50, fecha: '2026-08-15' }, baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1/avance`, expect.objectContaining({ method: 'POST' }))
    expect(response.porcentajeAvance).toBe(50)
  })

  it('marks a plan as cumplido', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...samplePlan, cumplido: true }), { status: 200 }))

    const response = await marcarCumplido('p1', { fecha: '2026-09-01' }, baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1/cumplir`, expect.objectContaining({ method: 'POST' }))
    expect(response.cumplido).toBe(true)
  })

  it('adds an involucrado', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...samplePlan, involucradosExternalIds: ['p2'] }), { status: 200 }))

    const response = await agregarInvolucrado('p1', { personaExternalId: 'p2' }, baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/planes-accion/p1/involucrados`, expect.objectContaining({ method: 'POST' }))
    expect(response.involucradosExternalIds).toContain('p2')
  })

  // Regression test for the finding that VITE_TRACKING_API_BASE_URL was added to
  // web/.env.example but never actually read anywhere in web/src -- every export took
  // baseUrl as a required explicit argument with no default, so the env var was decorative.
  it('defaults baseUrl to VITE_TRACKING_API_BASE_URL when no explicit baseUrl is passed', async () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', 'http://tracking.env.test')
    const result = { conteos: { rojo: 0, amarillo: 0, verde: 0 }, porNodo: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    await getConsolidado()

    expect(fetch).toHaveBeenCalledWith('http://tracking.env.test/api/consolidado', expect.anything())
  })
})
