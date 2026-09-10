import { describe, it, expect } from 'vitest'
import { isBelowTarget, nextWaveCode } from './derive'
import { printedReading } from './compose'

describe('the next slot of a quarterly cycle', () => {
  it('names the quarter after, and the next year after a Q4', () => {
    expect(nextWaveCode('Q2', '2026-05-13')).toBe('Q3')
    expect(nextWaveCode('Q4', '2026-10-10T02:03:39Z')).toBe('Q1 2027')
    expect(nextWaveCode('Q3 2026', undefined)).toBe('Q4 2026')
    expect(nextWaveCode('Q4 2026', undefined)).toBe('Q1 2027')
  })

  it('names nothing for a wave that is not a quarter, or a Q4 with no year to roll', () => {
    expect(nextWaveCode('Pulso de marzo', '2026-03-01')).toBeNull()
    expect(nextWaveCode('Q4', undefined)).toBeNull()
  })
})

describe('a reading is judged at the decimal it prints', () => {
  it('calls 3.67 on a 3.7 target — it prints "3,7" — and 3.64 below it', () => {
    expect(isBelowTarget(3.67, 3.7)).toBe(false)
    expect(isBelowTarget(3.64, 3.7)).toBe(true)
    expect(isBelowTarget(3.3, 3.7)).toBe(true)
    expect(isBelowTarget(3.8, 3.7)).toBe(false)
  })

  it('tints the number the cell prints', () => {
    expect(printedReading(3.79)).toBe(3.8)
    expect(printedReading(3.67)).toBe(3.7)
    expect(printedReading(2.4)).toBe(2.4)
  })
})
