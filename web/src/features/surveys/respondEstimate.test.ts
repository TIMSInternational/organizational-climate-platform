import { describe, it, expect } from 'vitest'
import { estimatedMinutes, formatDayMonth, isUnderAMinute } from './respondEstimate'

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

/** PROCOMER, 2026-11-19: «38 es mucho» for 57 questions — about 30. */
describe('estimatedMinutes', () => {
  it('quotes PROCOMER’s 57 questions as 30 minutes, not 38', () => {
    expect(estimatedMinutes(57)).toBe(30)
  })

  it('is half a minute a question below 15 minutes', () => {
    expect(estimatedMinutes(6)).toBe(3)
    expect(estimatedMinutes(12)).toBe(6)
    expect(estimatedMinutes(28)).toBe(14)
  })

  it('rounds to the nearest five from 15 minutes up', () => {
    expect(estimatedMinutes(30)).toBe(15)
    expect(estimatedMinutes(40)).toBe(20)
    expect(estimatedMinutes(64)).toBe(30)
    expect(estimatedMinutes(66)).toBe(35)
  })

  it('never says zero, and one or two questions read as under a minute', () => {
    expect(estimatedMinutes(0)).toBe(1)
    expect(estimatedMinutes(1)).toBe(1)
    expect(isUnderAMinute(2)).toBe(true)
    expect(isUnderAMinute(3)).toBe(false)
  })
})
