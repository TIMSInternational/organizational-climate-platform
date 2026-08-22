import { calendarDay } from '../../lib/calendarDay'

/**
 * The tracking service speaks `DateOnly`, and every date in this feature is a
 * calendar day rather than an instant.
 *
 * `PlanResponse` carries four of them — `FechaCreacion`, `FechaCompromiso`,
 * `FechaUltimaActualizacion` and the `Fecha` on every bitácora entry — and
 * `System.Text.Json` serialises a `DateOnly` as `"2026-08-21"`, with no time and no
 * zone. Two rules follow, and both have bitten this repository before:
 *
 * 1. **Render in UTC.** `new Date('2026-08-21')` is UTC midnight, and
 *    `toLocaleDateString()` in any zone west of UTC prints the twentieth.
 *    `lib/calendarDay.ts` exists for exactly this and is what this delegates to.
 * 2. **Never round-trip a day through `Date` on the way OUT.** `todayIso` builds
 *    the string from the local calendar fields rather than from `toISOString()`,
 *    which converts to UTC first and hands anyone east of UTC tomorrow's date from
 *    the moment their afternoon starts.
 */

/** A `DateOnly` string as the reader's short date, in UTC so the day cannot move. */
export function planCalendarDay(iso: string, locale: string, now: number | Date = Date.now()): string {
  const parsed = Date.parse(iso)
  // The raw value beats "Invalid Date": whatever the service sent is what whoever
  // has to debug it needs to see. Same rule as `ProfileDetailsForm.formatDate`.
  if (Number.isNaN(parsed)) return iso
  return calendarDay(parsed, locale, now)
}

/**
 * Today, as the `YYYY-MM-DD` a `<input type="date">` and a `DateOnly` both take.
 *
 * Built from the LOCAL calendar fields on purpose. `new Date().toISOString().slice(0, 10)`
 * is the obvious one-liner and is wrong for half the planet: at 21:00 in Bogotá it
 * still answers today, but at 21:00 in Madrid it answers tomorrow, and the value
 * lands in `FechaUltimaActualizacion` where the semáforo counts days off it.
 */
export function todayIso(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
