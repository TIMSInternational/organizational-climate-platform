import type { TranslateFn } from '../../i18n'

/**
 * The AI-insight vocabularies (`type`, `priority`), mapped to catalogue keys.
 *
 * Same shape and the same rules as `features/surveys/surveyVocabulary.ts` — a
 * `Record` lookup plus a raw fallback, never an exhaustive union — for the reason
 * spelled out there: these are **server data**, not copy.
 *
 * ## Where the value sets come from, and why the fallback is load-bearing
 *
 * **There is no enum anywhere to transcribe.** `AIInsightValidation.ValidateCreate`
 * (`src/ClimateProject.Application/Analytics/AIInsightValidation.cs:60`) checks only
 * "non-empty and ≤ 20 characters" for `Type` and `Priority`; both columns are plain
 * `text` with no CHECK. The value set is therefore **unbounded**, and this catalogue is
 * a best-effort list of the values actually observed in this repository — not an
 * exhaustive union. That is why the raw fallback below is not defensive noise: it is the
 * only correct behaviour for a value we do not ship a label for. Rendering the server's
 * own string is honest, whereas `t()` on a key we never shipped prints a raw key path at
 * the user, and a blank cell hides the row's meaning entirely.
 *
 * Every entry is sourced from something in this repository:
 *
 * - `trend` — the canonical type here, and the reason this file exists. It is the
 *   default of the create-request builder that every create test calls
 *   (`tests/ClimateProject.IntegrationTests/Analytics/AIInsightEndpointsTests.cs:152`),
 *   the value asserted on the persisted row (`:326`), the type in all six validation
 *   `InlineData` rows (`:501`-`:506`), the default in
 *   `tests/ClimateProject.UnitTests/Analytics/AIInsightValidationTests.cs:8`, and the
 *   type in the worked example at
 *   `docs/superpowers/plans/2026-08-01-reports-analytics.md:1182`. It is also the type
 *   the web fixtures already use (`api/insights.test.ts`,
 *   `pages/AnalyticsDashboardPage.test.tsx`).
 * - `risk` — `tests/ClimateProject.IntegrationTests/Persistence/AIInsightTests.cs:46`,
 *   `tests/ClimateProject.IntegrationTests/Reports/ReportEndpointsTests.cs:123`,
 *   `tests/ClimateProject.UnitTests/Reports/ReportAIInsightsTests.cs:33`.
 * - `pattern` — `tests/ClimateProject.IntegrationTests/Persistence/AIInsightTests.cs:87`,
 *   `tests/ClimateProject.IntegrationTests/Persistence/MicroclimateAiInsightTests.cs:78`.
 * - `recommendation`, `prediction` — no backend occurrence; carried over from the
 *   original port of this catalogue and kept because they cost nothing and #92's
 *   generation (which does not exist yet and has committed to no vocabulary) is the
 *   most plausible source of new values.
 *
 * ## Why priority reuses `actionPlans.*`
 *
 * "High" is the same word for the same concept an action plan already labels, and
 * `components/AIInsightList.tsx` reached the same conclusion independently. Two keys
 * for one word is how two catalogues drift apart — the Spanish forms are feminine
 * (`Alta`, `Crítica`) because they agree with `prioridad` in both places.
 */

/**
 * The insight types we ship a label for, most-attested first. Not a closed set — see
 * the note above; `insightTypeLabel` accepts any string.
 */
export const INSIGHT_TYPES = ['trend', 'risk', 'pattern', 'recommendation', 'prediction'] as const

export type InsightType = (typeof INSIGHT_TYPES)[number]

/** The priorities we ship a label for, lowest first. Also not a closed set. */
export const INSIGHT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export type InsightPriority = (typeof INSIGHT_PRIORITIES)[number]

const TYPE_KEYS: Record<string, string> = {
  trend: 'insights.typeTrend',
  pattern: 'insights.typePattern',
  risk: 'insights.typeRisk',
  recommendation: 'insights.typeRecommendation',
  prediction: 'insights.typePrediction',
}

const PRIORITY_KEYS: Record<string, string> = {
  low: 'actionPlans.low',
  medium: 'actionPlans.medium',
  high: 'actionPlans.high',
  critical: 'actionPlans.critical',
}

/**
 * `t(key)` when the value is one we ship a label for, otherwise the server's own value.
 *
 * `Object.hasOwn` rather than a bare truthiness check on `keys[value]`, for the reason
 * `i18n/translate.ts` gives at its own lookup: a plain object literal inherits from
 * `Object.prototype`, so `keys['toString']` is a *function* — truthy — and would be handed
 * to `t()`, which calls `.split('.')` on it and takes the whole page down. `type` is
 * free-form server text with no CHECK behind it, so that value is reachable.
 */
function label(t: TranslateFn, keys: Record<string, string>, value: string): string {
  return Object.hasOwn(keys, value) ? t(keys[value]) : value
}

export function insightTypeLabel(t: TranslateFn, type: string): string {
  return label(t, TYPE_KEYS, type)
}

export function insightPriorityLabel(t: TranslateFn, priority: string): string {
  return label(t, PRIORITY_KEYS, priority)
}
