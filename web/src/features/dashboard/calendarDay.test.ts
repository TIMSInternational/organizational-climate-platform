import { describe, it, expect, afterEach } from 'vitest'
import { calendarDay } from './calendarDay'

/**
 * The ambient zone, restored after every case.
 *
 * These tests set `process.env.TZ` themselves rather than trusting the machine's own,
 * and that is the load-bearing part: the bug this function fixes is invisible in UTC,
 * so a test that ran in whatever zone CI happens to use could pass without exercising
 * anything. Node re-reads `TZ` on the next date formatting, which is checked by the
 * two cases below disagreeing with each other.
 */
const AMBIENT = process.env.TZ

afterEach(() => {
  if (AMBIENT === undefined) delete process.env.TZ
  else process.env.TZ = AMBIENT
})

describe('calendarDay', () => {
  /**
   * The defect, exactly. A survey ending on the twelfth arrives as `2026-06-12T00:00:00Z`;
   * read in Chicago that instant is the evening of the eleventh, and the dashboard
   * announced a deadline a day early.
   */
  it('reads a UTC midnight as the calendar day it stands for, west of UTC', () => {
    process.env.TZ = 'America/Chicago'
    expect(calendarDay(Date.parse('2026-06-12T00:00:00Z'), 'en')).toBe('6/12/2026')
  })

  /** And east of it, where a late instant would otherwise roll forward instead of back. */
  it('does not roll a late instant forward east of UTC', () => {
    process.env.TZ = 'Pacific/Kiritimati'
    expect(calendarDay(Date.parse('2026-06-12T23:00:00Z'), 'en')).toBe('6/12/2026')
  })

  /**
   * The locale still decides the ORDER of the fields. It is the day that must not move,
   * not the way the day is written.
   */
  it('still writes the day the way the reader’s language writes it', () => {
    process.env.TZ = 'America/Chicago'
    expect(calendarDay(Date.parse('2026-06-12T00:00:00Z'), 'es')).toBe('12/6/2026')
  })

  /** A malformed date degrades rather than throwing, as it did before this existed. */
  it('does not throw on a date it cannot parse', () => {
    expect(() => calendarDay(Date.parse('not a date'), 'en')).not.toThrow()
  })
})
