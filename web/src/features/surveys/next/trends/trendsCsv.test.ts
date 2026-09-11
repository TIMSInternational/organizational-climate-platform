import { describe, it, expect } from 'vitest'
import { buildTrendsCsv, type TrendsCsvLabels } from './trendsCsv'
import type { TrendDimension, TrendWave } from './model'

const waves: TrendWave[] = [
  { id: 'w1', code: 'Q1', name: 'Encuesta de Clima Q1', closedAt: '2026-02-12T03:02:44Z', completedCount: 24 },
  { id: 'w2', code: 'Q2', name: 'Encuesta de Clima Q2', closedAt: '2026-05-13T02:03:12Z', completedCount: 24 },
  { id: 'w3', code: 'Q3', name: 'Encuesta de Clima Q3', closedAt: '2026-08-06T02:05:22Z', completedCount: 24 },
]

const labels: TrendsCsvLabels = { group: 'Grupo', survey: 'Encuesta', closed: 'Cerró', responses: 'Respuestas', withheld: 'protegido' }

function rows(csv: string): string[][] {
  return csv.split('\r\n').map((line) => line.split(','))
}

describe('buildTrendsCsv', () => {
  it('writes the table as shown: a row per wave, readings as printed, and the first → last move as printed', () => {
    const dimensions: TrendDimension[] = [
      { key: 'workload', name: 'Carga de trabajo', values: [2.75, 3.04, 3.33] },
      { key: 'trust', name: 'Confianza', values: [2.96, 3.33, 3.67] },
    ]
    const csv = rows(
      buildTrendsCsv({ groupName: 'Toda la empresa', waves, withheld: [false, false, false], respondents: [24, 24, 24], dimensions, labels }),
    )
    expect(csv[0]).toEqual(['Grupo', 'Encuesta', 'Cerró', 'Respuestas', 'Carga de trabajo', 'Confianza'])
    expect(csv[1]).toEqual(['Toda la empresa', 'Encuesta de Clima Q1', '2026-02-12', '24', '2.8', '3.0'])
    expect(csv[3]).toEqual(['Toda la empresa', 'Encuesta de Clima Q3', '2026-08-06', '24', '3.3', '3.7'])
    // "2.8" → "3.3" is +0.5 as the table prints it; the raw 0.58 would have printed +0.6.
    expect(csv[4]).toEqual(['Toda la empresa', 'Q1 → Q3', '', '', '+0.5', '+0.7'])
  })

  it('never writes a number for a withheld wave — not a reading, not a count — and no move from a withheld end', () => {
    const dimensions: TrendDimension[] = [{ key: 'workload', name: 'Carga de trabajo', values: [null, 3.0, 3.3] }]
    const csv = rows(
      buildTrendsCsv({ groupName: 'Finanzas', waves, withheld: [true, false, false], respondents: [null, 6, 7], dimensions, labels }),
    )
    expect(csv[1]).toEqual(['Finanzas', 'Encuesta de Clima Q1', '2026-02-12', 'protegido', 'protegido'])
    expect(csv[2]).toEqual(['Finanzas', 'Encuesta de Clima Q2', '2026-05-13', '6', '3.0'])
    expect(csv[4]).toEqual(['Finanzas', 'Q1 → Q3', '', '', ''])
  })

  it('leaves a dimension the wave did not ask empty — never a zero — and quotes and neutralises payload names', () => {
    const dimensions: TrendDimension[] = [{ key: 'x', name: 'Ventas, Norte', values: [null, 3.2, 3.4] }]
    const csv = buildTrendsCsv({
      groupName: '=HYPERLINK("x")',
      waves,
      withheld: [false, false, false],
      respondents: [24, 24, 24],
      dimensions,
      labels,
    })
    const [header, first] = csv.split('\r\n')
    expect(header.endsWith(',"Ventas, Norte"')).toBe(true)
    expect(first.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true)
    expect(first.endsWith(',24,')).toBe(true)
  })
})
