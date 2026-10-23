/**
 * Crear's Apertura and Cierre on the COMPANY's clock -- the rule #630 gave Nueva encuesta (G16),
 * through the same helper (`zonedWindow.ts`).
 *
 * A microclimate's `startTime` and `endTime` are instants (`timestamptz`; the lifecycle sweep
 * closes on `EndTime <= now`, `MicroclimateLifecycleSchedule.cs`), and `scheduling_timezone` is
 * display metadata the client sends. The form edits wall-clock strings, `2026-10-28T23:59`;
 * they are read on the company's settings zone, and only on the browser's when that cannot be
 * read -- which the schedule card then says.
 *
 * Every function here names its zone. None reads the browser's own zone except through
 * `sessionZone`'s fallback, so a test proves the rule by pinning a zone, not by running on a
 * laptop that happens to share it.
 */

import { instantOfWallClock, wallClockIn } from '../../../surveys/next/authoring/zonedWindow'
import { defaultWindow } from '../derive'

export { sessionZone } from '../../wizardValues'

/** The instant a wall clock names in `timeZone`, or null when it is unset or unparseable. */
export function instantIn(wallClock: string, timeZone: string): Date | null {
  return wallClock ? instantOfWallClock(wallClock, timeZone) : null
}

/** Milliseconds from `start` to `end`, both read in `timeZone`; null when missing or out of order. */
export function zonedWindowMs(start: string, end: string, timeZone: string): number | null {
  const from = instantIn(start, timeZone)
  const to = instantIn(end, timeZone)
  if (!from || !to || to.getTime() <= from.getTime()) return null
  return to.getTime() - from.getTime()
}

/**
 * `derive.ts`'s default window -- the current quarter hour, for the previous session's length
 * or 48 hours -- as the wall clocks it reads in `timeZone`.
 */
export function defaultWallWindow(
  now: Date,
  timeZone: string,
  previous?: { startTime: string; endTime: string } | null,
): { start: Date; startTime: string; endTime: string } {
  const { start, end } = defaultWindow(now, previous)
  return { start, startTime: wallClockIn(start, timeZone) ?? '', endTime: wallClockIn(end, timeZone) ?? '' }
}

function yearIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at)
}

/** "9 sept" in `timeZone` -- `format.ts`'s `shortDay`, the year only when it is not this one. */
export function shortDayIn(at: Date, locale: string, timeZone: string, now: Date = new Date()): string {
  const thisYear = yearIn(at, timeZone) === yearIn(now, timeZone)
  return at.toLocaleDateString(locale, { timeZone, day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }) })
}

/** "21:06" in `timeZone`, a 24-hour clock in every locale. */
export function clockIn(at: Date, locale: string, timeZone: string): string {
  return at.toLocaleTimeString(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "lunes" in `timeZone`. */
export function weekdayIn(at: Date, locale: string, timeZone: string): string {
  return at.toLocaleDateString(locale, { timeZone, weekday: 'long' })
}

/** "lun 14" in `timeZone`. */
export function weekdayDayIn(at: Date, locale: string, timeZone: string): string {
  return at.toLocaleDateString(locale, { timeZone, weekday: 'short', day: 'numeric' })
}
