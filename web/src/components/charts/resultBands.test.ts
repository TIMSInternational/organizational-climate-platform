import { describe, it, expect } from 'vitest'
import { createTranslator } from '../../i18n'
import es from '../../i18n/es.json'
import en from '../../i18n/en.json'
import {
  DEFAULT_RESULT_BANDS,
  bandName,
  bandOf,
  bandRange,
  bandRangeText,
  bandShortName,
  printed,
  segmentsOf,
  type ResultBands,
} from './resultBands'

const tEs = createTranslator(es, es)
const tEn = createTranslator(en, en)

/** Meridiano Q3, the canvas's map: Ingeniería, Operaciones, Personas, Ventas. */
const MERIDIANO: [string, number[]][] = [
  ['Ingeniería', [4.0, 3.7, 4.0, 3.5, 4.2, 4.3]],
  ['Operaciones', [2.6, 2.4, 3.0, 2.8, 3.0, 3.2]],
  ['Personas', [4.4, 4.0, 4.0, 3.6, 4.2, 4.4]],
  ['Ventas', [4.0, 3.4, 3.8, 3.6, 3.8, 4.0]],
]

describe('the result bands', () => {
  it('reads the approved canvas’s map in the default bands: 11 strength, 10 opportunity, 3 critical', () => {
    const count = { strength: 0, opportunity: 0, critical: 0 }
    for (const [, scores] of MERIDIANO) for (const score of scores) count[bandOf(score, DEFAULT_RESULT_BANDS)] += 1
    expect(count).toEqual({ strength: 11, opportunity: 10, critical: 3 })
    expect(MERIDIANO[1]![1].map((score) => bandOf(score, DEFAULT_RESULT_BANDS))).toEqual([
      'critical',
      'critical',
      'opportunity',
      'critical',
      'opportunity',
      'opportunity',
    ])
  })

  it('judges the PRINTED reading at both edges, never the raw one', () => {
    // A cell that prints "4,0" is in the strength area, whatever the third decimal was.
    expect(bandOf(3.96, DEFAULT_RESULT_BANDS)).toBe('strength') // prints 4,0
    expect(bandOf(3.94, DEFAULT_RESULT_BANDS)).toBe('opportunity') // prints 3,9
    expect(bandOf(2.95, DEFAULT_RESULT_BANDS)).toBe('opportunity') // prints 3,0
    expect(bandOf(2.94, DEFAULT_RESULT_BANDS)).toBe('critical') // prints 2,9
    // The two-decimal company mean is judged at two: 3,995 prints "4,00" and 3,994 "3,99".
    expect(bandOf(3.995, DEFAULT_RESULT_BANDS, 2)).toBe('strength')
    expect(bandOf(3.994, DEFAULT_RESULT_BANDS, 2)).toBe('opportunity')
    expect(bandOf(3.65, DEFAULT_RESULT_BANDS, 2)).toBe('opportunity')
  })

  it('puts the boundary itself in the higher area', () => {
    expect(bandOf(3, DEFAULT_RESULT_BANDS)).toBe('opportunity')
    expect(bandOf(4, DEFAULT_RESULT_BANDS)).toBe('strength')
    expect(bandOf(1, DEFAULT_RESULT_BANDS)).toBe('critical')
    expect(bandOf(5, DEFAULT_RESULT_BANDS)).toBe('strength')
  })

  it('reads a company’s own boundaries, not the default', () => {
    const custom: ResultBands = { ...DEFAULT_RESULT_BANDS, opportunityMin: 2.5, strengthMin: 4.25 }
    expect(bandOf(2.6, custom)).toBe('opportunity')
    expect(bandOf(4.2, custom)).toBe('opportunity')
    // 4,25 against a reading printed at one decimal: 4,3 is strength, 4,2 is not.
    expect(bandOf(4.26, custom)).toBe('strength')
  })

  it('gives each area its contiguous two-decimal range', () => {
    expect(bandRange('critical', DEFAULT_RESULT_BANDS)).toEqual({ min: 1, max: 2.99 })
    expect(bandRange('opportunity', DEFAULT_RESULT_BANDS)).toEqual({ min: 3, max: 3.99 })
    expect(bandRange('strength', DEFAULT_RESULT_BANDS)).toEqual({ min: 4, max: 5 })
    expect(bandRangeText('strength', DEFAULT_RESULT_BANDS, tEs, 'es')).toBe('4,00 a 5,00')
    expect(bandRangeText('opportunity', DEFAULT_RESULT_BANDS, tEs, 'es')).toBe('3,00 a 3,99')
    expect(bandRangeText('critical', DEFAULT_RESULT_BANDS, tEs, 'es')).toBe('menos de 3,00')
    expect(bandRangeText('critical', DEFAULT_RESULT_BANDS, tEn, 'en')).toBe('under 3.00')
  })

  it('names an area by the company’s own name, else the product’s in the reader’s language', () => {
    expect(bandName('critical', DEFAULT_RESULT_BANDS, tEs)).toBe('Área crítica')
    expect(bandName('critical', DEFAULT_RESULT_BANDS, tEn)).toBe('Critical area')
    expect(bandShortName('opportunity', DEFAULT_RESULT_BANDS, tEs)).toBe('Oportunidad')
    const named: ResultBands = { ...DEFAULT_RESULT_BANDS, names: { critical: 'Zona roja', opportunity: null, strength: null } }
    // A company's name is its own: it is not translated, and not shortened.
    expect(bandName('critical', named, tEn)).toBe('Zona roja')
    expect(bandShortName('critical', named, tEs)).toBe('Zona roja')
  })

  it('lays the three areas end to end over 1 to 5', () => {
    expect(segmentsOf(DEFAULT_RESULT_BANDS)).toEqual([
      { key: 'critical', from: 1, to: 3 },
      { key: 'opportunity', from: 3, to: 4 },
      { key: 'strength', from: 4, to: 5 },
    ])
  })

  it('rounds the way a figure prints', () => {
    expect(printed(2.95, 1)).toBe(3)
    expect(printed(3.65, 1)).toBe(3.7)
    expect(printed(3.649, 2)).toBe(3.65)
  })
})
