import { describe, it, expect } from 'vitest'
import { formatPercentOrUnavailable, percentagePoints } from './trackingUnits'
import { toPercent } from './semaforo'

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
    expect(percentagePoints(0.87)).toBe(87)
    expect(percentagePoints(1)).toBe(100)
  })

  it('reports no reading for null, undefined and a non-number', () => {
    expect(percentagePoints(null)).toBeNull()
    expect(percentagePoints(undefined)).toBeNull()
    expect(percentagePoints(Number.NaN)).toBeNull()
    expect(percentagePoints(Number.POSITIVE_INFINITY)).toBeNull()
  })

  /**
   * The defect. `0.07 * 100` is `7.000000000000001`, and `formatMetric`'s default
   * precision is "0 places for an integer, 1 otherwise" — so an unrounded
   * conversion renders `7,0 %` in a column whose neighbouring rows read `8 %`.
   *
   * Swept over all 101 whole percentages rather than spot-checked on 0.07: which
   * values carry float dust is a property of binary floating point, and a fix that
   * special-cased the one value the review happened to name would still be broken
   * for the other seven.
   */
  it('returns a whole number for every whole percentage', () => {
    const dusty: string[] = []
    for (let percent = 0; percent <= 100; percent += 1) {
      const points = percentagePoints(percent / 100)
      if (points === null || !Number.isInteger(points)) dusty.push(`${percent}% -> ${points}`)
    }
    expect(dusty).toEqual([])
  })

  /**
   * There is ONE fraction→percentage conversion in this feature and it lives in
   * `semaforo.ts`. This module is a null-aware wrapper around it, not a second
   * implementation — two of them is how the progress bars and the figures beside
   * them came to disagree.
   */
  it('is exactly toPercent, for every value that is a reading at all', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(percentagePoints(percent / 100)).toBe(toPercent(percent / 100))
    }
    expect(percentagePoints(0.875)).toBe(toPercent(0.875))
  })

  /**
   * A consequence of that delegation, stated so it is a decision and not a
   * surprise: the module renders WHOLE percentages everywhere. `RegistrarAvance`
   * is fed `Math.round(percent)/100` by `fromPercent`, so a plan's avance is a
   * whole percentage by construction; a legacy `numeric(5,4)` row carrying 0.875
   * reads as 88 %, matching the bar drawn beside it rather than disagreeing with
   * it by half a point.
   */
  it('renders whole percentages, the same units the progress bars use', () => {
    expect(percentagePoints(0.875)).toBe(88)
    expect(percentagePoints(0.874)).toBe(87)
  })

  /**
   * Inherited from `toPercent`, and the trade is deliberate: a bar that ran past
   * the end of its own track is a rendering bug on every screen, whereas an
   * out-of-range reading is a service defect this client cannot fix. Clamping
   * keeps the page honest about its own drawing.
   */
  it('clamps a reading the domain says cannot exist', () => {
    expect(percentagePoints(1.4)).toBe(100)
    expect(percentagePoints(-0.2)).toBe(0)
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

  /**
   * The rounding defect as it reaches a reader: two rows of the same column, one
   * whole percentage each, rendered in two different shapes. Before the conversion
   * was rounded this produced "7,0 %" beside "8 %", which reads as a precision
   * this data does not have.
   */
  it('renders neighbouring whole percentages in the same shape', () => {
    const seven = formatPercentOrUnavailable(0.07, UNAVAILABLE, 'es')
    const eight = formatPercentOrUnavailable(0.08, UNAVAILABLE, 'es')
    expect(seven).toMatch(/^7\s?%$/)
    expect(eight).toMatch(/^8\s?%$/)
    expect(seven).not.toMatch(/[,.]/)
  })
})
