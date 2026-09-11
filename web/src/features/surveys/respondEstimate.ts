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
 * Moved here from `dashboard/components/EmployeeDashboardView.tsx`, which keeps a
 * private copy while it still stands as the no-department fallback, so that the Home
 * card and the respond page's footer cannot quote the same survey two different ways.
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
 * A calendar day as the respond footers print it inside a sentence — "10 de octubre",
 * "October 10" — with no year, as the canvas writes "Cierra el 10 de octubre" and
 * "Abierta hasta el 11 de septiembre".
 *
 * `timeZone: 'UTC'` for the reason `lib/calendarDay.ts` exists: a close date is the end
 * of a calendar day stamped in UTC (Q4 closes `2026-10-10T02:03:39Z`), and formatted in
 * the reader's own zone it is the 9th for everyone west of UTC — which is the whole of
 * Costa Rica. The value is returned unchanged when it does not parse, so a malformed
 * date reads as what the server sent rather than as "Invalid Date".
 */
export function formatDayMonth(value: string, locale: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(parsed)
}
