import { authFetch } from '../../../api/authFetch'
import { getToken } from '../../../auth/token'

/**
 * One answer option.
 *
 * `value` is a stable, locale-independent key -- it is what must be submitted and
 * what the backend stores. `label` is display text, already resolved for the
 * requested locale, and must never be sent back as the answer: two respondents
 * picking the same option in different languages would otherwise store two
 * unrelated strings and split every count (#195).
 */
export interface QuestionOption {
  order: number
  value: string
  label: string | null
}

/**
 * One point on an `emoji_rating` question's scale (#198).
 *
 * `emoji` is the glyph and is decoration ONLY -- it must be rendered `aria-hidden`.
 * `label` is the option's accessible name, already resolved for the requested locale,
 * and it is what names the control: an emoji-only radio is announced by whatever the
 * screen reader's own emoji dictionary calls the character, in whatever language that
 * dictionary happens to be in. That is the failure this shape exists to prevent, and
 * it is why the glyph and the name are two fields rather than one.
 *
 * `value` is the stable key and it is what must be SUBMITTED -- as a string, since
 * answers travel as text. It is not necessarily 1..n: an author may configure -1..1.
 */
export interface QuestionEmojiOption {
  order: number
  emoji: string
  value: number
  label: string | null
}

export interface Question {
  id: string
  /** Already resolved for the requested locale -- never a per-language object. */
  text: string | null
  type: string
  options: QuestionOption[] | null
  required: boolean
  order: number
  /** The scale of an `emoji_rating` question; null on every other type. */
  emojiOptions?: QuestionEmojiOption[] | null
}

/**
 * Write shape. `label` may be a plain string (attributed to the microclimate's own
 * language) or a locale map such as `{ en: 'Yes', es: 'Si' }`. `value` is derived
 * from the label when omitted.
 */
export type LocalizedInput = string | Partial<Record<'en' | 'es', string>>

export interface CreateQuestionOptionInput {
  value?: string
  label: LocalizedInput
}

/**
 * Write shape for one point on an emoji scale (#198).
 *
 * `value` may be omitted, in which case the server numbers the scale by position
 * (1..n). `label` is not optional in practice: the server rejects a face with no
 * label, because that face would reach a respondent with no accessible name.
 */
export interface CreateQuestionEmojiOptionInput {
  emoji: string
  value?: number
  label: LocalizedInput
}

export interface CreateQuestionInput {
  text: LocalizedInput
  type: string
  options?: CreateQuestionOptionInput[]
  required: boolean
  order: number
  /** Only valid on `emoji_rating`; the server rejects it on any other type. */
  emojiOptions?: CreateQuestionEmojiOptionInput[]
}

export interface Microclimate {
  id: string
  title: string | null
  companyId: string
  status: string
  language: string
  responseCount: number
  targetParticipantCount: number
  createdAt: string
}

export interface MicroclimateDetail {
  id: string
  title: string | null
  description: string | null
  companyId: string
  createdBy: string
  status: string
  responseCount: number
  targetParticipantCount: number
  startTime: string
  endTime: string
  anonymousResponses: boolean
  showLiveResults: boolean
  questions: Question[]
  /** The content's own language: 'en' | 'es' | 'both'. */
  language: string
  /** The locale this payload was resolved for. */
  resolvedLocale: string
  /** Fields that had to fall back to another language, e.g. `questions[0].text`. */
  fallbackFields: string[]
}

// Deliberately reduced shape -- this is what GET /microclimates/{id} returns to an
// unauthenticated caller (the public MicroclimateRespondPage), not the full MicroclimateDetail
// an authenticated admin sees. Must stay in sync with PublicMicroclimateDetail on the backend
// (MicroclimateDtos.cs) -- title/status/questions only, no companyId/createdBy/description/
// participation metrics.
export interface PublicMicroclimateDetail {
  id: string
  title: string | null
  status: string
  questions: Question[]
  language: string
  resolvedLocale: string
  fallbackFields: string[]
}

