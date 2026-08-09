import { authFetch } from '../../../api/authFetch'
import type { LocalizedInput } from './surveyCreate'

/**
 * Typed client for `/surveys/drafts` (`SurveyDraftEndpoints.cs`, landed in #105).
 *
 * ## The surface existed for a release with nothing calling it
 *
 * #105 shipped a complete autosave-and-recover API — create, save, autosave, `/latest`
 * for recovery, optimistic concurrency on `version`, an expiry sweep — and no client
 * code ever touched it, so the wizard added in #265 lost everything on a refresh. This
 * module is the missing half (#266).
 *
 * ## A draft is keyed on (user, session), not on a survey
 *
 * `SurveyDraft` has no `surveyId`: it is the scratchpad for a survey that does not exist
 * yet, which is exactly why losing it hurts. Once `POST /surveys` has run the survey is
 * the record and the draft is deletable — see `deleteSurveyDraft`.
 *
 * `POST /surveys/drafts` is **idempotent per session**: posting twice with the same
 * `sessionId` returns the existing draft with `200` rather than making a second one. So
 * the caller may create eagerly on every mount without littering.
 *
 * ## Content is opaque, and Tier 1 is not
 *
 * `content` is arbitrary JSON the server round-trips verbatim and never interprets. It
 * is where the whole wizard snapshot lives (`draftContent.ts`).
 *
 * `title` and `description` were deliberately lifted *out* of it so the fields the
 * server owns obey the #195 rule, which means they come back **already resolved to one
 * locale** — a `'both'` draft's other language is not recoverable from them. They are
 * for the recovery banner to have something to name the draft with; the authoritative,
 * lossless copy is inside `content`. Do not restore the wizard from them.
 */

/** A row of `GET /surveys/drafts`. Deliberately without `content` — the listing would grow forever. */
export interface SurveyDraftSummary {
  id: string
  sessionId: string
  title: string | null
  language: string
  resolvedLocale: string
  currentStep: number
  lastEditedField: string | null
  version: number
  autoSaveCount: number
  isRecovered: boolean
  lastAutosaveAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface SurveyDraftMissingTranslation {
  field: string
  language: string
}

/** `GET /surveys/drafts/{id}`, and the body of every write. */
export interface SurveyDraftDetail {
  id: string
  sessionId: string
  companyId: string
  /** Resolved to one locale. See the note above: not a lossless copy of a bilingual title. */
  title: string | null
  description: string | null
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  missingTranslations: SurveyDraftMissingTranslation[]
  isTranslationComplete: boolean
  /** The wizard's own snapshot, verbatim. Parse with `draftValuesFrom`. */
  content: unknown
  currentStep: number
  lastEditedField: string | null
  /** The optimistic-concurrency token. Echo it as `expectedVersion` on the next save. */
  version: number
  autoSaveCount: number
  isRecovered: boolean
  lastAutosaveAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface CreateSurveyDraftInput {
  sessionId?: string
  title?: LocalizedInput
  description?: LocalizedInput
  content?: unknown
  currentStep?: number
  lastEditedField?: string
  /** 'en' | 'es' | 'both'. Omitted inherits the company's own language. */
  language?: string
}

export interface SaveSurveyDraftInput {
  title?: LocalizedInput
  description?: LocalizedInput
  content?: unknown
  currentStep?: number
  lastEditedField?: string
  language?: string
  /**
   * Omitting this makes the write unconditional — last writer wins, silently. Send it,
   * and handle {@link SurveyDraftConflictError}.
   */
  expectedVersion?: number
}

/**
 * Thrown by `saveSurveyDraft`/`autosaveSurveyDraft` when the draft moved on underneath
 * the caller. Carries the draft that actually won, so the UI can say what it lost to
 * rather than only that something went wrong.
 */
export class SurveyDraftConflictError extends Error {
  readonly draft: SurveyDraftDetail

  constructor(message: string, draft: SurveyDraftDetail) {
    super(message)
    this.name = 'SurveyDraftConflictError'
    this.draft = draft
  }
}

function withLang(baseUrl: string, path: string, lang?: string): string {
  return lang ? `${baseUrl}${path}?lang=${encodeURIComponent(lang)}` : `${baseUrl}${path}`
}

/**
 * Create the draft for this session, or return the one that already exists for it.
 *
 * Answers `201` on a genuine create and `200` on the idempotent hit; both carry the
 * same body, so the caller does not need to tell them apart.
 */
export async function createSurveyDraft(
  baseUrl: string,
  input: CreateSurveyDraftInput,
  lang?: string,
): Promise<SurveyDraftDetail> {
  const response = await authFetch(withLang(baseUrl, '/surveys/drafts', lang), {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<SurveyDraftDetail>
}

/**
 * The most recent unexpired draft this user has, or `null`.
 *
 * A wrapper with a nullable member rather than a 404, because "nothing to recover" is
 * the normal answer — the wizard asks this on every open.
 *
 * `sessionId` is deliberately **not** passed by the recovery flow: the case that matters
 * is a tab that was closed, whose session id died with it. Filtering by session would
 * answer "nothing to recover" in exactly the situation recovery exists for.
 */
export async function getLatestSurveyDraft(
  baseUrl: string,
  lang?: string,
): Promise<SurveyDraftDetail | null> {
  const response = await authFetch(withLang(baseUrl, '/surveys/drafts/latest', lang))
  const body = (await response.json()) as { draft: SurveyDraftDetail | null }
  return body.draft
}

async function writeDraft(
  baseUrl: string,
  input: SaveSurveyDraftInput,
  path: string,
  method: string,
  lang?: string,
): Promise<SurveyDraftDetail> {
  const response = await authFetch(
    withLang(baseUrl, path, lang),
    { method, body: JSON.stringify(input) },
    // 409 carries the winning draft in its body; letting authFetch throw would discard it.
    { allowStatus: [409] },
  )
  if (response.status === 409) {
    const body = (await response.json()) as { message: string; draft: SurveyDraftDetail }
    throw new SurveyDraftConflictError(body.message, body.draft)
  }
  return response.json() as Promise<SurveyDraftDetail>
}

/**
 * Save, advancing `autoSaveCount`/`lastAutosaveAt`.
 *
 * The wizard writes through this and never through `PUT /surveys/drafts/{id}`, which is
 * the same operation without the counter. There is no second kind of save to distinguish
 * it from — every write here is the timer firing — and #268 is about surfaces nothing
 * calls, so this module does not add a wrapper for the variant nothing would use.
 */
export function autosaveSurveyDraft(
  baseUrl: string,
  id: string,
  input: SaveSurveyDraftInput,
  lang?: string,
): Promise<SurveyDraftDetail> {
  return writeDraft(baseUrl, input, `/surveys/drafts/${id}/autosave`, 'POST', lang)
}

/**
 * Mark a draft recovered and return its full state.
 *
 * Deliberately does not bump `version` server-side, so the caller's concurrency token
 * stays valid and the first autosave after a recovery is not a spurious conflict.
 */
export async function recoverSurveyDraft(
  baseUrl: string,
  id: string,
  lang?: string,
): Promise<SurveyDraftDetail> {
  const response = await authFetch(withLang(baseUrl, `/surveys/drafts/${id}/recover`, lang), {
    method: 'POST',
  })
  return response.json() as Promise<SurveyDraftDetail>
}

/** `DELETE /surveys/drafts/{id}` answers 204, so there is no body to parse. */
export async function deleteSurveyDraft(baseUrl: string, id: string): Promise<void> {
  await authFetch(`${baseUrl}/surveys/drafts/${id}`, { method: 'DELETE' })
}
