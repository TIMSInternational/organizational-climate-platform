import { ApiError, authFetch } from '../../../api/authFetch'

/**
 * What a client reads, edited rather than coded (ruled 2026-11-19,
 * `docs/decisions/editable-respondent-content.md`): the company's own wording and a survey's,
 * over a FIXED registry that lives once on the server (`RespondentContentRegistry.cs`).
 *
 * ## The chain, and where it runs
 *
 *     survey  →  company  →  product default (this app's catalogue / the API's C# copy)
 *
 * The server resolves the first two (`RespondentContentResolver.cs`) and every respondent
 * payload carries the result as `content`: `SurveyRespondView.content` and
 * `SurveyInvitationTokenDetail.content`, a `key → text` map of the EFFECTIVE overrides in the
 * payload's `resolvedLocale`, plus the display choices. The two refusals a screen draws as a
 * card with no view loaded carry the same pair (`SurveyRespondError` on the closed survey's
 * 400, `SurveyLinkError` on the invitation's 409 `already_completed`). A key that is absent is
 * the product default, so a screen renders
 *
 *     const { t, locale } = useTranslation('surveyRespond')
 *     effectiveText(view, locale, 'demographics.intro') ?? t('demographics.intro')
 *
 * with ONE key: a screen key is its catalogue path inside `useTranslation('surveyRespond')`,
 * without the namespace. `{name}` placeholders in an override are filled the way `t()` fills
 * them; the registry allows only those the default itself uses.
 *
 * **The reader's language decides, not the payload's.** `effectiveText` takes the whole payload
 * and the locale the screen's chrome is drawn in, and gives `null` (the catalogue default, in
 * the reader's language) whenever the payload's words were resolved in another one — an
 * es-only survey read by somebody who chose English. An override written in Spanish is never
 * shown to an English reader (`docs/decisions/editable-respondent-content.md`). There is
 * deliberately no overload that takes the bare map.
 *
 * ## The editor routes
 *
 * `GET/PUT /admin/companies/{companyId}/respondent-content` and
 * `GET/PUT /surveys/{surveyId}/respondent-content`, mirrored exactly below. Every values map is
 * `locale → key → text` with all three locales present: texts under `es`/`en`, display choices
 * under `*`. A PUT is partial — only the keys sent change — and `''` clears a key at that level.
 */

/** The locales a value is stored under. `*` holds the locale-independent display choices. */
export const RESPONDENT_CONTENT_LOCALES = ['es', 'en', '*'] as const
export type RespondentContentLocale = (typeof RESPONDENT_CONTENT_LOCALES)[number]

/** The locales a TEXT is written in. */
export type RespondentTextLocale = Exclude<RespondentContentLocale, '*'>

export type RespondentContentKind = 'screen' | 'email' | 'display'
export type RespondentContentLevel = 'company' | 'survey'

/** `key → text`. What a respondent payload carries as `content`. */
export type RespondentContent = Record<string, string>

/**
 * Anything that carries the client's words for a respondent screen: a respond view, an
 * invitation landing, or a refusal drawn as a card. `content` is in `resolvedLocale` and no
 * other language.
 */
export interface RespondentContentSource {
  content?: RespondentContent | null
  resolvedLocale?: string | null
}

/** `locale → key → text`, every locale present. */
export type RespondentContentByLocale = Record<RespondentContentLocale, RespondentContent>

/** One registry entry, mirroring `RespondentContentEntryDto`. */
export interface RespondentContentEntry {
  key: string
  kind: RespondentContentKind
  /** The screen or email it is read on: `start`, `invitation`, `anonymity`, `demographics`, `identity`, `footer`, `thanks`, `cards`, `email.personalLink`, `email.credentials`, `email.reminder`, `display`. */
  group: string
  /** Longest value accepted, after trimming. */
  maxLength: number
  /** Placeholder names without braces, e.g. `['count', 'minutes']`. */
  placeholders: string[]
  /** A display entry's allowed values; empty for a text. */
  values: string[]
  /** A display entry's product default; null for a text. */
  defaultValue: string | null
  /** Set when the survey level of this key lives in a survey column (`RespondentIntro`, …). */
  legacyColumn: string | null
}

