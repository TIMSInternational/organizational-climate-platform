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

export type RespondentTextsByLocale = Record<Locale, Record<RespondentTextField, AuthoredText>>

export interface SurveyRespondentTexts {
  requiredLocales: Locale[]
  texts: RespondentTextsByLocale
  /** False for a closed or archived survey: the API refuses a settings edit on one. */
  editable: boolean
}

interface RespondentTextsRead {
  language: string
  status: string
  fallbackFields: string[]
  settings: { respondentIntro?: string | null; closingMessage?: string | null }
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
    editable: SETTINGS_EDITABLE_STATUSES.includes(first.status),
  }
}

/**
 * Both fields, every required locale, in one `PUT`. An emptied box is sent as an empty string,
 * which clears it back to the default; a locale the survey does not use is never sent.
 * Notably absent: `anonymous`, which the API classes as CONTENT and would turn this save into
 * a content edit refused on any survey that has left draft.
 */
export async function saveSurveyRespondentTexts(
  baseUrl: string,
  surveyId: string,
  texts: RespondentTextsByLocale,
  requiredLocales: readonly Locale[],
): Promise<void> {
  const byLocale = (field: RespondentTextField): Record<string, string> =>
    Object.fromEntries(requiredLocales.map((locale) => [locale, texts[locale][field].text.trim()]))
  await authFetch(`${baseUrl}/surveys/${surveyId}`, {
    method: 'PUT',
    body: JSON.stringify({ settings: { respondentIntro: byLocale('intro'), closingMessage: byLocale('closing') } }),
  })
}
