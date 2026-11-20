import { authFetch } from '../../../api/authFetch'
import type { Locale } from '../../../i18n'

/**
 * Where each text a respondent or a recipient reads comes from, for «Textos y correo»
 * (audit 2026-11-19, gap #2): set for this survey, the company's, or the product default.
 *
 * Read from the foundation's two routes (`RespondentContentEndpoints.cs`):
 * `GET /surveys/{id}/respondent-content` and `GET /admin/companies/{id}/respondent-content`.
 * Both answer the same `RespondentContentView`; this module reads only the stored values of each
 * level -- never the texts themselves to print them -- because a summary that says WHICH level
 * speaks is what an author needs before opening the editor.
 */

/** `locale → key → text`, with `es`, `en` and `*` present (possibly empty). */
export type RespondentContentValues = Partial<Record<string, Record<string, string>>>

export interface RespondentContentView {
  level: 'company' | 'survey'
  companyId: string
  surveyId: string | null
  language: string
  requiredLocales: string[]
  editable: boolean
  surveyStatus: string | null
  companyValues: RespondentContentValues
  /** Null at the company level. The survey's legacy columns are already mapped to their keys. */
  surveyValues: RespondentContentValues | null
}

export async function getSurveyRespondentContent(baseUrl: string, surveyId: string): Promise<RespondentContentView> {
  const response = await authFetch(`${baseUrl}/surveys/${surveyId}/respondent-content`)
  return (await response.json()) as RespondentContentView
}

/** A super admin for any company, a company admin for their own; 403 for anyone else. */
export async function getCompanyRespondentContent(baseUrl: string, companyId: string): Promise<RespondentContentView> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/respondent-content`)
  return (await response.json()) as RespondentContentView
}

/** Which level a reader in `locale` gets a text from: the chain survey → company → product. */
export type TextSource = 'survey' | 'company' | 'default'

function stored(values: RespondentContentValues | null | undefined, locale: Locale, key: string): boolean {
  const text = values?.[locale]?.[key]
  return typeof text === 'string' && text.trim() !== ''
}

export function textSourceOf(view: RespondentContentView, key: string, locale: Locale): TextSource {
  if (stored(view.surveyValues, locale, key)) return 'survey'
  if (stored(view.companyValues, locale, key)) return 'company'
  return 'default'
}

/**
 * The texts «Textos y correo» summarises, in the order an author meets them, each with the label
 * key under `surveys.next.builder.texts.label`. Registry keys (`RespondentContentRegistry.cs`);
 * the screen's many short labels are deliberately not listed one by one.
 */
export const SUMMARISED_TEXTS = {
  screens: [
    { key: 'anonymousBody', labelKey: 'anonymousBody' },
    { key: 'participationBody', labelKey: 'participationBody' },
    { key: 'identity.intro', labelKey: 'identityIntro' },
    { key: 'demographics.intro', labelKey: 'demographicsIntro' },
    { key: 'thankYouTitle', labelKey: 'thankYouTitle' },
  ],
  emails: [
    { key: 'email.personalLink.subject', labelKey: 'personalLinkSubject' },
    { key: 'email.personalLink.message', labelKey: 'personalLinkMessage' },
    { key: 'email.credentials.subject', labelKey: 'credentialsSubject' },
    { key: 'email.credentials.message', labelKey: 'credentialsMessage' },
    { key: 'email.reminder.subject', labelKey: 'reminderSubject' },
    { key: 'email.reminder.message', labelKey: 'reminderMessage' },
  ],
} as const
