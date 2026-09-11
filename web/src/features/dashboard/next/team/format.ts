import type { TranslateFn } from '../../../../i18n'

/**
 * The small formatters both team dashboards share. A module of its own, not `parts.tsx`:
 * `react(only-export-components)` fails a file that exports a component and a plain value
 * together, and the lint budget is a hard ceiling.
 */

/** A count in the reader's locale. */
export function count(value: number, locale: string): string {
  return value.toLocaleString(locale)
}

/** A 1–5 reading as a share of the bar: 1 is empty, 5 is full — the canvas's scale. */
export function barPercent(value: number): number {
  return Math.min(100, Math.max(0, ((value - 1) / 4) * 100))
}

/** "en 4 días", "vence hoy", "vencido hace 2 días" — the tablero's own words for a compromiso. */
export function daysNote(days: number, t: TranslateFn): string {
  if (days < 0) return t('tracking.next.overdueBy', { days: -days })
  if (days === 0) return t('tracking.next.dueToday')
  return days === 1 ? t('tracking.next.inOneDay') : t('tracking.next.inDays', { days })
}
