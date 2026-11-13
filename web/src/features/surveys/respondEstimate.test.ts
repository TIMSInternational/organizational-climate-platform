import { describe, it, expect } from 'vitest'
import { formatDayMonth } from './respondEstimate'

/** Audit 2026-10-22, R2: "Cierra el …" on the respondent's own clock. */
describe('formatDayMonth', () => {
  it('pins a 00:30 UTC close to the previous calendar day in Costa Rica', () => {
    // 18:30 on 27 Oct in Costa Rica, when the server stops taking answers.
    expect(formatDayMonth('2026-10-28T00:30:00Z', 'es', 'America/Costa_Rica')).toBe('27 de octubre')
    expect(formatDayMonth('2026-10-28T00:30:00Z', 'en', 'America/Costa_Rica')).toBe('October 27')
  })

  it('is the zone that decides: the same instant in UTC is the 28th', () => {
    expect(formatDayMonth('2026-10-28T00:30:00Z', 'es', 'UTC')).toBe('28 de octubre')
  })

  it('reads the reader’s own zone when none is given', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/Costa_Rica'
    try {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Costa_Rica')
      expect(formatDayMonth('2026-10-28T00:30:00Z', 'es')).toBe('27 de octubre')
    } finally {
      process.env.TZ = original
    }
  })

  it('returns a value it cannot parse as the server sent it', () => {
    expect(formatDayMonth('not a date', 'es')).toBe('not a date')
  })
})
