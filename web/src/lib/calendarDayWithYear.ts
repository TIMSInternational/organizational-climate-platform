/**
 * One calendar day WITH its year, in the reader's locale and in UTC — `12 ago 2026`,
 * `12 Aug 2026` — for the per-role canvas's record lines ("Actualizado el 12 ago 2026",
 * "Revisado por Ana Admin el 13 ago 2026") that state when something was written down.
 *
 * `calendarDay` (`lib/calendarDay.ts`) drops the year inside the current one, which is right
 * for a list of this year's surveys and wrong for an audit line: a record read next January
 * must still say which year it belongs to. Same UTC reading as `calendarDay`, for its
 * reasons; only the year rule differs. A malformed date degrades to "Invalid Date" rather
 * than throwing, as `toLocaleDateString` is specified to.
 */
export function calendarDayWithYear(value: number | Date, locale: string): string {
  return new Date(value).toLocaleDateString(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
