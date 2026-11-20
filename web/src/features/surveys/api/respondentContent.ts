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
 * payload's `resolvedLocale`, plus the display choices. A key that is absent is the product
 * default, so a screen renders
 *
 *     effectiveText(view.content, 'demographics.intro') ?? t('demographics.intro')
 *
 * with ONE key: a screen key is its catalogue path inside `useTranslation('surveyRespond')`,
 * without the namespace. `{name}` placeholders in an override are filled the way `t()` fills
 * them; the registry allows only those the default itself uses.
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
 * so a screen writes `effectiveText(view.content, key, params) ?? t(key, params)`. A blank value
 * is treated as absent, exactly as the server does.
 */
export function effectiveText(
  content: RespondentContent | null | undefined,
  key: string,
  params?: Record<string, string | number>,
): string | null {
  const value = content && Object.hasOwn(content, key) ? content[key] : undefined
  if (typeof value !== 'string' || value.trim() === '') return null
  return interpolateContent(value, params)
}

/** `display.textAlign` from a payload's `content`: `justify` unless the client chose `start`. */
export function textAlignOf(content: RespondentContent | null | undefined): RespondentTextAlign {
  return content?.[TEXT_ALIGN_KEY] === 'start' ? 'start' : 'justify'
}
