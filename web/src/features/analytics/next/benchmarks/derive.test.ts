import { describe, it, expect } from 'vitest'
import { createTranslator } from '../../../../i18n'
import { CATALOGUES } from '../../../../i18n/locale'
import {
  belowSummary,
  benchmarkCategoryLabel,
  benchmarkTypeLabel,
  dimensionStanding,
  indexGapPhrase,
  percentileNote,
  printedIndex,
  qualityReading,
  scopeKey,
  signedDelta,
} from './derive'
import type { BenchmarkDimension } from './model'

const es = createTranslator(CATALOGUES.es, CATALOGUES.en)

/**
 * Grupo Meridiano's Encuesta de Clima Q3 against "Manufactura · 500–1000 personas", as
 * the local API returned both on 10 Sep: the survey's per-question means through
 * `toIndex`, the cohort's metric values. `psychological_safety` has no metric in the
 * cohort (it carries `safety`), which is the artboard's "sin mediana del grupo" row.
 */
const meridiano: BenchmarkDimension[] = [
  { key: 'psychological_safety', name: 'Seguridad psicológica', score: 69, median: null },
  { key: 'workload', name: 'Carga de trabajo', score: 58, median: 66 },
  { key: 'trust', name: 'Confianza', score: 67, median: 68 },
  { key: 'recognition', name: 'Reconocimiento', score: 60, median: 64 },
  { key: 'growth', name: 'Desarrollo', score: 70, median: 70 },
  { key: 'belonging', name: 'Pertenencia', score: 75, median: 72 },
]

describe('benchmarks derive — standing', () => {
  it('reads every Meridiano row as the artboard prints it', () => {
    expect(meridiano.map((d) => dimensionStanding(d.score, d.median))).toEqual([
      { standing: 'none', delta: null },
      { standing: 'below', delta: -8 },
      { standing: 'below', delta: -1 },
      { standing: 'below', delta: -4 },
      { standing: 'at', delta: 0 },
      { standing: 'above', delta: 3 },
    ])
    expect(meridiano.map((d) => dimensionStanding(d.score, d.median).delta).map((delta) => (delta === null ? null : signedDelta(delta)))).toEqual([
      null,
      '−8',
      '−1',
      '−4',
      '±0',
      '+3',
    ])
  })

  it('rounds before it compares, so "±0" is never "bajo la mediana"', () => {
    expect(dimensionStanding(69.6, 70)).toEqual({ standing: 'at', delta: 0 })
    expect(dimensionStanding(69.4, 70)).toEqual({ standing: 'below', delta: -1 })
  })

  it('counts three below and names the widest gap', () => {
    const summary = belowSummary(meridiano)
    expect(summary.count).toBe(3)
    expect(summary.widest?.name).toBe('Carga de trabajo')
  })

  it('keeps the first-asked dimension on a tie, and has nothing to name when none is below', () => {
    const tied = belowSummary([
      { key: 'a', name: 'A', score: 60, median: 64 },
      { key: 'b', name: 'B', score: 50, median: 54 },
    ])
    expect(tied.widest?.name).toBe('A')
    expect(belowSummary([{ key: 'x', name: 'X', score: 80, median: 70 }])).toEqual({ count: 0, widest: null, compared: true })
  })

  it('says nothing was compared when no dimension has both a score and a median', () => {
    // Nothing scored (a survey under the floor, whose questions the server empties) and
    // nothing the cohort carries a median for are the same fact for the card: "none below"
    // would describe a comparison that did not happen.
    expect(belowSummary([]).compared).toBe(false)
    expect(
      belowSummary([
        { key: 'a', name: 'A', score: 60, median: null },
        { key: 'b', name: 'B', score: null, median: 54 },
      ]).compared,
    ).toBe(false)
    expect(belowSummary([{ key: 'a', name: 'A', score: 60, median: null }, { key: 'x', name: 'X', score: 80, median: 70 }]).compared).toBe(true)
  })
})

