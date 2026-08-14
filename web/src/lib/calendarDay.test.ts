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

/** A fixed "today", so the year rule is tested rather than the year CI runs in. */
const NOW = Date.parse('2026-08-12T12:00:00Z')

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
    expect(calendarDay(Date.parse('2026-06-12T00:00:00Z'), 'en', NOW)).toBe('Jun 12')
  })

  /** And east of it, where a late instant would otherwise roll forward instead of back. */
  it('does not roll a late instant forward east of UTC', () => {
    process.env.TZ = 'Pacific/Kiritimati'
    expect(calendarDay(Date.parse('2026-06-12T23:00:00Z'), 'en', NOW)).toBe('Jun 12')
  })

  /**
   * The locale still decides how the day is written. It is the day that must not move,
   * not the way the day is spelled.
   */
  it('still writes the day the way the reader’s language writes it', () => {
    process.env.TZ = 'America/Chicago'
    expect(calendarDay(Date.parse('2026-06-12T00:00:00Z'), 'es', NOW)).toBe('12 jun')
  })

  /**
   * The design's shape — a short human date, never `9/12/2026`. English writes it
   * month-first (`Sep 12`) and Spanish day-first (`12 sept`); see the note in
   * `calendarDay.ts` on why neither is spelled exactly as the mock's hand-written
   * `12 Sep`. Guarded explicitly because reverting
   * the option bag to a bare `toLocaleDateString(locale)` restores the *correct day* and
   * would otherwise leave every case above green.
   */
  it('writes a day of the current year as day and short month, with no year', () => {
    process.env.TZ = 'UTC'
    expect(calendarDay(Date.parse('2026-09-12T00:00:00Z'), 'en', NOW)).toBe('Sep 12')
  })

  /** Outside the current year the year is appended, so `12 Sep` is never ambiguous. */
  it('appends the year for a day outside the reader’s current year', () => {
    process.env.TZ = 'UTC'
    expect(calendarDay(Date.parse('2025-09-12T00:00:00Z'), 'en', NOW)).toBe('Sep 12, 2025')
  })

  /**
   * The year rule is decided in UTC too, and this case is built so that the UTC answer
   * and the local answer *disagree* — an earlier version of this test picked an instant
   * where both agreed, so it passed against a `getFullYear()` implementation and guarded
   * nothing.
   *
   * In Kiritimati (UTC+14), `2026-12-31T23:00` UTC is already 1 January 2027 locally.
   * So for a day in January 2026: UTC says same year (2026 === 2026) and prints no year;
   * local says different (2026 !== 2027) and would print one.
   */
  it('decides the year rule in UTC, not in the reader’s zone', () => {
    process.env.TZ = 'Pacific/Kiritimati'
    const januaryFirst = Date.parse('2026-01-01T00:00:00Z')
    const newYearEveUtc = Date.parse('2026-12-31T23:00:00Z')
    expect(calendarDay(januaryFirst, 'en', newYearEveUtc)).toBe('Jan 1')
  })

  /** A malformed date degrades rather than throwing, as it did before this existed. */
  it('does not throw on a date it cannot parse', () => {
    expect(() => calendarDay(Date.parse('not a date'), 'en', NOW)).not.toThrow()
  })
})
