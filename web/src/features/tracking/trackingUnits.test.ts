import { describe, it, expect } from 'vitest'
import { formatPercentOrUnavailable, percentagePoints } from './trackingUnits'

const UNAVAILABLE = 'No disponible'

describe('percentagePoints', () => {
  /**
   * The conversion, pinned on the three values the domain actually produces.
   *
   * `PlanDeAccion.MarcarCumplido` writes exactly `1m`, `RegistrarAvance` rejects
   * anything outside `0..1`, and the column is `numeric(5,4)`. So a stored `0.87`
   * is 87 per cent and there is no reading of it under which it is 0.87 per cent.
   */
  it('multiplies a stored 0-1 fraction into percentage points', () => {
    expect(percentagePoints(0)).toBe(0)
    expect(percentagePoints(0.87)).toBeCloseTo(87)
    expect(percentagePoints(1)).toBe(100)
  })

  it('reports no reading for null, undefined and a non-number', () => {
    expect(percentagePoints(null)).toBeNull()
    expect(percentagePoints(undefined)).toBeNull()
    expect(percentagePoints(Number.NaN)).toBeNull()
    expect(percentagePoints(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('formatPercentOrUnavailable', () => {
  /**
   * #125's fourth acceptance criterion, and its mirror.
   *
   * `resultado_anio_anterior_pct` is null until #89 lands, so the honest rendering
   * is "not available" — a zero would assert a year-on-year result nobody measured.
   */
  it('says unavailable when there is no prior-year value', () => {
    expect(formatPercentOrUnavailable(null, UNAVAILABLE, 'es')).toBe(UNAVAILABLE)
    expect(formatPercentOrUnavailable(undefined, UNAVAILABLE, 'es')).toBe(UNAVAILABLE)
  })

  /**
   * The half that is easy to break by accident. `value || unavailable` and
   * `value ? format(value) : unavailable` are both wrong here: a real zero is a
   * measurement, and hiding it behind the absent-value copy loses it.
   */
  it('renders a genuine zero as zero, never as unavailable', () => {
    const rendered = formatPercentOrUnavailable(0, UNAVAILABLE, 'es')
    expect(rendered).not.toBe(UNAVAILABLE)
    expect(rendered).toMatch(/0/)
  })

  it('renders a real fraction as localised percent text', () => {
    // Spanish puts a space before the sign and English does not; going through
    // Intl rather than appending '%' is what gets both right (see formatMetric).
    expect(formatPercentOrUnavailable(0.72, UNAVAILABLE, 'en')).toBe('72%')
    expect(formatPercentOrUnavailable(0.72, UNAVAILABLE, 'es')).toMatch(/^72\s?%$/)
  })

  it('honours a requested precision, so an avance of 0.875 does not read as 88', () => {
    expect(formatPercentOrUnavailable(0.875, UNAVAILABLE, 'en', 1)).toBe('87.5%')
  })
})
