import { describe, expect, it } from 'vitest'
import {
  bandStatus,
  formatMinutes,
  participationBand,
  participationRate,
} from './participation'

describe('participationRate', () => {
  it('is the share of the invited population that responded', () => {
    expect(participationRate(40, 50)).toBe(80)
    expect(participationRate(0, 50)).toBe(0)
  })

  /**
   * No target means no denominator. Returning null rather than 0 matters: 0 would
   * render a bar claiming nobody responded, which is a different statement from
   * "there is nothing to measure against".
   */
  it('returns null when there is no target to measure against', () => {
    expect(participationRate(10, 0)).toBeNull()
    expect(participationRate(10, -5)).toBeNull()
    expect(participationRate(10, Number.NaN)).toBeNull()
  })

  /** Overshoot is reported, not clamped -- the caller decides how to draw it. */
  it('reports over 100% when more responded than were invited', () => {
    expect(participationRate(60, 50)).toBe(120)
  })
})

describe('participationBand', () => {
  it('bands on the legacy thresholds, inclusive at the bottom', () => {
    expect(participationBand(100)).toBe('excellent')
    expect(participationBand(80)).toBe('excellent')
    expect(participationBand(79.9)).toBe('good')
    expect(participationBand(60)).toBe('good')
    expect(participationBand(59.9)).toBe('fair')
    expect(participationBand(40)).toBe('fair')
    expect(participationBand(39.9)).toBe('low')
    expect(participationBand(0)).toBe('low')
  })
})

/**
 * Four bands, three statuses. Legacy gave each band its own hue — green / blue /
 * yellow / red — which enrols `--admin-accent-blue` into a status vocabulary where
 * it means nothing, and makes a 60% response rate look like a caution.
 */
describe('bandStatus', () => {
  it('maps both healthy bands to good', () => {
    expect(bandStatus('excellent')).toBe('good')
    expect(bandStatus('good')).toBe('good')
  })

  it('uses warning and critical for the two that need attention', () => {
    expect(bandStatus('fair')).toBe('warning')
    expect(bandStatus('low')).toBe('critical')
  })

  /** Status is exactly three things in this UI; a fourth would break the vocabulary. */
  it('never produces a fourth status', () => {
    const statuses = new Set(
      (['excellent', 'good', 'fair', 'low'] as const).map((band) => bandStatus(band)),
    )
    expect(statuses).toEqual(new Set(['good', 'warning', 'critical']))
  })
})

describe('formatMinutes', () => {
  it('shows minutes alone below an hour', () => {
    expect(formatMinutes(45, 'en')).toBe('45 min')
  })

  it('splits into hours and minutes above an hour', () => {
    expect(formatMinutes(150, 'en')).toBe('2 hr 30 min')
  })

  it('omits a zero minutes part', () => {
    expect(formatMinutes(120, 'en')).toBe('2 hr')
  })

  /** Legacy hardcoded `${hours}h ${mins}m`, English abbreviations in a bilingual app. */
  it('localises the units', () => {
    expect(formatMinutes(45, 'es')).toBe('45 min')
    expect(formatMinutes(150, 'es')).toContain('h')
  })

  it('does not render nonsense for a negative or non-finite input', () => {
    expect(formatMinutes(-1, 'en')).toBe('—')
    expect(formatMinutes(Number.NaN, 'en')).toBe('—')
  })

  it('handles exactly zero', () => {
    expect(formatMinutes(0, 'en')).toBe('0 min')
  })
})
