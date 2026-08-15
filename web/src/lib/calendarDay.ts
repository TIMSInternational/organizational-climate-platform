/**
 * The one way this product prints a calendar day.
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
 * ## Why it lives in `lib/` and why the format changed
 *
 * It was `features/dashboard/calendarDay.ts` while the dashboard was the only screen
 * that had thought about the zone bug. Every other table reached for a bare
 * `toLocaleDateString(locale)` and printed `9/11/2026` — both the wrong *day* west of
 * UTC and the wrong *shape*: the approved design writes dates as `12 Sep`, sixteen times
 * across the briefs and never once numerically. Two drifts with one cause, so the fix is
 * one shared function rather than fourteen edited call sites that can diverge again.
 *
 * ## Why this is not byte-identical to the design's `12 Sep`
 *
 * No locale produces that string. `en` gives `Sep 12`, and both `en-GB` and `es` give
 * `12 Sept` — CLDR spells the English abbreviation with the t. The design's dates are
 * hand-written HTML in one language, so matching them literally would mean shipping our
 * own month-name table and losing every locale we do not hand-write. The design's
 * intent — a short human date instead of `9/11/2026` — is what is implemented, in the
 * shape each language actually writes it. That follows the rule this file already had:
 * the day must not move, but the way the day is *written* belongs to the reader.
 *
 * ## The year
 *
 * The design shows no years, because every date in it falls in the mocked quarter. A
 * survey that closed in a *different* year rendered as a bare `12 Sep` would be actively
 * misleading on a product whose whole subject is periods, so the year is appended when —
 * and only when — the day is outside the reader's current year. No date the design
 * depicts is changed by this rule.
 */

/**
 * One calendar day, in the reader's locale but in UTC, as `12 Sep` (or `12 Sep 2025`
 * outside the current year).
 *
 * `value` is an epoch-milliseconds instant, as `Date.parse` returns, or a `Date`.
 * `toLocaleDateString` is specified to answer "Invalid Date" for `NaN` rather than
 * throwing — checked, in this Node, with the option bag applied — so a malformed
 * date degrades the same way it did before this function existed instead of taking
 * the page down.
 *
 * `now` is injectable so the year rule can be tested against a fixed clock rather than
 * against whatever year the suite happens to run in.
 */
export function calendarDay(value: number | Date, locale: string, now: number | Date = Date.now()): string {
  const date = new Date(value)
  // Compare in UTC, for the same reason the day is *rendered* in UTC: a reader east of
  // UTC on 1 January must not see last year's dates gain a year because their local
  // clock has already rolled over.
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear()
  return date.toLocaleDateString(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
