import { describe, it, expect } from 'vitest'
import type { PlanAccion } from '../api/trackingApi'
import {
  byCompromiso,
  dayDiff,
  hasRecordedProgress,
  initials,
  isNotFound,
  isOverdue,
  leadingEstado,
  nextCompromiso,
  nodosIn,
  planLine,
  resolvePersona,
} from './derive'

/** PA-2026-00001 exactly as the local tracking service answered it on 10 Sep. */
const PLAN_00001: PlanAccion = {
  id: '01a08b9e-6367-75aa-942c-1ec0efd04176',
  planCode: 'PA-2026-00001',
  nodoExternalId: 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9',
  liderExternalId: '',
  hallazgoExternalId: null,
  descripcionQue: 'Reponer la reunión de handover entre turnos',
  metodologiaComo: 'Sesión de 20 minutos al cierre de cada turno, con acta breve.',
  responsableEjecucionExternalId: '77fbfc92-76bb-452e-8be3-8ae588464994',
  fechaCreacion: '2026-09-10',
  fechaCompromiso: '2026-08-20',
  porcentajeAvance: 0,
  estadoSemaforo: 'Rojo',
  cicloEncuestaExternalId: null,
  fechaUltimaActualizacion: '2026-09-10',
  cumplido: false,
  involucradosExternalIds: ['77fbfc92-76bb-452e-8be3-8ae588464994'],
}

const ASOF = '2026-09-10'
const DIRECTORY = new Map([
  ['77fbfc92-76bb-452e-8be3-8ae588464994', { id: '77fbfc92-76bb-452e-8be3-8ae588464994', name: 'Adriana Marín', email: 'adriana.marin@meridiano.test' }],
])
const NOBODY = { personaExternalId: '', name: null }

describe('days and deadlines', () => {
  it('counts whole calendar days between two DateOnly strings', () => {
    expect(dayDiff('2026-09-10', '2026-08-20')).toBe(-21)
    expect(dayDiff('2026-09-10', '2026-09-15')).toBe(5)
  })

  it('reads a plan whose compromiso has gone by as overdue, one due today as not, and a cumplido one never', () => {
    expect(isOverdue(PLAN_00001, ASOF)).toBe(true)
    expect(isOverdue({ ...PLAN_00001, fechaCompromiso: ASOF }, ASOF)).toBe(false)
    expect(isOverdue({ ...PLAN_00001, cumplido: true }, ASOF)).toBe(false)
  })
})

describe('hasRecordedProgress', () => {
  it('reads no avance off a plan exactly as creation left it', () => {
    expect(hasRecordedProgress(PLAN_00001)).toBe(false)
  })

  it('reads an avance off a percentage above zero, or a last update after creation', () => {
    expect(hasRecordedProgress({ ...PLAN_00001, porcentajeAvance: 0.25 })).toBe(true)
    expect(hasRecordedProgress({ ...PLAN_00001, fechaUltimaActualizacion: '2026-09-12' })).toBe(true)
  })
})

describe('resolvePersona', () => {
  it('names a person from the directory', () => {
    expect(resolvePersona(PLAN_00001.responsableEjecucionExternalId, DIRECTORY, NOBODY)).toEqual({
      id: PLAN_00001.responsableEjecucionExternalId,
      name: 'Adriana Marín',
      email: 'adriana.marin@meridiano.test',
    })
  })

  it('names the viewer themselves without the directory, and nobody else', () => {
    const viewer = { personaExternalId: 'me', name: 'Luis Mora' }
    expect(resolvePersona('me', new Map(), viewer).name).toBe('Luis Mora')
    expect(resolvePersona('someone-else', new Map(), viewer).name).toBeNull()
  })

  it('never matches a blank id to a blank viewer', () => {
    expect(resolvePersona('', new Map(), { personaExternalId: '', name: 'X' }).name).toBeNull()
  })
})

describe('planLine', () => {
  it('converts the wire fraction to whole percentage points once, through toPercent', () => {
    expect(planLine({ ...PLAN_00001, porcentajeAvance: 0.4 }, ASOF, DIRECTORY, NOBODY).percent).toBe(40)
    expect(planLine({ ...PLAN_00001, porcentajeAvance: 0.07 }, ASOF, DIRECTORY, NOBODY).percent).toBe(7)
  })

  it('carries the days to the compromiso and the resolved responsable', () => {
    const line = planLine(PLAN_00001, ASOF, DIRECTORY, NOBODY)
    expect(line.daysToCompromiso).toBe(-21)
    expect(line.responsable.name).toBe('Adriana Marín')
  })
})

describe('ordering and summaries', () => {
  it('orders by compromiso, nearest first', () => {
    const lines = [
      { code: 'B', fechaCompromiso: '2026-11-09' },
      { code: 'A', fechaCompromiso: '2026-09-15' },
    ].sort(byCompromiso)
    expect(lines.map((l) => l.code)).toEqual(['A', 'B'])
  })

  it('names the nodos holding a state, and leads the board tile with the worst state present', () => {
    const nodos = [
      { name: 'Finanzas', conteos: { rojo: 1, amarillo: 0, verde: 0 } },
      { name: 'Ingeniería', conteos: { rojo: 0, amarillo: 0, verde: 1 } },
      { name: 'Operaciones', conteos: { rojo: 0, amarillo: 0, verde: 1 } },
    ]
    expect(nodosIn(nodos, 'Verde')).toEqual(['Ingeniería', 'Operaciones'])
    expect(leadingEstado({ rojo: 0, amarillo: 0, verde: 1 })).toBe('Verde')
    expect(leadingEstado({ rojo: 1, amarillo: 0, verde: 4 })).toBe('Rojo')
    expect(leadingEstado({ rojo: 0, amarillo: 0, verde: 0 })).toBeNull()
  })

  it('takes the nearest compromiso still ahead, and the earliest past one only when none is ahead', () => {
    const plans = [
      { code: 'A', fechaCompromiso: '2026-08-20', cumplido: false, daysToCompromiso: -21 },
      { code: 'B', fechaCompromiso: '2026-09-15', cumplido: false, daysToCompromiso: 5 },
    ]
    expect(nextCompromiso(plans)?.code).toBe('B')
    expect(nextCompromiso([plans[0]])?.code).toBe('A')
    expect(nextCompromiso([{ ...plans[1], cumplido: true }])).toBeNull()
  })

  it('makes initials from a name', () => {
    expect(initials('Adriana Marín')).toBe('AM')
    expect(initials('Ana')).toBe('A')
  })
})

describe('isNotFound', () => {
  it('reads the 404 authFetch reports for an empty body', () => {
    expect(isNotFound(new Error('Request failed: 404'))).toBe(true)
    expect(isNotFound(new Error('Request failed: 500'))).toBe(false)
    expect(isNotFound('404')).toBe(false)
  })
})
