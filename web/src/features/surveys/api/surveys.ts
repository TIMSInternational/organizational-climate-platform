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
  /**
   * Opt-in: the public link asks a respondent with no account about themselves -- their
   * area, their seniority -- before the first question. Defaults false, and deliberately
   * not derived from "public + anonymous + the company has fields", because all three are
   * already true of surveys collecting right now (`docs/decisions/self-declared-demographics.md`).
   *
   * It has NO EFFECT unless the survey is anonymous: `IsAnonymous` is taken from the
   * survey, never the request, so a named survey ignores the flag entirely.
   */
  selfDeclaredDemographics: boolean
  /**
   * The public link asks a respondent with no account for their name (required) and email
   * (optional) before the questions, so the company can see WHO has answered and who has
   * not -- never WHAT. On for every survey created since 2026-10-12, unless its author turned
   * it off. Stored in `survey_participations`, which holds no response id
   * (`docs/decisions/participation-is-not-linked-to-answers.md`).
   *
   * Optional in the type because an API that predates it does not send it.
   */
  collectParticipantIdentity?: boolean
  notificationSendInvitations: boolean
  notificationSendReminders: boolean
  notificationReminderFrequencyDays: number
  invitationCustomMessage: string | null
  invitationCustomSubject: string | null
  invitationIncludeCredentials: boolean
  invitationSendImmediately: boolean
  invitationBrandingEnabled: boolean
  /**
   * One session only: a respondent WITHOUT an account is served the form as it was first
   * served when they come back, instead of the half they left. Default false, so nothing
   * changes for a live survey until somebody ticks it (ruled 2026-10-13).
   *
   * Optional in the type because an API that predates it does not send it.
   */
  oneSessionOnly?: boolean
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
  /**
   * The licensed service this survey meters against, or `null` for none. Orthogonal to
   * `type` — see `LICENSED_SERVICES` in `surveyVocabulary.ts` (#496).
   */
  serviceType: string | null
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
  /**
   * People this survey is aimed at individually (#587) — the other half of the audience,
   * a UNION with `departmentIds` and not an alternative to it.
   *
   * Required, not optional: without it a screen reads an empty `departmentIds` and prints
   * "the whole company", which is the rule for a survey that targets NEITHER. A survey
   * aimed at 240 people by name reported 642 on every screen that showed it.
   */
  userIds: string[]
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
 * The distinct categories this company's survey questions have used -- the wizard's
 * dimension picker offers them beside the shipped vocabulary, so an admin re-uses
 * last quarter's spelling instead of minting a near-duplicate key. A company admin
 * is pinned to their own company by the server; `companyId` matters only for a
 * super admin authoring on a chosen company's behalf.
 */
export async function listSurveyDimensions(baseUrl: string, companyId?: string): Promise<string[]> {
  const response = await authFetch(withQuery(baseUrl, '/surveys/dimensions', { companyId }))
  const body = (await response.json()) as { dimensions: string[] }
  return body.dimensions
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

/**
 * Turns the public link's self-declared demographic questions on or off.
 *
 * `PUT /surveys/{id}` carrying ONLY this one setting, for `saveSurveyInvitationCopy`'s
 * reason: every field of the payload is nullable and an omitted one means "leave this
 * column alone", so a narrow body cannot blank a setting nobody touched.
 *
 * Why this is safe on a LIVE survey, measured rather than assumed
 * (`SurveyEndpoints.cs:524-535`):
 *
 * - It is NOT content. `touchesContent` lists title, description, type, language,
 *   questions, departmentIds and `settings.anonymous` -- and nothing else. So this does
 *   not hit the 409 that `anonymous` would, nor the stricter "already has responses"
 *   refusal behind it.
 * - It IS a schedule/settings edit, because `touchesSchedule` is true for ANY
 *   `settings` object at all. That gate is `AllowsScheduleEdit` == draft | scheduled |
 *   active, which is exactly `SETTINGS_EDITABLE_STATUSES` and therefore exactly
 *   `canDistribute` -- the predicate the page already disables its controls with. A
 *   closed survey refuses this with a 409, which is why the control is not offered there.
 *
 * The change lands in the survey's audit trail as `settings.selfDeclaredDemographics`
 * (`SurveyVersioning.Diff`), so turning it on mid-collection is attributable.
 */
export async function setSurveySelfDeclaredDemographics(
  baseUrl: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ settings: { selfDeclaredDemographics: enabled } }),
  })
}

/**
 * The same narrow `PUT` as the demographics switch, legal on a live survey for the same reason,
 * and attributable in the audit trail as `settings.oneSessionOnly` (`SurveyVersioning.Diff`).
 *
 * It ends RESUMING for a respondent with no account; it does not touch the session id, which is
 * the only retry and duplicate guard an anonymous survey has.
 */
export async function setSurveyOneSessionOnly(
  baseUrl: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ settings: { oneSessionOnly: enabled } }),
  })
}

/**
 * Turns "ask who is answering" on the public link on or off -- the same narrow
 * `PUT /surveys/{id}` as `setSurveySelfDeclaredDemographics`, for the same reasons: it is a
 * setting, not content, so it is legal on a live survey and lands in the audit trail as
 * `settings.collectParticipantIdentity`.
 */
