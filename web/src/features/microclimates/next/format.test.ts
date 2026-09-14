import { describe, it, expect } from 'vitest'
import { numericDayTime } from './format'

describe('numericDayTime', () => {
  it('writes the board’s "14/09/2026 · 08:00" in Spanish: the day first, two digits each', () => {
    expect(numericDayTime(new Date(2026, 8, 14, 8, 0), 'es')).toBe('14/09/2026 · 08:00')
  })

  it('keeps a 24-hour clock in every locale, as the rest of the boards print a time', () => {
    // The native `datetime-local` this replaced read "10:30 PM" in the refuter's en-US browser.
    expect(numericDayTime(new Date(2026, 8, 10, 22, 30), 'es')).toBe('10/09/2026 · 22:30')
    expect(numericDayTime(new Date(2026, 8, 10, 22, 30), 'en')).toBe('09/10/2026 · 22:30')
  })

  it('writes midnight as 00:00, not 24:00', () => {
    expect(numericDayTime(new Date(2026, 8, 16, 0, 0), 'es')).toBe('16/09/2026 · 00:00')
  })
})
