import { describe, expect, it } from 'vitest'
import { changeDirection, deltaFraction, formatMetric } from './formatMetric'

/**
 * These assertions pin the *locale-sensitive* behaviour, which is the whole reason
 * this module exists — legacy formatted by string concatenation and got all of it
 * wrong. The exact glyphs come from `Intl`, so they were measured rather than
 * guessed (Spanish puts a space before `%`, and abbreviates "days" as `d`).
 */
describe('formatMetric', () => {
  describe('number', () => {
    it('groups thousands per locale', () => {
      expect(formatMetric(1234.5, { kind: 'number' }, 'en')).toBe('1,234.5')
      expect(formatMetric(1234.5, { kind: 'number' }, 'es')).toBe('1234,5')
    })

    it('shows no decimals for a whole number, and one otherwise', () => {
      expect(formatMetric(78, { kind: 'number' }, 'en')).toBe('78')
      expect(formatMetric(78.25, { kind: 'number' }, 'en')).toBe('78.3')
    })

    it('honours an explicit precision', () => {
      expect(formatMetric(78, { kind: 'number', decimals: 2 }, 'en')).toBe('78.00')
    })
  })

  describe('percentage', () => {
    /** The value is percentage points, so 78 must not become 7800%. */
    it('treats the value as percentage points', () => {
      expect(formatMetric(78, { kind: 'percentage' }, 'en')).toBe('78%')
    })

    /**
     * The reason this goes through Intl rather than appending '%'. Spanish
     * typography puts a non-breaking space before the sign; concatenation cannot.
     */
    it('places the sign per locale', () => {
      expect(formatMetric(78, { kind: 'percentage' }, 'es')).toMatch(/^78\s%$/)
    })

    it('renders a negative net score', () => {
      expect(formatMetric(-12.5, { kind: 'percentage', decimals: 1 }, 'en')).toBe('-12.5%')
    })
  })

  describe('currency', () => {
    /** Legacy hardcoded `$`, for a Costa Rican client. */
    it('uses the currency it is given, not dollars', () => {
      expect(formatMetric(1234.5, { kind: 'currency', currency: 'CRC' }, 'es')).toContain('CRC')
      expect(formatMetric(1234.5, { kind: 'currency', currency: 'USD' }, 'en')).toBe('$1,234.50')
    })

    /**
     * A currency's precision belongs to the currency, not to this module. Applying
     * the "cap at one decimal" default used by the other kinds printed `$1,234.5`
     * and lost a digit of the cents — caught by the assertion above.
     */
    it('keeps each currency its own number of decimal places', () => {
      expect(formatMetric(1000, { kind: 'currency', currency: 'USD' }, 'en')).toBe('$1,000.00')
      expect(formatMetric(1000, { kind: 'currency', currency: 'JPY' }, 'en')).toBe('¥1,000')
    })

    it('still honours an explicit precision', () => {
      expect(formatMetric(1234.5, { kind: 'currency', currency: 'USD', decimals: 0 }, 'en')).toBe(
        '$1,235',
      )
    })
  })

  describe('duration', () => {
    /** Legacy appended a hardcoded English `d`. */
    it('localises the unit', () => {
      expect(formatMetric(12, { kind: 'duration', unit: 'day' }, 'en')).toBe('12 days')
      expect(formatMetric(12, { kind: 'duration', unit: 'day' }, 'es')).toBe('12 d')
    })
  })

  it('renders a dash rather than "NaN" for a non-finite value', () => {
    expect(formatMetric(Number.NaN, { kind: 'number' }, 'en')).toBe('—')
    expect(formatMetric(Number.POSITIVE_INFINITY, { kind: 'percentage' }, 'en')).toBe('—')
  })
})

describe('deltaFraction', () => {
  it('computes relative change', () => {
    expect(deltaFraction(110, 100)).toBeCloseTo(0.1)
    expect(deltaFraction(90, 100)).toBeCloseTo(-0.1)
  })

  /**
   * The bug this function exists for. Legacy divided by `previousValue` unguarded,
   * so a first-ever survey (previous = 0) rendered "Infinity%" and 0 → 0 rendered
   * "NaN%".
   */
  it('returns null when the previous value was zero', () => {
    expect(deltaFraction(50, 0)).toBeNull()
    expect(deltaFraction(0, 0)).toBeNull()
  })

  it('returns null for non-finite inputs', () => {
    expect(deltaFraction(Number.NaN, 100)).toBeNull()
    expect(deltaFraction(100, Number.NaN)).toBeNull()
  })
})

describe('changeDirection', () => {
  it('distinguishes up, down and exactly flat', () => {
    expect(changeDirection(2, 1)).toBe('up')
    expect(changeDirection(1, 2)).toBe('down')
    expect(changeDirection(1, 1)).toBe('flat')
  })

  /** Zero to zero is flat, not a fall -- it shares the `previous === 0` case. */
  it('treats zero to zero as flat', () => {
    expect(changeDirection(0, 0)).toBe('flat')
  })
})
