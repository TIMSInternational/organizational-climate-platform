import { describe, it, expect } from 'vitest'
import { planCalendarDay, todayIso } from './planDates'

/**
 * A `DateOnly` is a calendar day. Neither direction may move it.
 *
 * This repository has been bitten by both halves before, which is why they are
 * pinned rather than assumed: a timezone bug that cannot reproduce on a UTC host
 * is invisible until a user west of UTC reads the wrong compromiso date, or a user
 * east of UTC files an avance under tomorrow.
 */
describe('rendering a DateOnly', () => {
  it('prints the day the service sent, not the day before it', () => {
    // `new Date('2026-08-21')` is UTC midnight; rendered in America/Chicago without
    // `timeZone: 'UTC'` it is the twentieth.
    expect(planCalendarDay('2026-08-21', 'es', Date.parse('2026-06-01T00:00:00Z'))).toContain('21')
  })

  it('appends the year only outside the reader current year', () => {
    expect(planCalendarDay('2025-03-04', 'en', Date.parse('2026-06-01T00:00:00Z'))).toContain('2025')
    expect(planCalendarDay('2026-03-04', 'en', Date.parse('2026-06-01T00:00:00Z'))).not.toContain(
      '2026',
    )
  })

  it('shows the raw value rather than "Invalid Date" for something unparseable', () => {
    expect(planCalendarDay('not-a-date', 'es')).toBe('not-a-date')
  })
})

describe('todayIso', () => {
  it('is built from the LOCAL calendar fields, not from toISOString', () => {
    // 21:30 on the 21st in a zone two hours ahead of UTC is still the 21st locally,
    // but `toISOString()` would already say the 21st at 19:30Z — and at 01:30 local
    // on the 22nd it would say the 21st. The local fields are the only ones that
    // answer "what day is it where the person recording this is standing".
    const lateEvening = new Date(2026, 7, 21, 23, 30, 0)
    expect(todayIso(lateEvening)).toBe('2026-08-21')

    const earlyMorning = new Date(2026, 7, 22, 0, 15, 0)
    expect(todayIso(earlyMorning)).toBe('2026-08-22')
  })

  it('zero-pads to the YYYY-MM-DD a DateOnly parses', () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05')
  })
})
