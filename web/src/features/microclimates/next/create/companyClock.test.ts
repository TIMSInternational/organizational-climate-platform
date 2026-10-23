import { describe, it, expect } from 'vitest'
import { clockIn, defaultWallWindow, instantIn, shortDayIn, weekdayIn, zonedWindowMs } from './companyClock'

/* Every zone is named: these hold under TZ=America/Chicago and TZ=UTC alike (G16). */
describe("Crear's company clock", () => {
  const CR = 'America/Costa_Rica'

  it("draws the default window as the company's wall clocks", () => {
    // 05:37Z on 23 Oct is 23:37 on 22 Oct in Costa Rica; the quarter hour is 23:30.
    const window = defaultWallWindow(new Date('2026-10-23T05:37:00Z'), CR)
    expect([window.startTime, window.endTime]).toEqual(['2026-10-22T23:30', '2026-10-24T23:30'])
  })

  it("keeps the previous session's length", () => {
    const window = defaultWallWindow(new Date('2026-10-23T05:37:00Z'), CR, {
      startTime: '2026-10-01T14:00:00Z',
      endTime: '2026-10-01T16:00:00Z',
    })
    expect([window.startTime, window.endTime]).toEqual(['2026-10-22T23:30', '2026-10-23T01:30'])
  })

  it('reads a wall clock as the instant it is in the zone, and nothing as nothing', () => {
    expect(instantIn('2026-10-22T23:30', CR)?.toISOString()).toBe('2026-10-23T05:30:00.000Z')
    expect(instantIn('', CR)).toBeNull()
  })

  it('measures a window on the zone, across a daylight-saving change', () => {
    expect(zonedWindowMs('2026-10-22T08:00', '2026-10-22T10:00', CR)).toBe(2 * 3_600_000)
    // 31 Oct 08:00 CDT to 2 Nov 08:00 CST is 49 hours, not 48.
    expect(zonedWindowMs('2026-10-31T08:00', '2026-11-02T08:00', 'America/Chicago')).toBe(49 * 3_600_000)
    expect(zonedWindowMs('2026-10-22T10:00', '2026-10-22T08:00', CR)).toBeNull()
  })

  it('writes the day, the clock and the weekday on the zone', () => {
    const at = new Date('2026-10-23T05:30:00Z')
    expect(shortDayIn(at, 'es', CR, at)).toBe('22 oct')
    expect(clockIn(at, 'es', CR)).toBe('23:30')
    expect(weekdayIn(at, 'es', CR)).toBe('jueves')
  })
})