/** `GET` (and the `PUT`'s answer), mirroring `RespondentContentView`. */
export interface RespondentContentView {
  level: RespondentContentLevel
  companyId: string
  /** Null at the company level. */
  surveyId: string | null
  /** The company's `settings.language` or the survey's `language`: `es`, `en` or `both`. */
  language: string
  /** The locales the editor should offer. */
  requiredLocales: RespondentTextLocale[]
  /** Whether THIS caller may save now. */
  editable: boolean
  /** Null at the company level. */
  surveyStatus: string | null
  entries: RespondentContentEntry[]
  /** The company's own stored values. */
  companyValues: RespondentContentByLocale
  /** The survey's own stored values (its legacy columns under their keys); null at the company level. */
  surveyValues: RespondentContentByLocale | null
  /** What a reader in each locale gets. Absent key = product default. */
  effective: RespondentContentByLocale
}

/** A `PUT` body's `values`: partial; `''` clears that key at this level. */
export type RespondentContentChanges = Partial<Record<RespondentContentLocale, Record<string, string>>>

/**
 * A refused `PUT`, carrying where the problem is. `code` is one of the `respondent_content_*`
 * codes `describeApiError` says in the reader's language; the rest names the field.
 */
export class RespondentContentRefusal extends ApiError {
  readonly key: string | null
  readonly locale: string | null
  readonly placeholder: string | null
  readonly maxLength: number | null
  readonly allowed: string[] | null

  constructor(
    status: number,
    message: string,
    code: string | undefined,
    detail: { key?: string | null; locale?: string | null; placeholder?: string | null; maxLength?: number | null; allowed?: string[] | null },
  ) {
    super(status, message, code)
    this.name = 'RespondentContentRefusal'
    this.key = detail.key ?? null
    this.locale = detail.locale ?? null
    this.placeholder = detail.placeholder ?? null
    this.maxLength = typeof detail.maxLength === 'number' ? detail.maxLength : null
    this.allowed = Array.isArray(detail.allowed) ? detail.allowed : null
  }
}

/** The key of the one display choice today. */
export const TEXT_ALIGN_KEY = 'display.textAlign'
export type RespondentTextAlign = 'justify' | 'start'

function companyPath(companyId: string): string {
  return `/admin/companies/${encodeURIComponent(companyId)}/respondent-content`
}

function surveyPath(surveyId: string): string {
  return `/surveys/${encodeURIComponent(surveyId)}/respondent-content`
}

function byLocale(raw: Partial<Record<string, RespondentContent>> | null | undefined): RespondentContentByLocale {
  return {
    es: { ...(raw?.es ?? {}) },
    en: { ...(raw?.en ?? {}) },
    '*': { ...(raw?.['*'] ?? {}) },
  }
}

/** The wire payload, every locale filled in even if an older API left one out. */
export function toRespondentContentView(raw: RespondentContentView): RespondentContentView {
  return {
    ...raw,
    entries: raw.entries ?? [],
    companyValues: byLocale(raw.companyValues),
    surveyValues: raw.surveyValues == null ? null : byLocale(raw.surveyValues),
    effective: byLocale(raw.effective),
  }
}

async function read(baseUrl: string, path: string): Promise<RespondentContentView> {
  const response = await authFetch(`${baseUrl}${path}`)
  return toRespondentContentView((await response.json()) as RespondentContentView)
}

