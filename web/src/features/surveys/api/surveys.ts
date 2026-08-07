import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for `/surveys` (`SurveyEndpoints.cs`, landed in #104).
 *
 * ## Three list shapes, not one
 *
 * The backend deliberately serves three different projections and conflating any two
 * of them is the mistake this file exists to prevent:
 *
 * - `GET /surveys` (and its `/surveys/scoped` alias, the *same handler*) returns
 *   `SurveyListItem` — twelve columns, admin-only.
 * - `GET /surveys/my` returns `MySurveyListItem` — a deliberately reduced shape with
 *   no `companyId`, no `createdBy`, no `responseCount`, no settings and no questions.
 *   It is what a *respondent* is expected to answer, and it is role-agnostic: it
 *   resolves the acting user's own row rather than reading a role claim.
 * - `GET /surveys/{id}` returns the full `SurveyDetail`.
 *
 * Typing `/surveys/my` as `SurveyListItem` would promise a `status` and a
 * `responseCount` that never arrive, and a page reading them would render `undefined`
 * with a clean typecheck.
 *
 * ## Content i18n (#195)
 *
 * Not one field below is `En`/`Es`-shaped. Every authored string arrives already
 * resolved for the requested locale, and the payload self-reports what it did:
 * `resolvedLocale` names the language the text is **actually in**, not the one asked
 * for, and `fallbackFields` lists the paths that had to reach for the other language.
 * A Spanish reader served English content can therefore be told so — which is the
 * entire point of shipping those two fields, and why `SurveyDetailPage` surfaces them
 * rather than dropping them on the floor.
 *
 * ## No write DTOs here
 *
 * Create/update take `LocalizedInput` and belong to the wizard (#108). This lane is
 * the read/browse/manage surface, so it carries only the verbs its pages issue:
 * status transitions, duplication and deletion.
 */

/**
 * One answer option as the server stores it.
 *
 * `value` is the stable, locale-independent key that aggregation joins on;
 * `label` is display text already resolved for the requested locale. The two are
 * not interchangeable — see `QuestionOption` in the microclimates client for the
 * same warning arrived at from the write side.
 */
export interface SurveyQuestionOption {
  order: number
  value: string
  label: string | null
}

export interface SurveyQuestion {
  id: string
  /** Already resolved for the requested locale — never a per-language object. */
  text: string | null
  /** One of `QuestionTypes.ForSurvey` (likert, multiple_choice, ranking, open_ended, yes_no, rating). */
  type: string
  options: SurveyQuestionOption[] | null
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

export interface SurveySettings {
  anonymous: boolean
  allowPartialResponses: boolean
  randomizeQuestions: boolean
  showProgress: boolean
  autoSave: boolean
  timeLimitMinutes: number | null
  responseLimit: number | null
  notificationSendInvitations: boolean
  notificationSendReminders: boolean
  notificationReminderFrequencyDays: number
  invitationCustomMessage: string | null
  invitationCustomSubject: string | null
  invitationIncludeCredentials: boolean
  invitationSendImmediately: boolean
  invitationBrandingEnabled: boolean
}

/** A row of `GET /surveys` — see `SurveyListItem` in SurveyDtos.cs. */
export interface SurveyListItem {
  id: string
  title: string | null
  companyId: string
  type: string
  status: string
  /** The content's own language: 'en' | 'es' | 'both'. */
  language: string
  startDate: string
  endDate: string
  responseCount: number
  targetAudienceCount: number | null
  questionCount: number
  createdAt: string
}

/** `GET /surveys/{id}` — see `SurveyDetail` in SurveyDtos.cs. */
export interface SurveyDetail {
  id: string
  title: string | null
  description: string | null
  companyId: string
  createdBy: string
  type: string
  status: string
  /** The content's own language: 'en' | 'es' | 'both'. */
  language: string
  /**
   * The locale this payload is **actually written in**. A Spanish-only survey
   * fetched with `?lang=en` comes back in Spanish and says `"es"` here.
   */
  resolvedLocale: string
  /** Field paths that fell back to the other language, e.g. `questions[0].text`. */
  fallbackFields: string[]
  startDate: string
  endDate: string
  responseCount: number
  targetAudienceCount: number | null
  version: number
  departmentIds: string[]
  questions: SurveyQuestion[]
  settings: SurveySettings
  /**
   * The statuses this survey may move to next, computed server-side.
   *
   * Drive the status controls from this and nothing else. Reimplementing
   * `SurveyStatuses.Transitions` in TypeScript is how a client comes to offer a
   * button the server rejects — and the matrix's interesting rules are its
   * *absences* (`active -> draft` and `closed -> active` are both illegal), which
   * a client-side copy is exactly the kind of thing to get wrong silently.
   */
  allowedStatusTransitions: string[]
  /** Whether title/description/questions/targeting may still be rewritten. Draft only. */
  isContentEditable: boolean
  createdAt: string
  updatedAt: string
}

/**
 * A row of `GET /surveys/my` — see `MySurveyListItem` in SurveyDtos.cs.
 *
 * Reduced on purpose. An employee's inbox needs to know what to open and by when;
 * the questions come from the respond endpoint, not from a listing.
 */
export interface MySurveyListItem {
  id: string
  title: string | null
  description: string | null
  type: string
  startDate: string
  endDate: string
  questionCount: number
  anonymous: boolean
  timeLimitMinutes: number | null
}

/** Server-side filters accepted by `GET /surveys`. */
export interface SurveyListFilters {
  /**
   * Super-admin only in practice: a company admin is scoped to their own company
   * regardless, and sending anyone else's id is a 403 rather than an empty list.
   */
  companyId?: string
  /** One of `SurveyStatuses.All`. An unknown value is a 400, not an empty list. */
  status?: string
  type?: string
  /** Free-text title match. */
  q?: string
}

function withQuery(baseUrl: string, path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }
  const query = search.toString()
  return query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`
}

/**
 * The administrable surveys.
 *
 * A super admin with no `companyId` filter gets **every** company's surveys — a
 * genuine cross-company view, like `/admin/benchmarks` and unlike `/action-plans`.
 * A company admin is scoped to their own company by the server whatever they send.
 *
 * Optional arguments come last, and both are optional: a prior bug in this repo put
 * a defaulted `baseUrl` ahead of the required arguments and broke five exports.
 */
export async function listSurveys(
  baseUrl: string,
  filters: SurveyListFilters = {},
  lang?: string,
): Promise<SurveyListItem[]> {
  const response = await authFetch(
    withQuery(baseUrl, '/surveys', {
      companyId: filters.companyId,
      status: filters.status,
      type: filters.type,
      q: filters.q,
      lang,
    }),
  )
  const body = (await response.json()) as { surveys: SurveyListItem[] }
  return body.surveys
}

/**
 * The surveys the caller is expected to answer.
 *
 * Role-agnostic by design: the endpoint resolves the caller's own user row and
 * filters by their company and department, so an employee gets a non-empty list and
 * a *global* super admin (whose `CompanyId` is NULL since #191) correctly gets an
 * empty one rather than an error.
 */
export async function listMySurveys(baseUrl: string, lang?: string): Promise<MySurveyListItem[]> {
  const response = await authFetch(withQuery(baseUrl, '/surveys/my', { lang }))
  const body = (await response.json()) as { surveys: MySurveyListItem[] }
  return body.surveys
}

export async function getSurvey(baseUrl: string, id: string, lang?: string): Promise<SurveyDetail> {
  const response = await authFetch(withQuery(baseUrl, `/surveys/${id}`, { lang }))
  return response.json() as Promise<SurveyDetail>
}

/**
 * Move a survey to `status`.
 *
 * Status is its own route and is absent from the update request on purpose:
 * publishing runs the content-i18n gate and freezes the survey's content, and an
 * update that could also publish is an update that publishes by accident.
 *
 * Two distinct refusals, and both arrive as a thrown `Error` carrying the server's
 * `message` (see `authFetch`):
 *
 * - An **illegal transition** is a **409**, and its body also carries `from`, `to`
 *   and `allowedTransitions`.
 * - A **failed publish gate** — a bilingual survey missing a translation, or a
 *   survey with no questions — is a **400**, and its body also carries
 *   `missingTranslations`.
 *
 * `authFetch` surfaces only `message`, which is the human-readable half and names
 * the offending field. Render it rather than pre-empting either rule here.
 */
export async function updateSurveyStatus(
  baseUrl: string,
  id: string,
  status: string,
  lang?: string,
): Promise<SurveyDetail> {
  const response = await authFetch(withQuery(baseUrl, `/surveys/${id}/status`, { lang }), {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
  return response.json() as Promise<SurveyDetail>
}

/**
 * Duplicate a survey into a fresh draft.
 *
 * This is the supported way to run a survey again: `closed -> active` is not a legal
 * transition, and the copy keeps every option's stable value so its answers still
 * aggregate with the original's. The server appends a per-locale copy suffix, so no
 * title is sent — passing one would mean inventing text in a language the caller
 * cannot know the survey was authored in.
 */
export async function duplicateSurvey(baseUrl: string, id: string, lang?: string): Promise<SurveyDetail> {
  const response = await authFetch(withQuery(baseUrl, `/surveys/${id}/duplicate`, { lang }), {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return response.json() as Promise<SurveyDetail>
}

/** `DELETE /surveys/{id}` answers 204, so there is no body to parse. */
export async function deleteSurvey(baseUrl: string, id: string): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${id}`, { method: 'DELETE' })
}
