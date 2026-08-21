import { describe, it, expect } from 'vitest'
import type { PlanAccion } from './api/trackingApi'
import { sortPlans } from './planOrder'

function plan(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'p1',
    planCode: 'PA-2026-00001',
    nodoExternalId: 'nodo-a',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Qué',
    metodologiaComo: 'Cómo',
    responsableEjecucionExternalId: 'persona-1',
    fechaCreacion: '2026-01-01',
    fechaCompromiso: '2026-12-01',
    porcentajeAvance: 0,
    estadoSemaforo: 'Verde',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-01-01',
    cumplido: false,
    involucradosExternalIds: [],
    ...overrides,
  }
}

describe('the work queue order', () => {
  it('puts the worst semáforo first', () => {
    const sorted = sortPlans([
      plan({ id: 'verde', estadoSemaforo: 'Verde' }),
      plan({ id: 'rojo', estadoSemaforo: 'Rojo' }),
      plan({ id: 'amarillo', estadoSemaforo: 'Amarillo' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['rojo', 'amarillo', 'verde'])
  })

  it('breaks ties on the nearest compromiso', () => {
    const sorted = sortPlans([
      plan({ id: 'later', estadoSemaforo: 'Rojo', fechaCompromiso: '2026-09-30' }),
      plan({ id: 'sooner', estadoSemaforo: 'Rojo', fechaCompromiso: '2026-02-01' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['sooner', 'later'])
  })

  it('sorts an unknown state LAST, not first', () => {
    // Ranking a word this build has never seen above Rojo would be inventing
    // urgency out of ignorance at the top of a leader's triage list.
    const sorted = sortPlans([
      plan({ id: 'unknown', estadoSemaforo: 'Naranja' }),
      plan({ id: 'verde', estadoSemaforo: 'Verde' }),
      plan({ id: 'rojo', estadoSemaforo: 'Rojo' }),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['rojo', 'verde', 'unknown'])
  })

  it('does not mutate the array it was handed', () => {
    const input = [plan({ id: 'verde', estadoSemaforo: 'Verde' }), plan({ id: 'rojo', estadoSemaforo: 'Rojo' })]
    sortPlans(input)
    expect(input.map((item) => item.id)).toEqual(['verde', 'rojo'])
  })
})
