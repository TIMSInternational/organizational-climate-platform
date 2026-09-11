import { CRITICAL_PRIORITY, HIGH_PRIORITY } from '../../insightVocabulary'
import type { AIInsightListItem } from '../../api/insights'
import type { CompanyPick, InsightRow, InsightsTally } from './model'

/**
 * The three headline counts, counted from the rows the page holds — never fetched, so a
 * headline can never disagree with the cards under it (the old page's rule). The latest
 * acknowledgement is read from the details, because the list DTO carries no date.
 */
export function tallyInsights(rows: readonly InsightRow[]): InsightsTally {
  const acknowledged = rows.filter((row) => row.item.isAcknowledged)
  const dated = acknowledged
    .map((row) => row.detail)
    .filter((detail): detail is NonNullable<typeof detail> => detail !== null && detail.acknowledgedAt !== null)
    .sort((a, b) => Date.parse(b.acknowledgedAt ?? '') - Date.parse(a.acknowledgedAt ?? ''))
  const latest = dated[0]
  return {
    total: rows.length,
    open: rows.length - acknowledged.length,
    high: rows.filter((row) => row.item.priority === HIGH_PRIORITY || row.item.priority === CRITICAL_PRIORITY).length,
    critical: rows.filter((row) => row.item.priority === CRITICAL_PRIORITY).length,
    acknowledged: acknowledged.length,
    latest: latest ? { by: latest.acknowledgedBy, at: latest.acknowledgedAt ?? '' } : null,
    oneAcknowledger: new Set(dated.map((detail) => detail.acknowledgedBy)).size <= 1,
  }
}

/**
 * The finding the panel opens on: the first one still waiting for review, else the first
 * in the server's order (newest first, `AIInsightEndpoints.cs:74-80`). `null` for no rows.
 */
export function defaultSelection(items: readonly AIInsightListItem[]): string | null {
  return (items.find((item) => !item.isAcknowledged) ?? items[0])?.id ?? null
}

/** The rail and the chip a priority draws: red for critical, amber for high, quiet otherwise. */
export function priorityTone(priority: string): 'critical' | 'warning' | 'neutral' {
  if (priority === CRITICAL_PRIORITY) return 'critical'
  return priority === HIGH_PRIORITY ? 'warning' : 'neutral'
}

export type PickLine =
  | { kind: 'unreadable' }
  | { kind: 'nothing' }
  | { kind: 'no-insights' }
  | { kind: 'all-acknowledged'; total: number }
  | { kind: 'none-acknowledged'; total: number }
  | { kind: 'some-acknowledged'; total: number; acknowledged: number }

/**
 * The line under a company on the choose-a-company card, from its own list and the
 * platform's surveys. A company with no surveys can have no findings — they are read from
 * responses — so that case says both, and an unreadable list says so rather than "none".
 */
export function pickLine(pick: CompanyPick): PickLine {
  if (pick.insights === null) return { kind: 'unreadable' }
  const { total, acknowledged } = pick.insights
  if (total === 0) return pick.surveys === 0 ? { kind: 'nothing' } : { kind: 'no-insights' }
  if (acknowledged === total) return { kind: 'all-acknowledged', total }
  if (acknowledged === 0) return { kind: 'none-acknowledged', total }
  return { kind: 'some-acknowledged', total, acknowledged }
}

/** The acknowledger ids the details name, once each — one name lookup per person. */
export function acknowledgerIds(rows: readonly InsightRow[]): string[] {
  const ids = rows.map((row) => row.detail?.acknowledgedBy ?? null).filter((id): id is string => id !== null)
  return [...new Set(ids)]
}
