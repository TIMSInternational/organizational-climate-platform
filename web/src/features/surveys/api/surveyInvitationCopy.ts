import { authFetch } from '../../../api/authFetch'
import { FALLBACK_LOCALE, LOCALES, type Locale } from '../../../i18n'

/**
 * Reading and writing the survey's **invitation copy** in both languages at once.
 *
 * ## Why this module exists at all
 *
 * The invitation subject and message are Tier-1 authored content: paired
 * `invitation_custom_subject_{en,es}` / `invitation_custom_message_{en,es}` columns on
 * `Survey.Settings` (#195). Authoring them is therefore a two-language surface whenever
 * the survey is written in `both` — a single text box would file whichever language the
 * admin happened to type into one column and leave the other empty, which is precisely
 * the silent content-mangling the paired columns exist to prevent.
 *
 * ## The constraint that shapes everything below
 *
 * **No read DTO may expose `En`/`Es`-shaped fields.** `SurveySettingsDto` obeys that:
 * `invitationCustomSubject` is one already-resolved string, and the payload reports
 * `resolvedLocale` plus `fallbackFields` rather than handing over both columns. That is
 * non-negotiable and is what keeps a third language one migration instead of a frontend
 * rewrite — so this module does **not** ask for a per-language read shape.
 *
 * It reads the survey **once per locale** instead: `?lang=en` and `?lang=es`, and folds
 * the two resolved payloads back into an editing model. A locale's text is genuinely
 * authored in that locale exactly when the field came back non-null *and* its path is
 * absent from that read's `fallbackFields` — a value that arrived via fallback is another
 * language's text being shown, not this language's content, and typing over it would
 * silently copy English into the Spanish column.
 *
 * Two round trips rather than one, on a page that already loads the survey. That is the
 * price of the rule, and it is the right price: the alternative is an `en`/`es` pair on a
 * read DTO, which is the one thing #195 forbids.
 */

/** The two fields, and the `fallbackFields` paths the API reports them under. */
export const INVITATION_COPY_FIELDS = ['subject', 'message'] as const

export type InvitationCopyField = (typeof INVITATION_COPY_FIELDS)[number]

/**
 * The path the API reports a field under in `fallbackFields`.
 *
 * A function rather than a `Record<InvitationCopyField, string>` map, deliberately: the
 * hardcoded-string guard reads `message: '…'` in an object literal as untranslated copy
 * (#217 widened it to `.ts` files precisely so it could see literals like this), and it is
 * right to — the shape is indistinguishable from a label table. A ternary is not a
 * property assignment, so the guard sees what it is: a wire constant.
 */
function fallbackFieldPath(field: InvitationCopyField): string {
  return field === 'subject'
    ? 'settings.invitationCustomSubject'
    : 'settings.invitationCustomMessage'
}

/** One field in one locale, plus whether that locale actually holds it. */
export interface AuthoredText {
  /** What to put in the textarea. Empty string when this locale has nothing of its own. */
  text: string
  /**
   * True when `text` came from this locale's own column. False both when the field is
   * absent everywhere and when it resolved through a fallback from the other language —
   * either way this locale has no content and the editor must say so rather than show
   * the other language's words as if they were translated.
   */
  authored: boolean
}

export type InvitationCopyByLocale = Record<Locale, Record<InvitationCopyField, AuthoredText>>

/**
 * The survey facts a distribution page needs, lifted off the same reads.
 *
 * Deliberately small. This is not `SurveyDetail` — that shape belongs to the survey pages
 * (#109), and restating it here would be a second definition to keep in step.
 */
export interface DistributionSurveyFacts {
  companyId: string
  status: string
  /** The survey's own department targets. Empty means company-wide. */
  departmentIds: string[]
  responseCount: number
  /** Resolved for the caller's locale. */
  title: string | null
  /** The locale `title` is **actually** in, which is not always the one asked for. */
  resolvedLocale: string
}

export interface SurveyInvitationCopy {
  /** The survey's own authoring language: `'es' | 'en' | 'both'`. */
  language: string
  /** The locales an admin must fill in for this survey. One entry, or two when `both`. */
  requiredLocales: Locale[]
  copy: InvitationCopyByLocale
  /** `false` for a closed or archived survey — the API refuses a settings edit on one. */
  editable: boolean
  survey: DistributionSurveyFacts
}

/** Just enough of `SurveyDetail` for this module. Deliberately not the whole shape. */
interface SurveyCopyRead {
  companyId: string
  language: string
  status: string
  title: string | null
  resolvedLocale: string
  fallbackFields: string[]
  departmentIds: string[]
  responseCount: number
  settings: {
    invitationCustomSubject: string | null
    invitationCustomMessage: string | null
  }
}

/**
 * The statuses `PUT /surveys/{id}` accepts a settings patch for, mirroring
 * `SurveyStatuses.AllowsScheduleEdit`. Invitation copy is classed as an operational
 * setting rather than content, so it stays editable while the survey is live and stops
 * once it closes.
 */
export const SETTINGS_EDITABLE_STATUSES = ['draft', 'scheduled', 'active']

/**
 * Whether a survey can still be distributed, and therefore whether the entry points into
 * the distribution page should exist for it.
 *
 * Exported so the two links (the survey's header action and its row action in the list)
 * and this module's own `editable` flag all read the SAME set. Three copies of
 * "draft, scheduled, active" is how a link comes to be offered for a survey whose page
 * then refuses every control on it.
 */
