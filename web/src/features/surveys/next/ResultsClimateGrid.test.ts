import { describe, it, expect } from 'vitest'
import { gridMinWidthRem } from './ResultsClimateGrid'

describe('gridMinWidthRem', () => {
  it('keeps the six-dimension artboard width and grows with every dimension past it', () => {
    expect(gridMinWidthRem(6, false)).toBe(59)
    // EAGLE: ten dimensions squeezed into 59rem collided headers at 1440 (2026-10-12).
    expect(gridMinWidthRem(10, false)).toBeGreaterThan(gridMinWidthRem(9, false))
    expect(gridMinWidthRem(10, false)).toBeGreaterThanOrEqual(10 * 5.5)
    expect(gridMinWidthRem(10, true)).toBeGreaterThan(gridMinWidthRem(10, false))
  })
})
