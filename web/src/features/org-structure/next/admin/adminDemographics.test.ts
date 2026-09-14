import { describe, expect, it } from 'vitest'
import { mergedRanges } from './adminDemographics'

describe('mergedRanges', () => {
  it('merges neighbouring values in pairs until the mean clears the floor — the board’s 9 bands over 42 people', () => {
    // 42 ÷ 9 = 4,67 → under 5; ⌈9 ÷ 2⌉ = 5 ranges hold ⌊42 ÷ 5⌋ = 8 each.
    expect(mergedRanges(42, 9, 5)).toEqual({ ranges: 5, perValue: 8 })
    // 20 → 10 (4 each, still under) → 5 (8 each).
    expect(mergedRanges(42, 20, 5)).toEqual({ ranges: 5, perValue: 8 })
    // 3 → 2: 12 people in two ranges of 6.
    expect(mergedRanges(12, 3, 5)).toEqual({ ranges: 2, perValue: 6 })
  })

  it('offers nothing when no merge leaves two ranges that clear the floor', () => {
    expect(mergedRanges(8, 2, 5)).toBeNull()
    expect(mergedRanges(9, 3, 5)).toBeNull()
    expect(mergedRanges(42, 1, 5)).toBeNull()
    expect(mergedRanges(Number.NaN, 9, 5)).toBeNull()
  })

  it('never suggests a list whose printed mean is under the floor, and prints the mean the column would', () => {
    for (let people = 0; people <= 80; people += 1) {
      for (let values = 2; values <= 16; values += 1) {
        const merged = mergedRanges(people, values, 5)
        if (merged === null) continue
        expect(merged.ranges).toBeGreaterThanOrEqual(2)
        expect(merged.ranges).toBeLessThanOrEqual(values)
        expect(merged.perValue).toBe(Math.floor(people / merged.ranges))
        expect(merged.perValue).toBeGreaterThanOrEqual(5)
      }
    }
  })
})
