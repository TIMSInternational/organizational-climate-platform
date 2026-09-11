import { describe, it, expect } from 'vitest'
import { createTranslator } from '../../../../i18n'
import { CATALOGUES } from '../../../../i18n/locale'
import {
  bandUnit,
  belowSummary,
  benchmarkCategoryLabel,
  benchmarkTypeLabel,
  dimensionStanding,
  indexGapPhrase,
  percentileBand,
  percentileSub,
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
    expect(belowSummary([{ key: 'x', name: 'X', score: 80, median: 70 }])).toEqual({ count: 0, widest: null })
  })
})

describe('benchmarks derive — index and percentile', () => {
  it('reads 67 against 68 at the 68th percentile as the artboard does', () => {
    expect(indexGapPhrase(es, 67, 68)).toBe('1 punto bajo la mediana')
    expect(percentileBand(68)).toBe('upper')
    expect(bandUnit(es, 68)).toBe('tercio superior')
    expect(percentileSub(es, 67, 68, 68)).toBe('1 punto bajo la mediana, por encima de dos tercios del grupo')
  })

  it('bands the thirds at 67 and 34, as the first read-out did', () => {
    expect(percentileBand(67)).toBe('upper')
    expect(percentileBand(66)).toBe('middle')
    expect(percentileBand(34)).toBe('middle')
    expect(percentileBand(33)).toBe('lower')
  })

  it('says nothing it cannot measure', () => {
    expect(indexGapPhrase(es, null, 68)).toBeNull()
    expect(percentileSub(es, null, null, null)).toBeNull()
    expect(bandUnit(es, null)).toBeUndefined()
    expect(indexGapPhrase(es, 71, 68)).toBe('3 puntos sobre la mediana')
    expect(indexGapPhrase(es, 68, 68)).toBe('en la mediana')
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
