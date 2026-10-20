import { getToken } from '../../../auth/token'

/**
 * The respondent surface of the survey API (#118): fetch a survey to answer, and
 * submit the answers.
 *
 * ## Why this module does not use `authFetch`
 *
 * Same reason `microclimates.ts`'s public pair does not, and it is the whole point
 * of the page above it. `POST /surveys/{id}/responses` and
 * `GET /surveys/{id}/respond` are answered by employees who administer nothing and,
 * on an anonymous survey, by visitors who are not authenticated at all. `authFetch`
 * clears the token and hard-redirects to `/login` on a 401, which would yank a
 * genuinely anonymous respondent off the page before the form — or a normal error
 * message — ever rendered.
 *
 * A bearer token IS still attached when one happens to be present, because the same
 * two endpoints serve the authenticated respondent. The server decides what that
 * identity is worth; this module never does.
 */

/**
 * One option as the respondent sees it and as the server stores it.
 *
 * `value` is the stable, locale-independent key that lands in
 * `question_responses.response_value`. `label` is display only. Submitting the label
 * is what splits one answer into two across languages (#195), so nothing in this
 * feature ever sends it.
 */
export interface SurveyRespondOption {
  order: number
  value: string
  label: string | null
}

export interface SurveyRespondQuestion {
  id: string
  text: string | null
  type: string
  options: SurveyRespondOption[] | null
  scaleMin: number | null
  scaleMax: number | null
  scaleLabelMin: string | null
  scaleLabelMax: string | null
  required: boolean
  commentRequired: boolean
  commentPrompt: string | null
  order: number
  category: string | null
}

/** `value` is set for a single-valued answer; `values` for a ranking. Never both. */
export interface SurveySavedAnswer {
  questionId: string
  value: string | null
  values: string[] | null
  text: string | null
  timeSpentSeconds: number | null
}

/** A response in progress, so a closed tab can be recovered. */
export interface SurveyResponseState {
  responseId: string
  sessionId: string
  isComplete: boolean
  language: string
  startTime: string
  completionTime: string | null
  answers: SurveySavedAnswer[]
}

/**
 * The survey as a respondent sees it.
 *
 * Deliberately not the admin `SurveyDetail`: no company id, no author, no response
 * count, no allowed status transitions. A public respondent must learn nothing about
 * the tenant beyond the survey they were sent.
 *
 * `resolvedLocale` is the language the text is ACTUALLY in, not the one requested — a
 * Spanish-only survey opened with `?lang=en` comes back in Spanish and says so.
 */
export interface SurveyRespondView {
  id: string
  title: string | null
  description: string | null
  type: string
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  startDate: string
  endDate: string
  anonymous: boolean
  allowPartialResponses: boolean
  /**
   * `Survey.Settings.AutoSave` — whether this survey's author asked for progress to be
   * kept without the respondent pressing anything (#369).
   *
   * Served since #369; before that this payload carried every other setting that shapes
   * the page and not this one, so the form could not honour it and offered the manual
   * save button to every survey instead. It is a second gate on top of
   * `allowPartialResponses`, never a replacement: a survey that forbids partial
   * responses has the write refused server-side whatever this says.
   */
  autoSave: boolean
  randomizeQuestions: boolean
  showProgress: boolean
  timeLimitMinutes: number | null
  questions: SurveyRespondQuestion[]
  /**
   * The demographic questions a respondent with NO account answers about themselves,
   * before the first survey question.
   *
   * Empty unless all three of the server's conditions hold — the survey has
   * `selfDeclaredDemographics` on, it is anonymous, and the caller is unauthenticated.
   * A signed-in respondent gets `[]` and keeps having their demographics snapshotted
   * from their own profile, which is the only trustworthy source for somebody who has
   * one. See `SurveyResponseEndpoints.AsksSelfDeclaredDemographics`, which is also what
   * the submit endpoint checks, so this list and what a submission may carry cannot
   * disagree.
   */
  demographics: SurveyRespondDemographicField[]
  inProgress: SurveyResponseState | null
  /**
   * The respondent is asked their name and email before the questions. Optional because an
   * API that predates it sends nothing, which must read as "not asked" -- see the
   * `demographics` note for the deploy window this survives.
   */
  asksParticipantIdentity?: boolean
  /**
   * The survey's own paragraph for the anonymity box, set per survey ("Textos para quien
   * responde"). Applied to an anonymous response only. Null or absent -- an API that predates it,
   * or a survey nobody configured -- means the product's default paragraph.
   */
  respondentIntro?: string | null
  /** The survey's own thank-you after a completed submit. Null or absent: the default thanks. */
  closingMessage?: string | null
}

