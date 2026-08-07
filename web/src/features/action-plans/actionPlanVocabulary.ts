import type { TranslateFn } from '../../i18n'

/**
 * The action-plan wire vocabularies, mapped to catalogue keys.
 *
 * ## Why this file exists at all
 *
 * Before it, three components rendered the raw wire value as user-visible copy:
 * `ActionPlanList` printed `not_started` and `high` into table cells,
 * `ActionPlanFilters` used them as its `<option>` labels, and the detail page's
 * status `<select>` did the same. That is untranslated in *both* languages, not
 * just Spanish — an English reader was reading a database enum too.
 *
 * ## Why maps with a raw fallback rather than exhaustive unions
 *
 * Two of these four vocabularies are closed server-side and two are not, and the
 * difference matters:
 *
 * - `ValidStatuses`, `ValidPriorities` and `ValidMeasurementFrequencies` in
 *   `ActionPlanValidation.cs` are enforced: `CreateAsync`/`UpdateAsync` answer 400
 *   for anything outside them. Those three are safe to *enumerate* in a picker.
 * - An **objective's** `currentStatus` is not. `RecordProgressAsync` assigns
 *   `objective.CurrentStatus = objectiveUpdate.StatusUpdate` with no validation at
 *   all, and `CreateAsync` seeds it to `not_started`. So the wire can legitimately
 *   carry an objective status this file has never heard of.
 *
 * `label()` therefore falls back to the server's own string rather than to `t()` of
 * a key that does not exist — which would print a raw key path at the user. Same
 * rule `surveys/surveyVocabulary.ts` and `reports/components/ReportList.tsx` arrived
 * at. The enumerated constants below are for pickers; the label functions are for
 * rendering, and only the label functions are safe to point at arbitrary wire data.
 *
 * ## Why this is a `.ts` module and still passes the #217 guard
 *
 * The guard's object-property rule fires on property *names* matching
 * `label|message|heading|caption|tooltip|blurb|copy`. These properties are named for
 * the wire value (`not_started`, `critical`) and hold catalogue paths, not prose —
 * so there is no English here for the guard to find, which is the point.
 */

/** `ActionPlanValidation.ValidStatuses` — the complete set `UpdateAsync` accepts. */
export const ACTION_PLAN_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'overdue',
  'cancelled',
] as const

export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number]

/** `ActionPlanValidation.ValidPriorities`, ordered least to most urgent. */
export const ACTION_PLAN_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export type ActionPlanPriority = (typeof ACTION_PLAN_PRIORITIES)[number]

/** `ActionPlanValidation.ValidMeasurementFrequencies`. */
export const MEASUREMENT_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'] as const

const STATUS_KEYS: Record<string, string> = {
  // `common.completed` rather than a fifth `actionPlans.*` key: the catalogue
  // already ships the word in both languages and a duplicate would be one more
  // thing to keep in sync for no gain.
  not_started: 'actionPlans.notStarted',
  in_progress: 'actionPlans.inProgress',
  completed: 'common.completed',
  overdue: 'actionPlans.overdue',
  cancelled: 'actionPlans.cancelled',
}

const PRIORITY_KEYS: Record<string, string> = {
  low: 'actionPlans.low',
  medium: 'actionPlans.medium',
  high: 'actionPlans.high',
  critical: 'actionPlans.critical',
}

const FREQUENCY_KEYS: Record<string, string> = {
  daily: 'actionPlans.frequencyDaily',
  weekly: 'actionPlans.frequencyWeekly',
  monthly: 'actionPlans.frequencyMonthly',
  quarterly: 'actionPlans.frequencyQuarterly',
}

/** `t(key)` when the value is one we ship a label for, otherwise the server's own value. */
function label(t: TranslateFn, keys: Record<string, string>, value: string): string {
  const key = keys[value]
  return key ? t(key) : value
}

export function statusLabel(t: TranslateFn, status: string): string {
  return label(t, STATUS_KEYS, status)
}

export function priorityLabel(t: TranslateFn, priority: string): string {
  return label(t, PRIORITY_KEYS, priority)
}

export function frequencyLabel(t: TranslateFn, frequency: string): string {
  return label(t, FREQUENCY_KEYS, frequency)
}

/**
 * How far a KPI has moved toward its target, as a 0–100 percentage, or `null` when
 * the question does not have an answer.
 *
 * A target of zero is the case worth stating: `current / 0` is `Infinity` (or `NaN`
 * at `0 / 0`), and a `<Progress>` bar fed either renders a bar of undefined length.
 * KPIs are created with `CurrentValue = 0` and an author-supplied `TargetValue`
 * which nothing on the server forces to be non-zero, so this is reachable on real
 * data rather than theoretical. `null` means "show the numbers, not a bar".
 *
 * Clamped at 100 because `RecordProgressAsync` accepts any `NewValue`: overshooting
 * a target is a real and good outcome, and a bar 140% full is a rendering bug.
 */
export function kpiProgressPercent(currentValue: number, targetValue: number): number | null {
  if (!Number.isFinite(targetValue) || targetValue <= 0) return null
  if (!Number.isFinite(currentValue)) return null
  return Math.max(0, Math.min(100, (currentValue / targetValue) * 100))
}