async function write(baseUrl: string, path: string, changes: RespondentContentChanges): Promise<RespondentContentView> {
  // 400 and 409 are read here rather than by `authFetch`, which would keep the code and drop
  // the field the refusal names.
  const response = await authFetch(
    `${baseUrl}${path}`,
    { method: 'PUT', body: JSON.stringify({ values: changes }) },
    { allowStatus: [400, 409] },
  )
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    throw new RespondentContentRefusal(
      response.status,
      typeof body?.message === 'string' ? body.message : `Request failed: ${response.status}`,
      typeof body?.code === 'string' ? body.code : undefined,
      (body ?? {}) as ConstructorParameters<typeof RespondentContentRefusal>[3],
    )
  }
  return toRespondentContentView(body as unknown as RespondentContentView)
}

/** The company's own wording. A super admin for any company; a company admin for their own. */
export function getCompanyRespondentContent(baseUrl: string, companyId: string): Promise<RespondentContentView> {
  return read(baseUrl, companyPath(companyId))
}

export function saveCompanyRespondentContent(
  baseUrl: string,
  companyId: string,
  changes: RespondentContentChanges,
): Promise<RespondentContentView> {
  return write(baseUrl, companyPath(companyId), changes)
}

/** A survey's wording, with its company's beside it and the effective result. */
export function getSurveyRespondentContent(baseUrl: string, surveyId: string): Promise<RespondentContentView> {
  return read(baseUrl, surveyPath(surveyId))
}

/**
 * A company admin while the survey is draft, scheduled or active; a super admin in any status
 * but archived (409 `respondent_content_locked` / `respondent_content_archived` otherwise).
 */
export function saveSurveyRespondentContent(
  baseUrl: string,
  surveyId: string,
  changes: RespondentContentChanges,
): Promise<RespondentContentView> {
  return write(baseUrl, surveyPath(surveyId), changes)
}

/** Fills `{name}` the way `i18n/translate.ts` does, leaving an unknown one visible. */
export function interpolateContent(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

/**
 * The client's own words for `key`, placeholders filled, or `null` for the product default —
 * so a screen writes `effectiveText(view, locale, key, params) ?? t(key, params)`.
 *
 * @param source the payload (or refusal) that carries `content` and its `resolvedLocale`.
 * @param uiLocale the language the screen's own chrome is in (`useTranslation().locale`). When
 * it is not the payload's `resolvedLocale` the answer is `null`: the reader gets the default in
 * their language rather than the client's words in another. A payload with no
 * `resolvedLocale` (an older API) is treated the same way.
 *
 * A blank value is treated as absent, exactly as the server does.
 */
export function effectiveText(
  source: RespondentContentSource | null | undefined,
  uiLocale: string,
  key: string,
  params?: Record<string, string | number>,
): string | null {
  if (!source || source.resolvedLocale !== uiLocale) return null
  const content = source.content
  const value = content && Object.hasOwn(content, key) ? content[key] : undefined
  if (typeof value !== 'string' || value.trim() === '') return null
  return interpolateContent(value, params)
}

/**
 * `display.textAlign` from a payload's `content`: `justify` unless the client chose `start`. A
 * display choice is locale-independent, so unlike `effectiveText` it reads whatever language
 * the payload is in.
 */
export function textAlignOf(content: RespondentContent | null | undefined): RespondentTextAlign {
  return content?.[TEXT_ALIGN_KEY] === 'start' ? 'start' : 'justify'
}

/**
 * `content` and `resolvedLocale` out of a parsed response body, or nulls — for the refusals a
 * screen draws as a card. Only string values are kept: a body is data from the network.
 */
export function respondentContentOf(body: unknown): { content: RespondentContent | null; resolvedLocale: string | null } {
  if (body === null || typeof body !== 'object') return { content: null, resolvedLocale: null }
  const raw = (body as Record<string, unknown>).content
  const locale = (body as Record<string, unknown>).resolvedLocale
  let content: RespondentContent | null = null
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    content = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') content[key] = value
    }
  }
  return { content, resolvedLocale: typeof locale === 'string' ? locale : null }
}
