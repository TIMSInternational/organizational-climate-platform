import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESULT_BANDS,
  bandOf,
  bandRangeText,
  boundaryText,
  deltaScoreText,
  parseResultScale,
  scaleDecimals,
  scaleMax,
  scoreText,
  shownDelta,
  signedScoreText,
  type ResultBands,
} from './resultBands'

const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`

/** EAGLE: bands at 3,80 and 4,30, read on 0–100. */
const EAGLE: ResultBands = { opportunityMin: 3.8, strengthMin: 4.3, names: DEFAULT_RESULT_BANDS.names, scale: 'percent' }

describe('the result scale', () => {
  it('defaults to the mean, and only "percent" is percent', () => {
    expect(DEFAULT_RESULT_BANDS.scale).toBe('mean')
    expect(parseResultScale(undefined)).toBe('mean')
    expect(parseResultScale(null)).toBe('mean')
    expect(parseResultScale('PERCENT')).toBe('mean')
    expect(parseResultScale('mean')).toBe('mean')
    expect(parseResultScale('percent')).toBe('percent')
  })

  it('prints a mean exactly as before on "mean"', () => {
    expect(scoreText(4.07, 'mean', 'es', 2)).toBe('4,07')
    expect(scoreText(4.1, 'mean', 'es')).toBe('4,1')
    expect(scoreText(3.666, 'mean', 'en', 2)).toBe('3.67')
    expect(signedScoreText(0.32, 'mean', 'es', 2)).toBe('+0,32')
    expect(deltaScoreText(-0.12, 'mean', 'es', 2)).toBe('-0,12')
    expect(deltaScoreText(0.004, 'mean', 'es', 2)).toBe('0,00')
    expect(boundaryText(3, 'es')).toBe('3,00')
  })

  it('prints ×20 at one decimal fewer on "percent"', () => {
    expect(scoreText(4.07, 'percent', 'es', 2)).toBe('81,4')
    expect(scoreText(4.1, 'percent', 'es', 1)).toBe('82')
    expect(scoreText(4.05, 'percent', 'es', 1)).toBe('81')
    expect(scoreText(1, 'percent', 'es', 0)).toBe('20')
    expect(scoreText(5, 'percent', 'en', 2)).toBe('100.0')
    expect(scaleDecimals(2, 'percent')).toBe(1)
    expect(scaleDecimals(0, 'percent')).toBe(0)
    expect(scaleDecimals(2, 'mean')).toBe(2)
  })

  it('scales deltas the same way, sign included', () => {
    expect(signedScoreText(0.32, 'percent', 'es', 2)).toBe('+6,4')
    expect(signedScoreText(-0.2, 'percent', 'es', 1)).toBe('-4')
    expect(deltaScoreText(0.12, 'percent', 'es', 2)).toBe('+2,4')
    expect(deltaScoreText(0.001, 'percent', 'es', 2)).toBe('0,0')
    expect(shownDelta(0.3, 'percent', 1)).toBe(6)
    expect(shownDelta(-0.004, 'percent', 1)).toBe(0)
  })

  it('names the unit the scale tops out at', () => {
    expect(scaleMax('mean')).toBe(5)
    expect(scaleMax('percent')).toBe(100)
  })

  it('reads EAGLE’s boundaries 3,80 / 4,30 as 76 / 86', () => {
    expect(boundaryText(3.8, 'es', 'percent')).toBe('76')
    expect(boundaryText(4.3, 'es', 'percent')).toBe('86')
    expect(boundaryText(2.99, 'es', 'percent')).toBe('59,8')
    expect(bandRangeText('strength', EAGLE, t, 'es')).toBe('resultBands.range.between{"min":"86","max":"100"}')
    expect(bandRangeText('critical', EAGLE, t, 'es')).toBe('resultBands.range.under{"value":"76"}')
    expect(bandRangeText('critical', { ...EAGLE, scale: 'mean' }, t, 'es')).toBe('resultBands.range.under{"value":"3,80"}')
  })

  it('bands on the 1–5 value whatever the scale', () => {
    const mean: ResultBands = { ...EAGLE, scale: 'mean' }
    for (const value of [1, 3.79, 3.8, 4.29, 4.3, 5]) {
      expect(bandOf(value, EAGLE, 2)).toBe(bandOf(value, mean, 2))
    }
    expect(bandOf(3.8, EAGLE, 2)).toBe('opportunity')
    expect(bandOf(4.3, EAGLE, 2)).toBe('strength')
    expect(bandOf(3.79, EAGLE, 2)).toBe('critical')
  })
})