export function canDistribute(status: string): boolean {
  return SETTINGS_EDITABLE_STATUSES.includes(status)
}

/**
 * Which locales this survey must have copy in.
 *
 * `both` means both. A single-language survey needs exactly its own language: demanding a
 * Spanish translation of a survey authored only in English would be inventing a
 * requirement the publish gate does not have.
 */
export function requiredLocalesFor(language: string): Locale[] {
  if (language === 'both') return [...LOCALES]
  return LOCALES.filter((locale) => locale === language)
}

function readOne(payload: SurveyCopyRead): Record<InvitationCopyField, AuthoredText> {
  const value = (field: InvitationCopyField): AuthoredText => {
    const text =
      field === 'subject'
        ? payload.settings.invitationCustomSubject
        : payload.settings.invitationCustomMessage
    const viaFallback = payload.fallbackFields.includes(fallbackFieldPath(field))
    // A fallback value is the OTHER language's text. Showing it in this locale's box
    // would make an untranslated field look translated, and saving it would copy it into
    // the wrong column for real.
    return viaFallback || text === null
      ? { text: '', authored: false }
      : { text, authored: true }
  }

  return { subject: value('subject'), message: value('message') }
}

/**
 * @param displayLocale which read the survey *title* is taken from. Optional and last, so
 * a caller with no locale to hand still gets English rather than a broken signature — the
 * ordering rule a prior bug got wrong by putting `baseUrl` before the required args.
 * Whatever it is set to, `survey.resolvedLocale` reports the locale the title is really
 * in, which is not always the one asked for.
 */
export async function getSurveyInvitationCopy(
  baseUrl: string,
  surveyId: string,
  displayLocale: Locale = FALLBACK_LOCALE,
): Promise<SurveyInvitationCopy> {
  const reads = await Promise.all(
    LOCALES.map(async (locale) => {
      const response = await authFetch(`${baseUrl}/surveys/${surveyId}?lang=${locale}`)
      return [locale, (await response.json()) as SurveyCopyRead] as const
    }),
  )

  const copy = Object.fromEntries(
    reads.map(([locale, payload]) => [locale, readOne(payload)]),
  ) as InvitationCopyByLocale

  // Every read describes the same row, so any of them can answer the language, status and
  // targets. The first is used rather than merged: two answers that disagree would be a
  // server bug, and papering over it here would hide it.
  const [, first] = reads[0]
  const display = reads.find(([locale]) => locale === displayLocale)?.[1] ?? first

  return {
    language: first.language,
    requiredLocales: requiredLocalesFor(first.language),
    copy,
    editable: SETTINGS_EDITABLE_STATUSES.includes(first.status),
    survey: {
      companyId: first.companyId,
      status: first.status,
      departmentIds: first.departmentIds,
      responseCount: first.responseCount,
      title: display.title,
      resolvedLocale: display.resolvedLocale,
    },
  }
}

/**
 * A locale that the admin left empty but which this survey requires.
 *
 * This is the missing-content validation the requirement asks for, and it is checked on
 * the client because the server's own publish gate (`ContentPublishValidation`) runs at
 * publish time — by which point the invitation may already be queued. Reporting it here
 * is earlier, not instead.
 */
export interface MissingInvitationCopy {
  locale: Locale
  field: InvitationCopyField
}

export function missingInvitationCopy(
  copy: InvitationCopyByLocale,
  requiredLocales: readonly Locale[],
): MissingInvitationCopy[] {
  const missing: MissingInvitationCopy[] = []
  for (const locale of requiredLocales) {
    for (const field of INVITATION_COPY_FIELDS) {
      if (copy[locale][field].text.trim() === '') {
        missing.push({ locale, field })
      }
    }
  }
  return missing
}

/**
 * Writes both locales in one `PUT /surveys/{id}`.
 *
 * Always the locale-keyed object shape, never a bare string — even for a single-language
 * survey, where a bare string would be legal. `LocalizedInput` rejects a bare string when
 * the survey is authored in `both`, and a client that sends one shape sometimes and the
 * other shape otherwise is a client with a branch that only fails on the surveys that
 * matter most.
 *
 * Only the required locales are sent. `null`/omitted means "leave this column alone", so
 * an untouched language is never blanked; clearing one is an explicit empty string, which
 * is what an emptied textarea produces.
 */
export async function saveSurveyInvitationCopy(
  baseUrl: string,
  surveyId: string,
  copy: InvitationCopyByLocale,
  requiredLocales: readonly Locale[],
): Promise<void> {
  const byLocale = (field: InvitationCopyField): Record<string, string> =>
    Object.fromEntries(requiredLocales.map((locale) => [locale, copy[locale][field].text]))

  await authFetch(`${baseUrl}/surveys/${surveyId}`, {
    method: 'PUT',
    // Only the two copy fields. Notably absent: `anonymous`, which the API classes as
    // CONTENT rather than a setting — including it would turn this save into a content
    // edit and get a 409 on any survey that is not still a draft.
    body: JSON.stringify({
      settings: {
        invitationCustomSubject: byLocale('subject'),
        invitationCustomMessage: byLocale('message'),
      },
    }),
  })
}
