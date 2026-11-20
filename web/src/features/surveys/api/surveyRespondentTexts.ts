import { authFetch } from '../../../api/authFetch'
import { LOCALES, type Locale } from '../../../i18n'
import { requiredLocalesFor, SETTINGS_EDITABLE_STATUSES, type AuthoredText } from './surveyInvitationCopy'

/**
 * A survey's own words for the person answering it (Eagle's corrections, 2026-10-20): the
 * paragraph in the anonymity box, and the thank-you after they submit. Per survey, so one
 * client's wording never reaches another client's respondents.
 *
 * Read and written exactly like the invitation copy (`surveyInvitationCopy.ts`, whose header
 * explains why): one read per locale, a locale counts as authored only when its value did NOT
 * arrive through `fallbackFields`, and the write is one locale-keyed `PUT /surveys/{id}`.
 *
 * The one difference is that both fields are OPTIONAL. Empty is not "missing": it means the
 * product's default text, which is what every survey made before this date says. Saving a box
 * empty sends an empty string, which the API stores and reads back as "not set".
 *
 * Limits mirror `SurveyRespondentText` on the server.
 */
export const RESPONDENT_TEXT_FIELDS = ['intro', 'closing'] as const
export type RespondentTextField = (typeof RESPONDENT_TEXT_FIELDS)[number]

export const RESPONDENT_INTRO_MAX = 1000
export const RESPONDENT_CLOSING_MAX = 500

/**
 * The duration a survey may state, in minutes (`SurveyRespondentText.EstimatedMinutes*` on the
 * server). Below 2 the screens already say «menos de un minuto» from the questions; 0 clears.
 */
export const ESTIMATED_MINUTES_MIN = 2
export const ESTIMATED_MINUTES_MAX = 600

/**
 * The duration field as typed: empty is "calculate it" (null), a whole number in range is the
 * stated minutes, anything else is refused before it reaches the API.
 */
export function parseStatedMinutes(text: string): { valid: true; minutes: number | null } | { valid: false } {
  const trimmed = text.trim()
  if (trimmed === '') return { valid: true, minutes: null }
  if (!/^\d+$/.test(trimmed)) return { valid: false }
  const minutes = Number(trimmed)
  return minutes >= ESTIMATED_MINUTES_MIN && minutes <= ESTIMATED_MINUTES_MAX ? { valid: true, minutes } : { valid: false }
}

export type RespondentTextsByLocale = Record<Locale, Record<RespondentTextField, AuthoredText>>

export interface SurveyRespondentTexts {
  requiredLocales: Locale[]
  texts: RespondentTextsByLocale
  /**
   * The duration the survey states (`settings.estimatedMinutes`), or null when the screens
   * calculate it from the questions. One per survey, not per language: it is a number.
   */
  estimatedMinutes: number | null
  /** How many questions the survey has, for the calculated figure the empty field stands for. */
  questionCount: number
  /** False for a closed or archived survey: the API refuses a settings edit on one. */
  editable: boolean
}

interface RespondentTextsRead {
  language: string
  status: string
  fallbackFields: string[]
  settings: { respondentIntro?: string | null; closingMessage?: string | null; estimatedMinutes?: number | null }
  questions?: unknown[]
}

function fallbackFieldPath(field: RespondentTextField): string {
  return field === 'intro' ? 'settings.respondentIntro' : 'settings.closingMessage'
}

function readOne(payload: RespondentTextsRead): Record<RespondentTextField, AuthoredText> {
  const value = (field: RespondentTextField): AuthoredText => {
    const text = field === 'intro' ? payload.settings.respondentIntro : payload.settings.closingMessage
    // The other language's text, shown because this one has none, is not this language's text.
    return payload.fallbackFields.includes(fallbackFieldPath(field)) || !text
      ? { text: '', authored: false }
      : { text, authored: true }
  }
  return { intro: value('intro'), closing: value('closing') }
}

export async function getSurveyRespondentTexts(baseUrl: string, surveyId: string): Promise<SurveyRespondentTexts> {
  const reads = await Promise.all(
    LOCALES.map(async (locale) => {
      const response = await authFetch(`${baseUrl}/surveys/${surveyId}?lang=${locale}`)
      return [locale, (await response.json()) as RespondentTextsRead] as const
    }),
  )
  const [, first] = reads[0]
  return {
    requiredLocales: requiredLocalesFor(first.language),
    texts: Object.fromEntries(reads.map(([locale, payload]) => [locale, readOne(payload)])) as RespondentTextsByLocale,
    estimatedMinutes: typeof first.settings.estimatedMinutes === 'number' ? first.settings.estimatedMinutes : null,
    questionCount: Array.isArray(first.questions) ? first.questions.length : 0,
    editable: SETTINGS_EDITABLE_STATUSES.includes(first.status),
  }
}

/**
 * Both fields, every required locale, and the stated duration, in one `PUT`. An emptied box is
 * sent as an empty string, which clears it back to the default; a locale the survey does not
 * use is never sent. A duration of `null` is sent as `0`, the API's "calculate it again".
 * Notably absent: `anonymous`, which the API classes as CONTENT and would turn this save into
 * a content edit refused on any survey that has left draft.
 */
export async function saveSurveyRespondentTexts(
  baseUrl: string,
  surveyId: string,
  texts: RespondentTextsByLocale,
  requiredLocales: readonly Locale[],
  estimatedMinutes: number | null,
): Promise<void> {
  const byLocale = (field: RespondentTextField): Record<string, string> =>
    Object.fromEntries(requiredLocales.map((locale) => [locale, texts[locale][field].text.trim()]))
  await authFetch(`${baseUrl}/surveys/${surveyId}`, {
    method: 'PUT',
    body: JSON.stringify({
      settings: { respondentIntro: byLocale('intro'), closingMessage: byLocale('closing'), estimatedMinutes: estimatedMinutes ?? 0 },
    }),
  })
}

/**
 * The stated duration alone, in a `PUT /surveys/{id}` whose `settings` carries nothing else
 * (`ApplySettings` touches only the fields sent). Since 2026-11-19 `RespondentTextsDialog` saves
 * the texts through `PUT /surveys/{id}/respondent-content`, which writes the anonymity paragraph
 * and the thank-you to the same survey columns `saveSurveyRespondentTexts` writes. `null` is sent
 * as `0`, the API's "calculate it again".
 */
export async function saveSurveyEstimatedMinutes(baseUrl: string, surveyId: string, estimatedMinutes: number | null): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${surveyId}`, {
    method: 'PUT',
    body: JSON.stringify({ settings: { estimatedMinutes: estimatedMinutes ?? 0 } }),
  })
}
