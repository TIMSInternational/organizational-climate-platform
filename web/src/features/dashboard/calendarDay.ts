/**
 * Formatting for the dashboard's survey dates.
 *
 * ## Why these are read in UTC and not in the reader's zone
 *
 * A survey's `StartDate` and `EndDate` are **calendar days**, not instants. The API
 * stores and returns them as UTC midnights (`2026-06-12T00:00:00Z` is "the twelfth"),
 * and `SurveyValidation` compares them as whole days. `new Date(iso).toLocaleDateString()`
 * renders that instant in the browser's zone, and every zone west of UTC lands on the
 * day before: measured in America/Chicago, `2026-06-12T00:00:00Z` printed as 6/11/2026.
 *
 * That is a wrong date on the one figure the reader is being asked to act on, and it is
 * wrong on the company dashboard twice over — once in the cycle timeline and once in
 * the ongoing-surveys table beneath it — so both go through here and cannot disagree.
 *
 * The locale still comes from the reader: 12/6/2026 in Spanish and 6/12/2026 in English
 * is a *rendering* of the same day, which is exactly what should follow the language,
 * whereas the day itself should not.
 */

/**
 * One calendar day, in the reader's locale but in UTC.
 *
 * `value` is an epoch-milliseconds instant, as `Date.parse` returns, or a `Date`.
 * `toLocaleDateString` is specified to answer "Invalid Date" for `NaN` rather than
 * throwing — checked, in this Node, with the option bag applied — so a malformed
 * date degrades the same way it did before this function existed instead of taking
 * the page down.
 */
export function calendarDay(value: number | Date, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { timeZone: 'UTC' })
}
