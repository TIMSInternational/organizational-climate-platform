import { describe, expect, it } from 'vitest'
import { dayMonthIn, daysFromIn, yearIn, dayTimeIn, instantOfWallClock, isKnownTimeZone, wallClockIn, zoneLabel } from './zonedWindow'

const CR = 'America/Costa_Rica'

describe('zonedWindow — the survey window on the company clock (G16)', () => {
  it('reads an instant as the wall clock in the company zone, not the browser zone', () => {
    // 05:59 UTC on the 29th is 23:59 on the 28th in Costa Rica (UTC-6, no DST).
    expect(wallClockIn('2026-10-29T05:59:00Z', CR)).toBe('2026-10-28T23:59')
    expect(wallClockIn('2026-10-29T05:59:00Z', 'UTC')).toBe('2026-10-29T05:59')
  })

  it('turns a company wall clock into the true instant', () => {
    expect(instantOfWallClock('2026-10-28T23:59', CR)?.toISOString()).toBe('2026-10-29T05:59:00.000Z')
    expect(instantOfWallClock('2026-10-28T23:59', 'Asia/Tokyo')?.toISOString()).toBe('2026-10-28T14:59:00.000Z')
  })

  it('round-trips on both sides of a DST change in a zone that has one', () => {
    // New York: EDT (UTC-4) until 1 Nov 2026, EST (UTC-5) after.
    expect(instantOfWallClock('2026-10-31T12:00', 'America/New_York')?.toISOString()).toBe('2026-10-31T16:00:00.000Z')
    expect(instantOfWallClock('2026-11-02T12:00', 'America/New_York')?.toISOString()).toBe('2026-11-02T17:00:00.000Z')
    // An hour after the fall-back (02:00 EDT → 01:00 EST): the offset at the naive guess is the
    // summer one, and only asking again at the candidate lands on the winter reading.
    expect(instantOfWallClock('2026-11-01T03:00', 'America/New_York')?.toISOString()).toBe('2026-11-01T08:00:00.000Z')
    for (const wall of ['2026-10-31T12:00', '2026-11-02T12:00', '2026-03-09T08:30', '2026-11-01T03:00']) {
      const instant = instantOfWallClock(wall, 'America/New_York')!
      expect(wallClockIn(instant, 'America/New_York')).toBe(wall)
    }
  })

  it('refuses what it cannot read rather than inventing a date', () => {
    expect(instantOfWallClock('28/10/2026 23:59', CR)).toBeNull()
    expect(instantOfWallClock('2026-10-28T23:59', 'Not/AZone')).toBeNull()
    expect(wallClockIn('nonsense', CR)).toBeNull()
    expect(isKnownTimeZone('Not/AZone')).toBe(false)
    expect(isKnownTimeZone(null)).toBe(false)
    expect(isKnownTimeZone(CR)).toBe(true)
  })

  it('names the zone with its offset, and prints day and 24-hour time in that zone', () => {
    expect(zoneLabel(CR, Date.parse('2026-10-28T12:00:00Z'))).toBe('America/Costa_Rica (GMT-6)')
    expect(dayTimeIn('2026-10-29T05:59:00Z', CR, 'es')).toBe('28 oct 2026 · 23:59')
    expect(dayTimeIn('2026-10-29T05:59:00Z', CR, 'en')).toBe('Oct 28, 2026 · 23:59')
  })

  it('counts whole days and names the day and year in the company zone', () => {
    // 05:59 UTC on 1 Jan 2027 is still 31 Dec 2026 in Costa Rica.
    const close = '2027-01-01T05:59:00Z'
    expect(dayMonthIn(close, CR, 'es')).toBe('31 dic')
    expect(yearIn(close, CR)).toBe('2026')
    expect(yearIn(close, 'UTC')).toBe('2027')
    // 18:00 on 30 Dec in Costa Rica: the close is tomorrow there, two days away in UTC.
    expect(daysFromIn(close, new Date('2026-12-31T00:00:00Z'), CR)).toBe(1)
    expect(daysFromIn(close, new Date('2026-12-31T00:00:00Z'), 'UTC')).toBe(1)
    expect(daysFromIn(close, new Date('2026-12-30T23:00:00Z'), CR)).toBe(1)
    expect(daysFromIn(close, new Date('2026-12-30T23:00:00Z'), 'UTC')).toBe(2)
    expect(daysFromIn('nonsense', new Date(), CR)).toBeNull()
  })
})
