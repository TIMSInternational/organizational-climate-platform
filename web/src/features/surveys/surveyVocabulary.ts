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
/**
 * The survey types the wizard offers, in the order it offers them. Exported as the
 * ordered list because a `Record` has no reliable order and the picker needs one;
 * `TYPE_KEYS` below stays the lookup, so the two cannot disagree about membership —
 * `surveyVocabulary.test.ts` asserts exactly that.
 */
export const SURVEY_TYPES = [
  'periodic',
  'pulse',
  'engagement',
  'satisfaction',
  'onboarding',
  'exit',
  'custom',
] as const

export type SurveyType = (typeof SURVEY_TYPES)[number]

/**
 * `QuestionTypes.ForSurvey`, in the order the wizard offers them. Same rule as
 * `SURVEY_TYPES`: the ordered list is exported, the lookup below stays the authority
 * on membership.
 */
export const SURVEY_QUESTION_TYPES = [
  'likert',
  'multiple_choice',
  'rating',
  'yes_no',
  'ranking',
  'open_ended',
] as const

export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number]

/** What a freshly added question is, before the author changes it. */
export const DEFAULT_SURVEY_QUESTION_TYPE: SurveyQuestionType = 'likert'

/** The two types whose answers are a list the author has to write. */
export function needsOptions(type: string): boolean {
  return type === 'multiple_choice' || type === 'ranking'
}

/**
 * The two types answered on a numeric scale, whose ends can carry words —
 * `ScaleLabelMin`/`Max` on the wire. The server stores the labels for any type
 * without complaint; offering the fields on a type whose renderer never shows a
 * scale would collect words nobody ever reads.
 */
export function needsScaleLabels(type: string): boolean {
  return type === 'likert' || type === 'rating'
}

/**
 * The dimension keys the product ships — the members of the
 * `surveyRespond.dimensions` i18n table, which is the vocabulary the respond page
 * headings and the results pages can put a display name to.
 *
 * These seed the wizard's dimension picker. The honest source for suggestions
 * would be the categories this company's earlier surveys already used, but no
 * endpoint exposes those (`GET /surveys` list items carry no categories, and
 * fetching every survey detail to harvest them is N+1 against a list that can be
 * years long), so the shipped vocabulary stands in: it is what every seeded survey
 * uses and what both catalogues can translate. Free text remains the escape
 * hatch — `Question.Category` is a free string — so the list narrows nothing.
 *
 * Kept in step with the catalogue by `surveyVocabulary.test.ts`, which resolves
 * each key through `surveyRespond.dimensions` and fails on drift in either
 * direction.
 */
export const SUGGESTED_DIMENSION_KEYS = [
  'psychological_safety',
  'workload',
  'trust',
  'recognition',
  'growth',
  'belonging',
  'enps',
  'priorities',
  'open',
] as const

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

/**
 * Whether a survey in this status is still collecting — the client mirror of
 * `SurveyStatuses.AcceptsResponses`, which is `status == "active"` and nothing else.
 *
 * **The response window is the status, never the dates.** The server says so where it
 * enforces it (`SurveyResponseEndpoints`, on the submit path): "deliberately
 * status-only … re-deriving it from StartDate/EndDate here would let this endpoint
 * refuse a survey that `SurveyQueries.AssignedTo` still lists in /surveys/my". Nothing
 * closes a survey automatically either: the only two ways into `closed` are
 * `PUT /surveys/{id}/status` and the `close` bulk action, both of them an
 * administrator's deliberate act, and none of the jobs in
 * `ClimateProject.Infrastructure/Scheduling` writes a survey status at all. So a
 * survey routinely sits `active` past its `EndDate` and is still accepting answers,
 * and a client that read the dates instead would tell an administrator a survey is
 * closed while the API is still taking responses for it.
 */
export function acceptsResponses(status: string): boolean {
  return status === 'active'
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
