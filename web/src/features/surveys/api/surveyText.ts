import { LOCALES, type Locale } from '../../../i18n'
import { getSurvey, type SurveyDetail } from './surveys'
import { type AuthoredText, requiredLocalesFor } from './surveyInvitationCopy'

/**
 * A survey's name and description, per language it is written in -- what «Editar nombre» edits.
 *
 * `GET /surveys/{id}` resolves ONE locale and reports the fields that fell back to the other
 * (`fallbackFields`). So the survey is read once per language it is written in, and a field that
 * fell back is shown EMPTY for that language rather than holding the other language's words as if
 * they were a translation -- the same reading `getSurveyQuestionAuthoring` does for the questions.
 */
export interface SurveyText {
  language: string
  locales: Locale[]
  title: Record<Locale, AuthoredText>
  description: Record<Locale, AuthoredText>
}

function blank(): AuthoredText {
  return { text: '', authored: false }
}

function own(payload: SurveyDetail, field: 'title' | 'description'): AuthoredText {
  const value = payload[field]
  if (value === null || payload.fallbackFields.includes(field)) return blank()
  return { text: value, authored: true }
}

export async function getSurveyText(baseUrl: string, id: string): Promise<SurveyText> {
  const first = await getSurvey(baseUrl, id, 'en')
  const locales = requiredLocalesFor(first.language)
  const title = Object.fromEntries(LOCALES.map((l) => [l, blank()])) as Record<Locale, AuthoredText>
  const description = Object.fromEntries(LOCALES.map((l) => [l, blank()])) as Record<Locale, AuthoredText>
  for (const locale of locales) {
    const read = locale === 'en' ? first : await getSurvey(baseUrl, id, locale)
    title[locale] = own(read, 'title')
    description[locale] = own(read, 'description')
  }
  return { language: first.language, locales, title, description }
}
