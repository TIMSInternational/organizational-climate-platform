/**
 * A `yyyy-MM-dd` calendar day, printed as a day. Parsed into a LOCAL date on purpose:
 * `new Date('2026-10-12')` is midnight UTC, which a reader west of Greenwich sees as the 11th.
 * The server stores a day and nothing finer, so there is no time to convert.
 */
export function formatParticipationDay(day: string, locale: string): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(year, month - 1, date),
  )
}
