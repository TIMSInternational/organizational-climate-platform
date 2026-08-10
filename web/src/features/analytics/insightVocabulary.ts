import type { TranslateFn } from '../../i18n'

/**
 * The AI-insight vocabularies (`type`, `priority`), mapped to catalogue keys.
 *
 * Same shape and the same rules as `features/surveys/surveyVocabulary.ts` — a
 * `Record` lookup plus a raw fallback, never an exhaustive union — for the reason
 * spelled out there: these are **server data**, not copy.
 *
 * ## Where the value sets come from, and why the fallback is still load-bearing
 *
 * The legacy Mongoose model (`climate-project/src/models/AIInsight.ts`) declares both
 * as closed enums:
 *
 * ```
 * type:     'pattern' | 'risk' | 'recommendation' | 'prediction'
 * priority: 'low' | 'medium' | 'high' | 'critical'
 * ```
 *
 * That is where these catalogues come from, so they are transcribed rather than
 * invented. But the .NET port does **not** enforce either set:
 * `AIInsightValidation.ValidateCreate` checks only "non-empty and ≤ 20 characters"
 * for both columns, and `AIInsight.Type` / `AIInsight.Priority` are plain `text` with
 * no CHECK. So the wire can legitimately carry a fifth type — most plausibly from
 * #92's generation, which does not exist yet and has not committed to this
 * vocabulary. An unrecognised value therefore renders verbatim: it is the server's
 * own string, which is honest, whereas `t()` on a key we never shipped prints a raw
 * key path at the user, and a blank cell hides the row's meaning entirely.
 *
 * ## Why priority reuses `actionPlans.*`
 *
 * "High" is the same word for the same concept an action plan already labels, and
 * `components/AIInsightList.tsx` reached the same conclusion independently. Two keys
 * for one word is how two catalogues drift apart — the Spanish forms are feminine
 * (`Alta`, `Crítica`) because they agree with `prioridad` in both places.
 */

/** The legacy `AIInsightSchema.type` enum, in schema order. */
export const INSIGHT_TYPES = ['pattern', 'risk', 'recommendation', 'prediction'] as const

export type InsightType = (typeof INSIGHT_TYPES)[number]

/** The legacy `AIInsightSchema.priority` enum, lowest first. */
export const INSIGHT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export type InsightPriority = (typeof INSIGHT_PRIORITIES)[number]

const TYPE_KEYS: Record<string, string> = {
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
