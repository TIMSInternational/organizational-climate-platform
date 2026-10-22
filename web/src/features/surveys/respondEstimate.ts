/**
 * How long a questionnaire takes, from the only input every payload offers: its
 * question count.
 *
 * Two thirds of a minute a question, floored at one — the ratio the approved employee
 * design reads ("12 questions · about 8 minutes") and the one the canvas prints for
 * Grupo Meridiano's six-question Q4 ("unos 4 minutos", RespondSurveyPhone and
 * EmployeeDashboard, 10 Sep). Deliberately coarse: every catalogue string that prints
 * it says "about", and a survey that reported its own estimate would be a server field
 * rather than this arithmetic.
 *
 * Moved here from `dashboard/components/EmployeeDashboardView.tsx` so that the Home
 * card and the respond page's footer cannot quote the same survey two different ways.
 * That file keeps a private copy only because it is left as it was, as the wiring
 * reference: nothing routes to it or imports it any more (`router.test.ts`).
 */
export function estimatedMinutes(questionCount: number): number {
  return Math.max(1, Math.round((questionCount * 2) / 3))
}

/**
 * Whether the estimate is best said as "under a minute" rather than as a number.
 *
 * `estimatedMinutes` floors at one, and "about 1 minutes" is both ungrammatical and an
 * overstatement for the one- and two-question pulse the canvas draws with "menos de un
 * minuto" (RespondMicroclimatePhone). One minute or less reads as under a minute.
 */
export function isUnderAMinute(questionCount: number): boolean {
  return estimatedMinutes(questionCount) <= 1
}

/**
 * The day a survey closes, as the respond footers print it inside a sentence — "10 de
 * octubre", "October 10" — with no year, as the canvas writes "Cierra el 10 de octubre" and
 * "Abierta hasta el 11 de septiembre".
 *
 * **In the reader's own zone.** A close is an instant, not a UTC calendar day: the builder
 * sends the administrator's wall clock (`new Date(local).toISOString()`, `wizardValues.ts`),
 * the API stores it with `ToUniversalTime()` and stops taking answers at `EndDate <= now`.
 * This used to be read in UTC, and a close at or after 18:00 in Costa Rica printed as the
 * next day — a deadline a day later than the one the server enforces (audit 2026-10-22,
 * R2). Every caller is a respondent screen: the respond form, the employee Home and the
 * microclimate pulse, whose `closesAt` is an instant too.
 *
 * `timeZone` is injectable only so a test can pin the zone; callers omit it. The value is
 * returned unchanged when it does not parse, so a malformed date reads as what the server
 * sent rather than as "Invalid Date".
 */
export function formatDayMonth(value: string, locale: string, timeZone?: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone }).format(parsed)
}
