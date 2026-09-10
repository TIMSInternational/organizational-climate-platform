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

  it('never differences across a withheld wave', () => {
    const values = [3.0, null, 3.6]
    expect(latestValue({ key: 'x', name: 'X', values })).toBe(3.6)
    expect(deltaSince(values, 1)).toBeNull()
    expect(deltaSince(values, 0)).toBeCloseTo(0.6)
    expect(deltaSince([null, null], 0)).toBeNull()
  })

  it('averages a wave over the dimensions that disclosed it', () => {
    expect(waveMean(dims, 2)).toBeCloseTo((4.0 + 3.7 + 3.4) / 3)
    expect(waveMean([{ key: 'x', name: 'X', values: [null] }], 0)).toBeNull()
  })

  it('draws 0.5-step ticks that enclose every reading and the target', () => {
    expect(axisTicks([3.3, 3.7, 4.0], 3.7)).toEqual([3.0, 3.5, 4.0, 4.5])
    expect(axisTicks([2.8, null, 3.4], 3.7)).toEqual([2.5, 3.0, 3.5, 4.0])
  })
})
