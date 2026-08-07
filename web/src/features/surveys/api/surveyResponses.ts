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
  randomizeQuestions: boolean
  showProgress: boolean
  timeLimitMinutes: number | null
  questions: SurveyRespondQuestion[]
  inProgress: SurveyResponseState | null
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
  sessionId?: string
  isComplete?: boolean
  language?: string
  totalTimeSeconds?: number
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
    headers: authHeaders(),
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
 */
export async function submitSurveyResponse(
  baseUrl: string,
  id: string,
  request: SubmitSurveyResponseRequest,
): Promise<SurveySubmissionResult> {
  const response = await fetch(`${baseUrl}/surveys/${encodeURIComponent(id)}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(request),
  })
  if (!response.ok) return fail(response)
  return response.json() as Promise<SurveySubmissionResult>
}
