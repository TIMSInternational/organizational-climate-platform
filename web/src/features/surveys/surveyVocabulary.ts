import type { TranslateFn } from '../../i18n'

/**
 * The server's survey vocabularies, mapped to catalogue keys.
 *
 * ## Why these are maps with a raw fallback rather than exhaustive unions
 *
 * `status` and `type` are **server data**, not copy. `SurveyStatuses.All` is a fixed
 * five-member set so its map is complete, but `Survey.Type` is validated only as
 * "non-empty" (`SurveyEndpoints.CreateAsync` trims it and checks nothing else), so
 * the wire can legitimately carry a type this file has never heard of. Rendering
 * such a value through `t()` would print a raw key path at the user; rendering the
 * server's own string is honest. Same rule `reports/components/ReportList.tsx`
 * arrived at.
 *
 * ## Why this is a `.ts` module and still passes the #217 guard
 *
 * The guard's object-property rule fires on property *names* matching
 * `label|message|heading|caption|tooltip|blurb|copy`. These properties are named for
 * the wire value (`draft`, `periodic`) and hold catalogue paths, not prose — so
 * there is no English here for the guard to find, which is the point.
 */

/** `SurveyStatuses.All` — the complete, closed set. */
export const SURVEY_STATUSES = ['draft', 'scheduled', 'active', 'closed', 'archived'] as const

export type SurveyStatus = (typeof SURVEY_STATUSES)[number]

const STATUS_KEYS: Record<string, string> = {
  draft: 'surveys.statusDraft',
  scheduled: 'surveys.statusScheduled',
  active: 'surveys.statusActive',
  closed: 'surveys.statusClosed',
  archived: 'surveys.statusArchived',
}

/**
 * The survey types the legacy product shipped. Open-ended on the wire, so this is a
 * label lookup and never a validation list — see the block comment above.
 */
const TYPE_KEYS: Record<string, string> = {
  periodic: 'surveys.periodic',
  onboarding: 'surveys.onboarding',
  exit: 'surveys.exit',
  pulse: 'surveys.pulse',
  engagement: 'surveys.engagement',
  satisfaction: 'surveys.satisfaction',
  custom: 'surveys.custom',
}

/**
 * `QuestionTypes.ForSurvey` — the six types a survey question may have.
 *
 * Derived names, never a second vocabulary: these are the exact strings
 * `src/ClimateProject.Application/Questions/QuestionTypes.cs` emits. `emoji_rating`
 * is deliberately absent from `ForSurvey` server-side, so it is absent here too;
 * an imported row carrying it falls back to its raw value rather than to a lie.
 */
const QUESTION_TYPE_KEYS: Record<string, string> = {
  likert: 'surveys.questionTypeLikert',
  multiple_choice: 'surveys.multipleChoice',
  ranking: 'surveys.questionTypeRanking',
  open_ended: 'surveys.textResponse',
  yes_no: 'surveys.yesNo',
  rating: 'surveys.rating',
}

/**
 * The content-language values `ContentLanguages` recognises: a survey is authored in
 * Spanish, in English, or in both.
 */
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

export function typeLabel(t: TranslateFn, type: string): string {
  return label(t, TYPE_KEYS, type)
}

export function questionTypeLabel(t: TranslateFn, type: string): string {
  return label(t, QUESTION_TYPE_KEYS, type)
}

export function languageLabel(t: TranslateFn, language: string): string {
  return label(t, LANGUAGE_KEYS, language)
}
