import { describe, it, expect } from 'vitest'
import { sampleWave } from './sampleModel'

/**
 * The sample is the ONE reading no endpoint returns: the opened group's 1–5 answer
 * distribution. The wave-over-wave readings it used to carry — the change since the
 * previous wave, the rises in a row — are measured now (`compose.ts`
 * `composePrevious`), and they must not creep back in here: a sampled change beside a
 * measured one is two answers to one question on one screen.
 */
describe('sampleWave', () => {
  it('carries the group distribution and nothing else', () => {
    expect(Object.keys(sampleWave).sort()).toEqual(['groupDistribution', 'isSample'])
    expect(sampleWave.isSample).toBe(true)
  })

  it('is a whole distribution: every scale point 1..5 once, summing to 100 %', () => {
    expect(sampleWave.groupDistribution.map((point) => point.position)).toEqual([1, 2, 3, 4, 5])
    expect(sampleWave.groupDistribution.reduce((sum, point) => sum + point.percentage, 0)).toBe(100)
  })
})