export interface CreateMicroclimateInput {
  title: LocalizedInput
  description?: LocalizedInput
  companyId: string
  startTime: string
  endTime: string
  targetParticipantCount: number
  anonymousResponses: boolean
  templateId?: string
  questions?: CreateQuestionInput[]
  /** IANA timezone name (e.g. "America/Bogota"). Defaults to the browser's own timezone
   * if omitted -- see createMicroclimate below. */
  timezone?: string
  /** 'en' | 'es' | 'both'. Defaults to the company's own language. */
  language?: string
}

export interface UpdateMicroclimateInput {
  title?: LocalizedInput
  description?: LocalizedInput
  status?: string
  endTime?: string
  language?: string
}

export interface WordCloudEntry {
  text: string
  value: number
  /** Word counts are kept per respondent language so "trabajo" and "work" do not
   * compete as if they were different words. */
  language: string
}

export interface LiveResults {
  sentimentScore: number
  engagementLevel: string
  wordCloud: WordCloudEntry[]
  responseCount: number
  targetParticipantCount: number
}

export async function listMicroclimates(baseUrl: string, companyId: string): Promise<Microclimate[]> {
  const response = await authFetch(`${baseUrl}/microclimates?companyId=${companyId}`)
  const body = (await response.json()) as { microclimates: Microclimate[] }
  return body.microclimates
}

// <input type="datetime-local"> values (e.g. "2026-08-01T10:30") carry no UTC offset. Sent
// as-is, System.Text.Json parses them as DateTimeOffset by stamping the *server's* local
// offset, silently reinterpreting the admin's intended wall-clock time in whatever zone the
// server happens to run in. `new Date(local)` parses that same string as the *browser's*
// local time (the only reasonable interpretation of what the admin typed), and
// `.toISOString()` always emits an unambiguous UTC ("Z") string -- safe regardless of server
// timezone.
function toUtcIso(localDateTime: string): string {
  return new Date(localDateTime).toISOString()
}

export async function createMicroclimate(baseUrl: string, input: CreateMicroclimateInput): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates`, {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      startTime: toUtcIso(input.startTime),
      endTime: toUtcIso(input.endTime),
      timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  })
  return response.json() as Promise<MicroclimateDetail>
}

export async function getMicroclimate(baseUrl: string, id: string, lang?: string): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}${lang ? `?lang=${lang}` : ''}`)
  return response.json() as Promise<MicroclimateDetail>
}

// Deliberately does not use authFetch -- this is called from the unauthenticated public
// respond page (Task 7), same as submitResponse below. A genuinely anonymous visitor has no
// token to begin with, and authFetch's 401 handling (clear token + hard-redirect to /login)
// would otherwise yank them off the respond page before the form (or a normal error message)
// ever renders. A token IS still attached if one happens to be present (an already-logged-in
// admin previewing the form). The backend allows this specific GET without a token when the
// microclimate is configured for anonymous responses; anything else surfaces as a normal
// thrown error for the page to render inline.
export async function getMicroclimatePublic(baseUrl: string, id: string, lang?: string): Promise<PublicMicroclimateDetail> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${baseUrl}/microclimates/${id}${lang ? `?lang=${lang}` : ''}`, { headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
  return response.json() as Promise<PublicMicroclimateDetail>
}

export async function updateMicroclimate(baseUrl: string, id: string, input: UpdateMicroclimateInput): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateDetail>
}

export async function getLiveResults(baseUrl: string, id: string): Promise<LiveResults> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}/live-results`)
  return response.json() as Promise<LiveResults>
}

// Deliberately does not use authFetch -- this is called from the unauthenticated
// public respond page (Task 7) when the microclimate allows anonymous responses.
// A token IS still attached if one happens to be present (an already-logged-in
// admin previewing the form), but its absence must not block the request.
export async function submitResponse(
  baseUrl: string,
  id: string,
  answers: Record<string, string>,
  language?: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/microclimates/${id}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The locale the respondent was actually served, recorded rather than inferred
    // from what they typed.
    body: JSON.stringify({ answers, language }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
}
