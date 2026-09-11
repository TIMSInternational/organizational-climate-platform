import { describe, expect, it } from 'vitest'
import { coverage, groupRows, nodoNamesOf, type ListRow } from './planesList'

function row(code: string, over: Partial<ListRow> = {}): ListRow {
  return {
    id: code,
    code,
    que: code,
    estado: 'Verde',
    percent: 0,
    fechaCompromiso: '2026-09-15',
    daysToCompromiso: 4,
    cumplido: false,
    responsable: { id: 'p', name: null, email: null },
    nodoExternalId: 'a',
    nodoName: 'Finanzas',
    como: '',
    overdue: false,
    hasProgress: false,
    responsableIsViewer: false,
    canManage: false,
    ...over,
  }
}

describe('groupRows', () => {
  it('puts open plans under their semáforo, nearest compromiso first, and the fulfilled ones apart', () => {
    const grouped = groupRows([
      row('late', { fechaCompromiso: '2026-11-09' }),
      row('red', { estado: 'Rojo' }),
      row('soon', { fechaCompromiso: '2026-09-12' }),
      row('done', { cumplido: true, estado: 'Rojo' }),
      row('odd', { estado: 'Morado' }),
    ])
    expect(grouped.byEstado.Verde.map((entry) => entry.code)).toEqual(['soon', 'late'])
    expect(grouped.byEstado.Rojo.map((entry) => entry.code)).toEqual(['red'])
    expect(grouped.byEstado.Amarillo).toEqual([])
    expect(grouped.cumplidos.map((entry) => entry.code)).toEqual(['done'])
    expect(grouped.unknown.map((entry) => entry.code)).toEqual(['odd'])
  })
})

describe('coverage and nodoNamesOf', () => {
  const rows = [row('1', { nodoExternalId: 'b', nodoName: 'Ingeniería' }), row('2', { nodoExternalId: 'c', nodoName: 'Operaciones' }), row('3', { nodoExternalId: 'b', nodoName: 'Ingeniería' })]
  const directory = [
    { id: 'a', name: 'Finanzas' },
    { id: 'b', name: 'Ingeniería' },
    { id: 'c', name: 'Operaciones' },
  ]

  it('counts plans, the nodos that hold them, and names the directory nodos without one', () => {
    expect(coverage(rows, directory)).toEqual({ plans: 3, nodosWith: 2, nodosTotal: 3, without: ['Finanzas'] })
  })

  it('claims no total without the directory', () => {
    expect(coverage(rows, null)).toEqual({ plans: 3, nodosWith: 2, nodosTotal: null, without: [] })
  })

  it("names each nodo once, in the directory's order", () => {
    expect(nodoNamesOf(rows, ['c', 'b'])).toEqual(['Operaciones', 'Ingeniería'])
  })
})
