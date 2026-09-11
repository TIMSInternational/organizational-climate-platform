import { describe, expect, it } from 'vitest'
import { widestUsable } from './adminDemographics'

describe('widestUsable', () => {
  it('is the most values that still hold the floor on average, and what each would hold', () => {
    // 42 active people, floor 5: 8 values hold 5 each on average (5,25), 9 would hold 4,67.
    expect(widestUsable(42, 5)).toEqual({ values: 8, perValue: 5 })
    expect(widestUsable(10, 5)).toEqual({ values: 2, perValue: 5 })
  })

  it('offers nothing when not even two values would clear the floor', () => {
    expect(widestUsable(9, 5)).toBeNull()
    expect(widestUsable(Number.NaN, 5)).toBeNull()
  })
})