/** Who is answering, as typed. Sent on the completing post only, never on a partial save. */
export interface SurveyParticipantInput {
  name: string
  email?: string
}

/** @param options Always non-empty — the server drops a field nobody could answer. */
export interface SurveyRespondDemographicField {
  field: string
  label: string | null
  options: SurveyRespondDemographicOption[]
  required: boolean
  order: number
}

export interface SurveyRespondDemographicOption {
  /**
   * The stable, locale-independent option value — what a submission must send and what
   * gets stored (#195). Never the label: the same answer would otherwise store two
   * different strings depending on the respondent's language, and every breakdown would
   * split accordingly and silently.
   */
  value: string
  label: string | null
}

export interface SurveyAnswerInput {
  questionId: string
  value?: string
  values?: string[]
  text?: string
  timeSpentSeconds?: number
}

export interface SubmitSurveyResponseRequest {
  answers?: SurveyAnswerInput[]
  /**
   * Questions the respondent has taken back, to be deleted from the stored response
   * (#369).
   *
   * Omitting a question from `answers` does NOT mean this and must not: a partial save
   * is allowed to be a delta, so "everything I did not mention is deleted" would make
   * each tick a wipe. An answer erased on screen is only erased on the server if it is
   * named here.
   */
  clearedQuestionIds?: string[]
  sessionId?: string
  isComplete?: boolean
  language?: string
  totalTimeSeconds?: number
  /**
   * What the respondent said about themselves, keyed by `SurveyRespondDemographicField.field`.
   *
   * Only ever sent by a respondent with no account, answering a survey that asked. A
   * value outside the field's configured options is refused with 400, as is an unknown
   * key and a signed-in caller sending this at all — the server will not let anybody
   * with an account choose their own cohort.
   *
   * An empty string DECLINES an optional field: it clears the answer rather than storing
   * a blank, so no row is written. A required field cannot be declined.
   */
  demographics?: Record<string, string>
  /** Only when the respond view said `asksParticipantIdentity`, and only on the completing post. */
  participant?: SurveyParticipantInput
}

export interface SurveySubmissionResult {
  responseId: string
  sessionId: string
  isComplete: boolean
  isAnonymous: boolean
  alreadySubmitted: boolean
  language: string
  answeredQuestionCount: number
  questionCount: number
  /**
   * Demographic fields deliberately not recorded, because the respondent's value put
   * them in a cohort too small to stay anonymous. Reported rather than suppressed
   * silently — the respondent is entitled to know what was and was not kept.
   */
  suppressedDemographics: string[]
  /**
   * The same fields as the respondent should read them — each field's label in the
   * response's language. Absent from an API older than the field, so the screen falls
   * back to the keys; on the TIMS dry run the keys were all it had, and every respondent
   * read `tiempo_de_laborar_en_tims_anos`.
   */
  suppressedDemographicLabels?: string[]
}

/**
 * A failed request, carrying the status alongside the message.
 *
 * The status is what lets the page tell four genuinely different situations apart —
 * gone (404), closed (400), not available to this visitor (401), not yours to answer
 * (403) — instead of rendering one generic failure for all of them. Matching on the
 * server's English message text would be the alternative, and it would break the
 * moment that message was translated.
 */
export class SurveyRespondError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SurveyRespondError'
    this.status = status
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * The open share link's own route, as `router.tsx` registers it (`/s/:token`) and as
 * `SurveyAccessTokens.PublicLinkPrefix` composes it on the C# side.
 *
 * `/survey/:id` and `/surveys/…` do NOT match it: the slash is part of the literal.
 */
const PUBLIC_LINK_PREFIX = '/s/'

