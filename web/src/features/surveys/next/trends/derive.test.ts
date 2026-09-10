import { describe, it, expect } from 'vitest'
import { axisTicks, deltaSince, latestValue, standing, standings, waveMean } from './derive'
import type { TrendDimension } from './model'

const dims: TrendDimension[] = [
  { key: 'a', name: 'A', values: [3.3, 3.7, 4.0] },
  { key: 'b', name: 'B', values: [3.0, 3.3, 3.7] },
  { key: 'c', name: 'C', values: [2.8, 3.1, 3.4] },
]

describe('trends derive', () => {
  it('judges a reading against the target at one decimal: above, on, below', () => {
    expect(standing(4.0, 3.7)).toBe('above')
    expect(standing(3.7, 3.7)).toBe('on')
    expect(standing(3.71, 3.7)).toBe('on')
    expect(standing(3.4, 3.7)).toBe('below')
    expect(standings(dims, 3.7).map((s) => s.standing)).toEqual(['above', 'on', 'below'])
  })

  it('never differences from or to a withheld wave, and does difference across one', () => {
    const values = [3.0, null, 3.6]
    expect(latestValue({ key: 'x', name: 'X', values })).toBe(3.6)
    // From a withheld wave: null, never 0 — a zero would read as "no change".
    expect(deltaSince(values, 1)).toBeNull()
    expect(deltaSince([null, 3.2, 3.6], 0)).toBeNull()
    // Across a withheld wave: both endpoints are disclosed, so the delta is.
    expect(deltaSince(values, 0)).toBeCloseTo(0.6)
    // To: the latest *disclosed* wave, so a trailing withheld wave is skipped, not differenced.
    expect(deltaSince([3.0, 3.2, null], 0)).toBeCloseTo(0.2)
    expect(deltaSince([3.0, 3.2, null], 1)).toBeNull()
    expect(deltaSince([null, null], 0)).toBeNull()
  })

  it('averages a wave over the dimensions that disclosed it, leaving withheld ones out of the denominator', () => {
    expect(waveMean(dims, 2)).toBeCloseTo((4.0 + 3.7 + 3.4) / 3)
    expect(waveMean([{ key: 'x', name: 'X', values: [null] }], 0)).toBeNull()
    const mixed: TrendDimension[] = [
      { key: 'a', name: 'A', values: [4.0] },
      { key: 'b', name: 'B', values: [null] },
      { key: 'c', name: 'C', values: [3.0] },
    ]
    expect(waveMean(mixed, 0)).toBeCloseTo(3.5)
  })

  it('draws 0.5-step ticks that enclose every reading and the target', () => {
    expect(axisTicks([3.3, 3.7, 4.0], 3.7)).toEqual([3.0, 3.5, 4.0, 4.5])
    expect(axisTicks([2.8, null, 3.4], 3.7)).toEqual([2.5, 3.0, 3.5, 4.0])
  })
})