export async function setSurveyCollectParticipantIdentity(
  baseUrl: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ settings: { collectParticipantIdentity: enabled } }),
  })
}

/** One person who said they answered. A day, never a time: the row holds no more. */
export interface SurveyParticipant {
  name: string
  email: string | null
  participatedOn: string
}

/** One of the company's active users with an email and no participation row yet. */
export interface SurveyPendingParticipant {
  name: string
  email: string
}

/**
 * `GET /surveys/{id}/participation` -- who has answered and who has not. Administrators only,
 * and there is nothing about answers, áreas or times in it to leak: the endpoint reads
 * `survey_participations` and the user list, and nothing else.
 */
export interface SurveyParticipationView {
  surveyId: string
  collectsParticipantIdentity: boolean
  answeredCount: number
  pendingCount: number
  answered: SurveyParticipant[]
  pending: SurveyPendingParticipant[]
  /** People who answered something and did not finish. */
  startedCount: number
  /** People with no response row at all for this survey. */
  notStartedCount: number
  roster: SurveyRosterRow[]
  /**
   * Whether a person's state on this survey can be known at all. False for an ANONYMOUS
   * survey, which writes no user id: every roster row then falls to `not_started` on absent
   * data, and showing that as participation would tell an administrator that 800 people had
   * not answered when the truth is that nobody is counted individually.
   */
  tracksIndividuals: boolean
  /**
   * Whether COMPLETION alone can be known, which on an anonymous survey it can.
   *
   * Completion lives in `survey_participations` — a name, an email and a calendar day, with
   * no response id, no session id and no timestamp — a separate table from the answers with
   * nothing to join them by. So an anonymous survey still answers "ya respondió sí o no"
   * while keeping the promise the respondent was given: we record THAT you answered, never
   * WHAT you answered. When this is true and `tracksIndividuals` is false the roster carries
   * two states, `completed` and `not_completed`, and not three.
   */
  tracksCompletionOnly: boolean
  /**
   * How this survey's people sign in, frozen on the survey when it was created. `per_survey`
   * means one key per person per survey: the account has no username, the person signs in with
   * `surveyUsername`, and the key is reissued per row rather than by the account resend.
   * Optional because a payload from before 2026-10-22 lacks it; absent reads as `shared`,
   * which is what every survey was before the mode existed.
   */
  credentialMode?: SurveyCredentialMode
  /** The survey's title, so a confirmation can name it. Either may be null on a one-language survey. */
  surveyTitleEn?: string | null
  surveyTitleEs?: string | null
}

export type SurveyCredentialMode = 'shared' | 'per_survey'

/**
 * Where ONE invited person stands on this survey.
 *
 * Three states and not two. "Pendiente" used to mean both "never opened it" and "answered
 * half and was interrupted", and those call for opposite actions -- the first person needs
 * their sign-in details again, the second already has them.
 */
export type SurveyParticipantStatus = 'completed' | 'started' | 'not_started' | 'not_completed'

/** One demographic as the import uploaded it. */
export interface SurveyRosterDemographic {
  field: string
  labelEn: string | null
  labelEs: string | null
  value: string
}

export interface SurveyRosterRow {
  userId: string
  name: string
  email: string
  /**
   * The generated sign-in name a mass invite gave this account, null for anyone who chose
   * their own password. The password is discarded after hashing, so this is the only half of
   * their credentials an administrator can read back on the phone.
   */
  username: string | null
  role: string
  status: SurveyParticipantStatus
  /** A calendar day, never an instant (ruled 2026-10-12). */
  lastActivityOn: string | null
  demographics: SurveyRosterDemographic[]
  /**
   * This person's key for THIS survey, on a `per_survey` survey only: the username it signs in
   * with, the day it was mailed and the day it was last used — company-zone days, never
   * instants. All three null for somebody who holds no key, and always null on a shared survey.
   * Optional for the same reason as `credentialMode`; absent reads as null.
   */
  surveyUsername?: string | null
  credentialIssuedOn?: string | null
  lastSignInOn?: string | null
}

export async function getSurveyParticipation(baseUrl: string, id: string): Promise<SurveyParticipationView> {
  const response = await authFetch(`${baseUrl}/surveys/${id}/participation`)
  return response.json() as Promise<SurveyParticipationView>
}

/** Why `POST /surveys/{id}/credentials/{userId}/reissue` refused, as the API names it. */
export type SurveyCredentialReissueRefusal =
  | 'not_per_survey'
  | 'survey_not_open'
  | 'user_not_found'
  | 'user_inactive'
  | 'not_in_audience'
  | 'no_credential'
  | 'already_signed_in'

export type SurveyCredentialReissueOutcome =
  /** A new password was mailed; the old one stopped working. `issuedOn` is today, company zone. */
  | { kind: 'sent'; issuedOn: string }
  /** The mail did not leave, so the server put the OLD key back: it still works. */
  | { kind: 'send_failed' }
  | { kind: 'refused'; code: SurveyCredentialReissueRefusal | 'unknown' }

