/**
 * How the microclimate boards write an instant. A microclimate's `startTime` and `endTime`
 * are minutes, not calendar days (`lib/calendarDay.ts` `instantDay` carries the argument),
 * so every one of these reads the instant in the reader's own zone — which is why the board,
 * drawn on a machine in America/Chicago, says the demo pulse opened "9 sept, 21:06".
 */

function sameYear(date: Date, now: Date = new Date()): boolean {
  return date.getFullYear() === now.getFullYear()
}

/** "11 de septiembre" — the month written out, the year only when it is not this one. */
export function longDay(iso: string, locale: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(sameYear(date) ? {} : { year: 'numeric' }) })
}

/** "21:06" — a 24-hour clock in every locale, as the boards print it. */
export function clock(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "9 sept 2026" — the Ficha's day, always with its year. */
export function shortDayYear(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "9 sept" — the year only when it is not this one. */
export function shortDay(iso: string, locale: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(sameYear(date) ? {} : { year: 'numeric' }) })
}

/** "9–11 sept": the locale's own range format, so English reads "Sep 9 – 11". */
export function dayRange(startIso: string, endIso: string, locale: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return shortDay(startIso, locale)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).formatRange(start, end)
}

/** "lunes". */
export function weekdayLong(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { weekday: 'long' })
}

/** "lun 14". */
export function weekdayDay(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
}

/**
 * "14/09/2026 · 08:00" — Crear's Apertura and Cierre as the MicroclimateCreate board writes
 * them: the numeric day in the page's locale (day first in Spanish) and the 24-hour `clock`,
 * whatever the browser's own locale. The native `datetime-local` it replaced printed the
 * browser's format, so a Spanish screen in an en-US browser read "09/10/2026, 10:30 PM".
 */
export function numericDayTime(date: Date, locale: string): string {
  const day = date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${day} · ${clock(date.toISOString(), locale)}`
}
