import { describe, it, expect } from 'vitest'
import { peoplePerValue } from './demographicReach'

describe('peoplePerValue', () => {
  it('divides the sample by the number of values', () => {
    expect(peoplePerValue(120, 6)).toBe(20)
  })

  it('rounds down, so a mean that has not reached the floor is not rounded up to it', () => {
    // 31 people over 14 values is 2.21, and the screen's verdict turns on
    // `< 5`. Rounding to nearest would report 2 here but 5 for 69/14 = 4.93,
    // which would call a provably unusable cut usable.
    expect(peoplePerValue(31, 14)).toBe(2)
    expect(peoplePerValue(69, 14)).toBe(4)
  })

  it('keeps the floor comparison exact at the boundary', () => {
    // `⌊m⌋ < 5` must be true exactly when `m < 5`, in both directions.
    expect(peoplePerValue(45, 9)).toBe(5)
    expect(peoplePerValue(44, 9)).toBe(4)
  })

  it('answers null rather than zero when there are no values to divide by', () => {
    // Zero is a measurement; "there is nothing to measure" is not one, and the
    // screen renders the two differently.
    expect(peoplePerValue(100, 0)).toBeNull()
    expect(peoplePerValue(100, -1)).toBeNull()
    expect(peoplePerValue(100, 2.5)).toBeNull()
  })

  it('answers null for a headcount that is not a usable number', () => {
    expect(peoplePerValue(Number.NaN, 4)).toBeNull()
    expect(peoplePerValue(Number.POSITIVE_INFINITY, 4)).toBeNull()
    expect(peoplePerValue(-3, 4)).toBeNull()
  })

  it('reports zero for a real company that is simply smaller than its cut', () => {
    // Distinct from the null cases above: three people across four values really
    // does average under one, and that is a reading rather than a gap.
    expect(peoplePerValue(3, 4)).toBe(0)
  })
})