describe('benchmarks derive — the index, and the percentile no payload gives', () => {
  it('takes every gap between printed readings, so the change is their difference', () => {
    expect(printedIndex(67.6)).toBe(68)
    expect(printedIndex(67.4)).toBe(67)
    expect(Object.is(printedIndex(-0.4), 0)).toBe(true)
    expect(printedIndex(null)).toBeNull()
    // Meridiano on 10 Sep: 67 against 68.
    expect(indexGapPhrase(es, 67, 68)).toBe('1 punto bajo la mediana')
    // 67 against 67.6 prints "67" and "68": one point, not the 0.6 between the raw values.
    expect(indexGapPhrase(es, 67, 67.6)).toBe('1 punto bajo la mediana')
    // 66.6 against 67.4 prints "67" and "67": level, though the raw gap rounds to −1.
    expect(indexGapPhrase(es, 66.6, 67.4)).toBe('en la mediana')
    expect(indexGapPhrase(es, 71, 68)).toBe('3 puntos sobre la mediana')
    expect(indexGapPhrase(es, 69, 68)).toBe('1 punto sobre la mediana')
    expect(indexGapPhrase(es, 60, 68)).toBe('8 puntos bajo la mediana')
    expect(indexGapPhrase(es, null, 68)).toBeNull()
    expect(indexGapPhrase(es, 67, null)).toBeNull()
  })

  it('prints no band under "Tu percentil": the gap it keeps has the gap\'s own sign', () => {
    // Meridiano sits one point BELOW its median. The retired line added "por encima de dos
    // tercios del grupo" off the cohort's stored 68 — above two thirds while below the median.
    const below = percentileNote(es, 67, 68)
    expect(below).toBe('1 punto bajo la mediana · sin la distribución del grupo no hay percentil')
    const above = percentileNote(es, 75, 68)
    expect(above).toBe('7 puntos sobre la mediana · sin la distribución del grupo no hay percentil')
    expect(percentileNote(es, 68, 68)).toBe('en la mediana · sin la distribución del grupo no hay percentil')
    for (const line of [below, above]) {
      expect(line).not.toMatch(/tercio|encima de|debajo de/)
    }
  })

  it('says nothing it cannot measure', () => {
    // No index to compare: the missing piece is still named, and no gap is invented.
    expect(percentileNote(es, null, 68)).toBe('sin la distribución del grupo no hay percentil')
    // No median: no gap, and no sentence about a group the page could not read.
    expect(percentileNote(es, 67, null)).toBeNull()
    expect(percentileNote(es, null, null)).toBeNull()
  })
})

describe('benchmarks derive — references', () => {
  it('prints "sin calcular" for a reference nobody scored, whether the wire says null or pending', () => {
    // PR #463's wire: null. Main's wire today: 0 beside `validationStatus: 'pending'`.
    expect(qualityReading({ qualityScore: null, validationStatus: null })).toEqual({ kind: 'unscored' })
    expect(qualityReading({ qualityScore: 0, validationStatus: 'pending' })).toEqual({ kind: 'unscored' })
  })

  it('keeps a scored zero as a number — the rule hands that verdict out', () => {
    expect(qualityReading({ qualityScore: 0, validationStatus: 'failed' })).toEqual({ kind: 'score', value: 0 })
    expect(qualityReading({ qualityScore: 0.92, validationStatus: null })).toEqual({ kind: 'score', value: 0.92 })
  })

  it('names type and category as words, and an authored category as authored', () => {
    expect(benchmarkTypeLabel(es, 'industry')).toBe('Sector')
    expect(benchmarkTypeLabel(es, 'internal')).toBe('Interna')
    expect(benchmarkCategoryLabel(es, 'climate')).toBe('Clima')
    expect(benchmarkCategoryLabel(es, 'rotación')).toBe('rotación')
  })

  it('scopes a global row to the platform and an owned row to this company', () => {
    expect(scopeKey(null, 'c1')).toBe('benchmarks.next.scopePlatform')
    expect(scopeKey('c1', 'c1')).toBe('benchmarks.next.scopeCompany')
    expect(scopeKey('c2', 'c1')).toBe('benchmarks.next.scopeOther')
    expect(scopeKey('c2', undefined)).toBe('benchmarks.next.scopeOther')
  })
})
