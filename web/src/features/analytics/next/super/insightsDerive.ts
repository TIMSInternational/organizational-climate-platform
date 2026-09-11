import { CRITICAL_PRIORITY, HIGH_PRIORITY } from '../../insightVocabulary'
import type { AIInsight, AIInsightListItem } from '../../api/insights'
import { calendarDayOf } from '../../../../lib/calendarDay'
import type { CompanyPick, InsightRow, InsightsTally, ReviewedOn } from './insightsModel'

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

const PRIORITY_RANK: Record<string, number> = { [CRITICAL_PRIORITY]: 0, [HIGH_PRIORITY]: 1, medium: 2, low: 3 }

/** Most serious first: by priority, and at one priority a finding that names a risk first. */
function bySeverity(a: AIInsightListItem, b: AIInsightListItem): number {
  const rank = (item: AIInsightListItem) => PRIORITY_RANK[item.priority] ?? Object.keys(PRIORITY_RANK).length
  return rank(a) - rank(b) || Number(b.type === 'risk') - Number(a.type === 'risk')
}

/**
 * The finding the panel opens on: the most serious one still waiting for review, else — every
 * one reviewed — the most serious of them; ties keep the server's order (newest first,
 * `AIInsightEndpoints.cs:74-80`). The SuperAIInsightsSelected artboard opens Acme's risk
 * ("Engagement dipped in Engineering") over its trend at the same priority. `null` for no rows.
 */
export function defaultSelection(items: readonly AIInsightListItem[]): string | null {
  const open = items.filter((item) => !item.isAcknowledged)
  const pool = open.length > 0 ? open : items
  return [...pool].sort(bySeverity)[0]?.id ?? null
}

/**
 * When a company's findings were reviewed, from their details: the latest acknowledgement and
 * whether every one fell on its calendar day (the UTC day, as the rows print it). `null` when a
 * detail is missing or undated — the card then says "reviewed" without a date it was not given.
 */
export function reviewedOn(details: readonly (AIInsight | null)[]): ReviewedOn | null {
  if (details.length === 0) return null
  const dates: string[] = []
  for (const detail of details) {
    if (!detail?.acknowledgedAt) return null
    dates.push(detail.acknowledgedAt)
  }
  const latest = dates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
  const day = calendarDayOf(latest)
  return { latest, sameDay: dates.every((date) => calendarDayOf(date) === day) }
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
  | { kind: 'all-acknowledged'; total: number; on: string | null; sameDay: boolean }
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
  if (acknowledged === total) {
    return { kind: 'all-acknowledged', total, on: pick.reviewed?.latest ?? null, sameDay: pick.reviewed?.sameDay ?? true }
  }
  if (acknowledged === 0) return { kind: 'none-acknowledged', total }
  return { kind: 'some-acknowledged', total, acknowledged }
}

/** The acknowledger ids the details name, once each — one name lookup per person. */
export function acknowledgerIds(rows: readonly InsightRow[]): string[] {
  const ids = rows.map((row) => row.detail?.acknowledgedBy ?? null).filter((id): id is string => id !== null)
  return [...new Set(ids)]
}