/**
 * Whether the two respond requests made from `pathname` may present the browser's bearer.
 *
 * **They may not on `/s/{token}`, and this is the difference between the link and the QR.**
 *
 * The share link and the QR code encode the same URL — `ShareLinkQr` draws the code from the
 * same `publicLink` the copy button writes to the clipboard — so the two can only differ in
 * what the browser that opens it is carrying. A QR is scanned by a phone camera, which opens
 * a browser with no session; a link is pasted into the tab the administrator is already
 * signed in to. If the respond requests present that session, the API resolves an
 * *authenticated* respondent instead of a link visitor, and three things change at once
 * (`SurveyResponseEndpoints.ResolveRespondentAsync`):
 *
 * - `AsksSelfDeclaredDemographics` is `respondent.ActingUserId is null`, so the demographic
 *   prelude is **skipped** — measured on `/s/Z9LFWdcZ…` locally: 5 fields with no bearer,
 *   `[]` with an Acme `company_admin`'s bearer, same link, same survey.
 * - `AsksParticipantIdentity` is the same predicate, so "¿Quién responde?" is skipped too.
 * - A respondent from another tenant, and one outside a targeted department, is **403**
 *   (`An_employee_of_another_tenant_cannot_respond`) — measured as 403 with
 *   `ana.rojas@meridiano.test`'s bearer against Acme's link, where the same link with no
 *   bearer is 200. On screen that is `respondFailureOutcome(403)`: the padlock card, not the
 *   survey. The link appears broken while the QR works.
 *
 * The API is right — those checks are what `/survey/:id` needs — and the client is wrong to
 * volunteer a credential on a route whose whole contract is that its visitor has no account.
 * The token in the path IS the credential (`PublicSurveyLinkPage`), nobody who opens one logs
 * in (ruled 2026-10-12), and the endpoint's own comments are written on that assumption.
 *
 * Decided by the route rather than threaded through each call site because the respond flow
 * makes its requests from two places — this module's two functions are called by
 * `usePublicEntryModel` for the entry card and by `SurveyRespondForm` for the questions, the
 * autosave and the final post — and a flag one of them forgets is a guarantee silently
 * dropped on that path. The route is the one fact all of them agree on.
 */
export function respondSendsCredentials(pathname: string): boolean {
  return !pathname.startsWith(PUBLIC_LINK_PREFIX)
}

/**
 * `authHeaders()` everywhere but on the open share link, where it is deliberately nothing.
 *
 * @see respondSendsCredentials
 */
function respondHeaders(): Record<string, string> {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  return respondSendsCredentials(pathname) ? authHeaders() : {}
}

async function fail(response: Response): Promise<never> {
  const body: unknown = await response.json().catch(() => null)
  const message =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : ''
  throw new SurveyRespondError(response.status, message)
}

/**
 * @param options.lang the locale to render in. Sent explicitly on every read: letting
 * the server default it resolves against the *survey's* language rather than the
 * *reader's*.
 * @param options.sessionId the client's resume key, so an interrupted response comes
 * back with its saved answers.
 */
export async function getSurveyRespondView(
  baseUrl: string,
  id: string,
  options: { lang?: string; sessionId?: string } = {},
): Promise<SurveyRespondView> {
  const query = new URLSearchParams()
  if (options.lang) query.set('lang', options.lang)
  if (options.sessionId) query.set('sessionId', options.sessionId)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''

  const response = await fetch(`${baseUrl}/surveys/${encodeURIComponent(id)}/respond${suffix}`, {
    headers: respondHeaders(),
  })
  if (!response.ok) return fail(response)
  return response.json() as Promise<SurveyRespondView>
}

/**
 * Submits answers, complete or partial.
 *
 * Idempotent on the server, keyed on the acting user for an identified survey and on
 * `sessionId` for an anonymous one — so a retry after a timeout returns the same
 * response id with `alreadySubmitted: true` rather than creating a second response.
 * That is why the caller must send a session id that survives a reload.
 *
 * A partial save is an upsert on `question_responses (response_id, question_id)`
 * (verified against the endpoint, and asserted end to end by
 * `Repeated_partial_saves_accumulate_into_one_response_rather_than_many`), so a client
 * may post its whole current answer set on a timer without accumulating rows.
 *
 * @param options.keepalive keeps the request alive past the document that started it.
 * Set only by the save fired when the page is being hidden or closed: an ordinary
 * `fetch` is cancelled with its document, which is exactly the moment a respondent's
 * unsaved answers matter most. `sendBeacon` is not used instead because it cannot carry
 * the `Authorization` header this endpoint reads on an identified survey.
 */
export async function submitSurveyResponse(
  baseUrl: string,
  id: string,
  request: SubmitSurveyResponseRequest,
  options: { keepalive?: boolean } = {},
): Promise<SurveySubmissionResult> {
  const response = await fetch(`${baseUrl}/surveys/${encodeURIComponent(id)}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...respondHeaders() },
    body: JSON.stringify(request),
    ...(options.keepalive === true ? { keepalive: true } : {}),
  })
  if (!response.ok) return fail(response)
  return response.json() as Promise<SurveySubmissionResult>
}