/**
 * Sends ONE person a new password for ONE survey's key. The refusals (404/409) come back as
 * a value with their code, not as a thrown English sentence, so the roster can say them in
 * Spanish; `delivered: false` is a 200 because the server restored the old key.
 */
export async function reissueSurveyCredential(
  baseUrl: string,
  surveyId: string,
  userId: string,
): Promise<SurveyCredentialReissueOutcome> {
  const response = await authFetch(
    `${baseUrl}/surveys/${surveyId}/credentials/${userId}/reissue`,
    { method: 'POST' },
    { allowStatus: [404, 409] },
  )
  const body = (await response.json().catch(() => null)) as
    | { delivered?: boolean; issuedOn?: string; code?: string }
    | null
  if (!response.ok) {
    return { kind: 'refused', code: (body?.code as SurveyCredentialReissueRefusal | undefined) ?? 'unknown' }
  }
  return body?.delivered && body.issuedOn ? { kind: 'sent', issuedOn: body.issuedOn } : { kind: 'send_failed' }
}

/** Why `DELETE /surveys/{id}/credentials/{userId}` refused, as the API names it. */
export type SurveyCredentialRevokeRefusal =
  | 'not_per_survey'
  | 'user_not_found'
  | 'no_credential'
  | 'has_responses'

export type SurveyCredentialRevokeOutcome =
  /**
   * The key is gone and no longer opens the survey. `hadSignedIn` is not a failure -- it is a
   * warning to pass on: sessions are stamped per PERSON, not per key, so somebody who had
   * already signed in with this one may keep the survey open until that session expires.
   */
  | { kind: 'revoked'; hadSignedIn: boolean }
  | { kind: 'refused'; code: SurveyCredentialRevokeRefusal | 'unknown' }

/**
 * Withdraws ONE person's key for ONE survey -- the repair for a code that should never have
 * been sent (ten ESPH people were mailed a Clima key by mistake on 2026-10-28).
 *
 * The server's rules, read from `SurveyCredentialEndpoints.RevokeAsync` rather than restated:
 *
 * - it refuses somebody who has already answered, in whole or in part (`has_responses`):
 *   withdrawing the key does not withdraw the response, and what happens to a response that
 *   should not exist is a results decision;
 * - it does NOT refuse a key that has been used -- being locked out is the point here, which
 *   is the one place it differs from `reissueSurveyCredential`;
 * - it leaves the account, the audience and the invitation row alone, so the person keeps
 *   signing in to their OTHER surveys with those keys;
 * - any survey status is allowed, because a mis-send is often noticed after the close.
 *
 * Refusals (404/409) come back as a value carrying their code, not a thrown English sentence,
 * so the roster can say them in Spanish.
 */
export async function revokeSurveyCredential(
  baseUrl: string,
  surveyId: string,
  userId: string,
): Promise<SurveyCredentialRevokeOutcome> {
  const response = await authFetch(
    `${baseUrl}/surveys/${surveyId}/credentials/${userId}`,
    { method: 'DELETE' },
    { allowStatus: [404, 409] },
  )
  const body = (await response.json().catch(() => null)) as
    | { hadSignedIn?: boolean; code?: string }
    | null
  if (!response.ok) {
    return { kind: 'refused', code: (body?.code as SurveyCredentialRevokeRefusal | undefined) ?? 'unknown' }
  }
  return { kind: 'revoked', hadSignedIn: body?.hadSignedIn === true }
}

/**
 * Moves a survey's response window: `PUT /surveys/{id}` carrying only the two instants, so no
 * other column is touched (every field of the payload is nullable and an omitted one is left
 * alone).
 *
 * The server's rules, read from `SurveyEndpoints.UpdateAsync` rather than restated:
 *
 * - draft, scheduled and active only (`SurveyStatuses.AllowsScheduleEdit`); closed or archived
 *   is a **409**;
 * - an ACTIVE survey's start is a fact -- a different `startDate` is a **409** -- so for one the
 *   caller sends `endDate` alone;
 * - `startDate >= endDate` is a **400**.
 *
 * The instants are sent as ISO strings in UTC; the caller turns the company's wall clock into
 * them (`zonedWindow.ts`). Respondents read the new close at once -- on a live survey this is the
 * point.
 */
export async function updateSurveyWindow(
  baseUrl: string,
  id: string,
  window: { startDate?: string; endDate: string },
  lang?: string,
): Promise<SurveyDetail> {
  const response = await authFetch(withQuery(baseUrl, `/surveys/${id}`, { lang }), {
    method: 'PUT',
    body: JSON.stringify(window.startDate === undefined ? { endDate: window.endDate } : window),
  })
  return response.json() as Promise<SurveyDetail>
}

/**
 * `DELETE /surveys/{id}` answers 204, so there is no body to parse.
 *
 * The server deletes a survey in ANY status as long as nobody has answered it
 * (`DeleteSurveyAsync`: the response counter and the responses table are both checked), and
 * answers **409** otherwise -- archiving is what keeps the answers. Questions, targets, the
 * link, invitations and per-survey codes go with it (cascades).
 */
export async function deleteSurvey(baseUrl: string, id: string): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${id}`, { method: 'DELETE' })
}
