import type { TranslateFn } from '../../i18n'

/**
 * The server's microclimate vocabularies, mapped to catalogue keys.
 *
 * Modelled on `surveys/surveyVocabulary.ts`, and it exists for the same reason: the
 * pages were rendering `{m.status}` and `{live.engagementLevel}` straight from the
 * wire, so a Spanish admin read "draft" and "medium" in English on every row.
 *
 * ## Why the status labels are NOT reused from `surveys.*`
 *
 * They look identical in English and are not identical in Spanish. A survey is *una
 * encuesta* and a microclimate is *un microclima*, so `surveys.statusActive` is
 * "Activa" and this one has to be "Activo". Sharing the key would have shipped an
 * agreement error on every microclimate row in the product's second language — the
 * exact class of defect that only shows up when somebody reads the ES build.
 *
 * ## Why the question-type labels ARE reused from `surveys.*`
 *
 * Those keys hold nouns ("Escala Likert", "Opción Múltiple") that do not agree with
 * the surrounding subject, and both features render the *same* server vocabulary —
 * `QuestionTypes` in `ClimateProject.Application`. Duplicating them into this
 * namespace would create two Spanish translations of one server value, free to
 * drift, for no gain.
 *
 * ## Raw fallback rather than exhaustive unions
 *
 * `status` and `engagementLevel` are server data, not copy. `MicroclimateValidation.
 * ValidStatuses` and `ComputeEngagementLevel` are closed sets today, so the maps are
 * complete — but rendering an unrecognised wire value through `t()` would print a raw
 * key path at the user, whereas rendering the server's own string is merely
 * untranslated. Same rule `surveyVocabulary` and `reports/ReportList` arrived at.
 *
 * ## Why this `.ts` module passes the #217 guard
 *
 * The guard's object-property rule fires on property *names* matching
 * `label|message|heading|…`. Every property here is named for the wire value
 * (`draft`, `high`) and holds a catalogue path, so there is no English in this file
 * to find — which is the point.
 */

/** `MicroclimateValidation.ValidStatuses` — the complete, closed set. */
export const MICROCLIMATE_STATUSES = ['draft', 'active', 'closed'] as const

export type MicroclimateStatus = (typeof MICROCLIMATE_STATUSES)[number]

const STATUS_KEYS: Record<string, string> = {
  draft: 'microclimates.statusDraft',
  active: 'microclimates.statusActive',
  closed: 'microclimates.statusClosed',
}

/** The three bands `ComputeEngagementLevel` emits, from the response/target ratio. */
const ENGAGEMENT_KEYS: Record<string, string> = {
  low: 'microclimates.engagementLow',
  medium: 'microclimates.engagementMedium',
  high: 'microclimates.engagementHigh',
}

/**
 * `QUESTION_TYPES` from `../questionTypes`, which mirrors
 * `ClimateProject.Application.Questions.QuestionTypes`. Deliberately pointed at the
 * `surveys.*` catalogue entries — see the block comment above.
 */
const QUESTION_TYPE_KEYS: Record<string, string> = {
  likert: 'surveys.questionTypeLikert',
  multiple_choice: 'surveys.multipleChoice',
  open_ended: 'surveys.textResponse',
  yes_no: 'surveys.yesNo',
  rating: 'surveys.rating',
}

/** The content-language values `ContentLanguages` recognises. */
const LANGUAGE_KEYS: Record<string, string> = {
  en: 'language.english',
  es: 'language.spanish',
  both: 'surveys.languageBoth',
}

/** `t(key)` when the value is one we ship a label for, otherwise the server's own value. */
function label(t: TranslateFn, keys: Record<string, string>, value: string): string {
  const key = keys[value]
  return key ? t(key) : value
}

export function statusLabel(t: TranslateFn, status: string): string {
  return label(t, STATUS_KEYS, status)
}

export function engagementLabel(t: TranslateFn, level: string): string {
  return label(t, ENGAGEMENT_KEYS, level)
}

export function questionTypeLabel(t: TranslateFn, type: string): string {
  return label(t, QUESTION_TYPE_KEYS, type)
}

export function languageLabel(t: TranslateFn, language: string): string {
  return label(t, LANGUAGE_KEYS, language)
}

/**
 * The `Badge` variant a status reads best as.
 *
 * Returned as a variant name rather than a class so the colour stays a token
 * decision made inside `badgeVariants`, and so this module never holds a class
 * string — `styles/utilityExistence.test.ts` only reads `className` out of `.tsx`,
 * so a class returned from a `.ts` helper is invisible to it.
 */
export function statusBadgeVariant(status: string): 'success' | 'secondary' | 'outline' {
  if (status === 'active') return 'success'
  if (status === 'closed') return 'outline'
  return 'secondary'
}
