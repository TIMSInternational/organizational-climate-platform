import { authFetch } from '../../../api/authFetch'
import type {
  RespondentContentByLocale,
  RespondentContentChanges,
  RespondentContentView,
  RespondentTextLocale,
} from './respondentContent'

/**
 * The three survey emails a client may word (ruled 2026-11-19,
 * `docs/decisions/editable-respondent-content.md`): the personal-link invitation, the
 * username-and-password mail and the no-password reminder. Each has a subject and a message,
 * stored under the registry keys `email.<mail>.subject` / `email.<mail>.message` and read and
 * written through the respondent-content routes (`respondentContent.ts`) like every other
 * override — the survey PUT writes the personal-link pair to its legacy columns, as before.
 *
 * What a client cannot word stays the server's: the username, the password, the button and its
 * link, the line naming the survey. The preview below is composed by the very composers that
 * send, so the editor never holds a second copy of the default text.
 */
export const SURVEY_MAILS = ['personalLink', 'credentials', 'reminder'] as const
export type SurveyMail = (typeof SURVEY_MAILS)[number]

export const EMAIL_PARTS = ['subject', 'message'] as const
export type EmailPart = (typeof EMAIL_PARTS)[number]

/** The registry key of one part of one mail. */
export function emailKey(mail: SurveyMail, part: EmailPart): string {
  return `email.${mail}.${part}`
}

/** `GET …/respondent-content/email-preview/{mail}`: the mail as composed from the SAVED words. */
export interface EmailPreview {
  mail: SurveyMail
  subject: string
  /** The plain-text part. */
  text: string
  /** The composer's own HTML document; every authored value already escaped by the server. */
  html: string
}

async function preview(baseUrl: string, path: string): Promise<EmailPreview> {
  const response = await authFetch(`${baseUrl}${path}`)
  return (await response.json()) as EmailPreview
}

export function getSurveyEmailPreview(baseUrl: string, surveyId: string, mail: SurveyMail): Promise<EmailPreview> {
  return preview(baseUrl, `/surveys/${encodeURIComponent(surveyId)}/respondent-content/email-preview/${mail}`)
}

export function getCompanyEmailPreview(baseUrl: string, companyId: string, mail: SurveyMail): Promise<EmailPreview> {
  return preview(baseUrl, `/admin/companies/${encodeURIComponent(companyId)}/respondent-content/email-preview/${mail}`)
}

/** `locale → key → text` for the email keys only: what this level itself stores. */
export type EmailDraft = Record<RespondentTextLocale, Record<string, string>>

/** The level's OWN stored email words (never the inherited ones), every key present, `''` when unset. */
export function emailDraftOf(view: RespondentContentView, mails: readonly SurveyMail[]): EmailDraft {
  const own: RespondentContentByLocale = view.level === 'survey' && view.surveyValues ? view.surveyValues : view.companyValues
  const draft: EmailDraft = { es: {}, en: {} }
  for (const locale of ['es', 'en'] as const) {
    for (const mail of mails) {
      for (const part of EMAIL_PARTS) {
        const key = emailKey(mail, part)
        draft[locale][key] = own[locale][key] ?? ''
      }
    }
  }
  return draft
}

/**
 * What a survey that writes nothing in `locale` inherits for `key`: its company's words, or
 * `null` for the product's default. Always `null` at the company level.
 */
export function inheritedEmailText(view: RespondentContentView, locale: RespondentTextLocale, key: string): string | null {
  if (view.level !== 'survey') return null
  const value = view.companyValues[locale][key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * The PUT body: only the keys whose trimmed text differs from what was loaded, in the locales
 * the editor offers. `''` clears the key at this level, so the next level shows through.
 */
export function emailChangesOf(
  loaded: EmailDraft,
  draft: EmailDraft,
  locales: readonly RespondentTextLocale[],
): RespondentContentChanges {
  const changes: RespondentContentChanges = {}
  for (const locale of locales) {
    for (const [key, value] of Object.entries(draft[locale])) {
      const next = value.trim()
      if (next === (loaded[locale][key] ?? '').trim()) continue
      changes[locale] = { ...(changes[locale] ?? {}), [key]: next }
    }
  }
  return changes
}
