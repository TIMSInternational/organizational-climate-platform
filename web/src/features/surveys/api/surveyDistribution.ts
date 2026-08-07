import { authFetch } from '../../../api/authFetch'

/**
 * The distribution and invitation surface from #116
 * (`src/ClimateProject.Api/Endpoints/SurveyDistributionEndpoints.cs`,
 * `src/ClimateProject.Application/Surveys/SurveyDistributionDtos.cs`).
 *
 * ## The one rule this module exists to keep
 *
 * **No shape here carries an invitation token, and no function returns one.** An
 * invitation token is a bearer credential for an unauthenticated route: whoever holds it
 * can open the survey *as that employee*. The backend deliberately omits it from every
 * admin read DTO, and this client mirrors that omission rather than typing a field it
 * hopes is absent — a token that never enters the type system cannot be rendered into a
 * table, pasted into an export, or read out of a screenshot.
 *
 * The share link (`publicLink`) is the deliberate exception, and it is a different thing:
 * it names no person, it is minted precisely so it can be handed out, and an admin who
 * cannot see it cannot use the feature. It is still a credential, so the UI masks it
 * until asked — see `ShareLinkPanel`.
 *
 * ## Reading vs writing
 *
 * Same asymmetry as `notifications.ts`, for the same reason: read shapes type `status`
 * and `accessType` as plain `string`, because a stored or imported row may carry a value
 * this list has not heard of and nothing that *reads* may reject one. Write shapes use
 * the unions.
 */

/**
 * The invitation state ladder, mirroring `SurveyInvitationStatuses.Progression`.
 * Ordered — `DistributionProgress` and the status filter both depend on the order, and
 * an out-of-order copy is how two representations of "further along" come to disagree.
 */
export const SURVEY_INVITATION_PROGRESSION = [
  'pending',
  'sent',
  'opened',
  'started',
  'completed',
] as const

export type SurveyInvitationProgressionStatus = (typeof SURVEY_INVITATION_PROGRESSION)[number]

/**
 * `revoked` is off the ladder on purpose: revocation is a decision, not progress. Derived
 * from the progression rather than written out again, so adding a rung above cannot leave
 * this list stale.
 */
export const SURVEY_INVITATION_STATUSES = [
  ...SURVEY_INVITATION_PROGRESSION,
  'revoked',
] as const

export type SurveyInvitationStatus = (typeof SURVEY_INVITATION_STATUSES)[number]

/** Mirrors `SurveyAccessTypes`. Two values, because two is what the columns can carry. */
export const SURVEY_ACCESS_TYPES = ['tokenized', 'public'] as const

export type SurveyAccessType = (typeof SURVEY_ACCESS_TYPES)[number]

/**
 * Whether a status string off the wire is one this build has a translation for.
 *
 * Read shapes type `status` as `string` on purpose (see the module comment), so a UI that
 * builds `t(\`…status.${status}\`)` straight from the payload would render the raw key
 * path for anything it has not heard of — which is exactly the #78 defect, where missing
 * keys showed Spanish users things like `surveys.distribution.status.foo`. Callers narrow
 * through this first and fall back to the raw value.
 */
export function isKnownInvitationStatus(status: string): status is SurveyInvitationStatus {
  return (SURVEY_INVITATION_STATUSES as readonly string[]).includes(status)
}

export interface SurveyAccessRules {
  requireLogin: boolean
  allowAnonymous: boolean
  singleResponse: boolean
  activeOutsideSchedule: boolean
  allowedDomains: string[] | null
  blockedIps: string[] | null
  maxResponses: number | null
}

export interface SurveyQrCustomization {
  foregroundColor: string
  backgroundColor: string
  logoUrl: string | null
  size: number
}

/**
 * The anonymity contract, shipped as data by the API rather than left to the client to
 * infer from `settings.anonymous`.
 *
 * `highestRecordableState` is the top of the ladder this survey may record. For an
 * anonymous survey it is `opened`, and `started`/`completed` are never written against an
 * individual — so a UI that renders "3 of 12 completed" from these counts would be
 * reporting structural zeroes as a completion rate. `suppressedStates` is what tells the
 * UI which buckets to stop treating as measurements.
 */
export interface SurveyAnonymityGuarantee {
  anonymous: boolean
  highestRecordableState: string
  suppressedStates: string[]
  guarantee: string
}

export interface SurveyInvitationSummary {
  total: number
  pending: number
  sent: number
  opened: number
  started: number
  completed: number
  revoked: number
  expired: number
}

export interface SurveyDistributionDetail {
  id: string
  surveyId: string
  accessType: string
  /** The share link, or null when none is minted. A bearer credential — mask before rendering. */
  publicLink: string | null
  qrCodeUrl: string
  accessRules: SurveyAccessRules
  qrCustomization: SurveyQrCustomization
  tokenizedLinksGenerated: number
  regeneratedCount: number
  lastRegeneratedAt: string | null
  totalAccesses: number
  uniqueVisitors: number
  lastAccessedAt: string | null
  invitations: SurveyInvitationSummary
  anonymity: SurveyAnonymityGuarantee
  createdAt: string
  updatedAt: string
}

/**
 * One invitation as an admin sees it.
 *
 * Note the absence of a token field — see the module comment. `startedAt` and
 * `completedAt` are `null` for every invitation to an anonymous survey, structurally and
 * not incidentally; read `anonymity.suppressedStates` before drawing a conclusion from
 * their absence.
 */
export interface SurveyInvitationDetail {
  id: string
  surveyId: string
  userId: string
  email: string
  status: string
  isExpired: boolean
  sentAt: string | null
  openedAt: string | null
  startedAt: string | null
  completedAt: string | null
  reminderCount: number
  lastReminderSent: string | null
  expiresAt: string
  createdAt: string
}

export interface SurveyInvitationList {
  invitations: SurveyInvitationDetail[]
  summary: SurveyInvitationSummary
  anonymity: SurveyAnonymityGuarantee
}

export interface SurveyInvitationBatchResult {
  requested: number
  created: number
  invitationIds: string[]
  skippedUserIds: string[]
  /** Rows added to `notifications`, **not** mails delivered. Delivery is the sweep's job. */
  notificationsQueued: number
  note: string | null
}

export interface SurveyReminderResult {
  eligible: number
  queued: number
  skippedTooSoon: number
  note: string | null
}

export interface SurveyAccessRulesInput {
  requireLogin?: boolean
  allowAnonymous?: boolean
  singleResponse?: boolean
  activeOutsideSchedule?: boolean
  allowedDomains?: string[]
  blockedIps?: string[]
  maxResponses?: number
}

export interface UpsertSurveyDistributionInput {
  accessType?: SurveyAccessType
  accessRules?: SurveyAccessRulesInput
}

/**
 * Exactly one selector, mirroring `ResolveAudienceAsync`: an empty request is refused by
 * the server rather than read as "everybody", because the failure mode of guessing wrong
 * is mailing an entire company.
 */
export type SurveyAudienceSelection =
  | { allTargeted: true }
  | { departmentIds: string[] }
  | { userIds: string[] }

export function getSurveyDistribution(
  baseUrl: string,
  surveyId: string,
): Promise<SurveyDistributionDetail> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/distribution`).then(
    (response) => response.json() as Promise<SurveyDistributionDetail>,
  )
}

export function updateSurveyDistribution(
  baseUrl: string,
  surveyId: string,
  input: UpsertSurveyDistributionInput,
): Promise<SurveyDistributionDetail> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/distribution`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }).then((response) => response.json() as Promise<SurveyDistributionDetail>)
}

/** Mints a new share link and kills the old one. Returns the distribution, link included. */
export function regenerateSurveyLink(
  baseUrl: string,
  surveyId: string,
): Promise<SurveyDistributionDetail> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/distribution/link/regenerate`, {
    method: 'POST',
  }).then((response) => response.json() as Promise<SurveyDistributionDetail>)
}

export function revokeSurveyLink(
  baseUrl: string,
  surveyId: string,
): Promise<SurveyDistributionDetail> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/distribution/link/revoke`, {
    method: 'POST',
  }).then((response) => response.json() as Promise<SurveyDistributionDetail>)
}

/** `options` last, with a default — a prior bug put an optional param before required ones. */
export function listSurveyInvitations(
  baseUrl: string,
  surveyId: string,
  options: { status?: SurveyInvitationStatus } = {},
): Promise<SurveyInvitationList> {
  const query = options.status ? `?status=${encodeURIComponent(options.status)}` : ''
  return authFetch(`${baseUrl}/surveys/${surveyId}/invitations${query}`).then(
    (response) => response.json() as Promise<SurveyInvitationList>,
  )
}

export function createSurveyInvitations(
  baseUrl: string,
  surveyId: string,
  audience: SurveyAudienceSelection,
): Promise<SurveyInvitationBatchResult> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(audience),
  }).then((response) => response.json() as Promise<SurveyInvitationBatchResult>)
}

export function sendSurveyReminders(
  baseUrl: string,
  surveyId: string,
): Promise<SurveyReminderResult> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/invitations/reminders`, {
    method: 'POST',
  }).then((response) => response.json() as Promise<SurveyReminderResult>)
}

export function resendSurveyInvitation(
  baseUrl: string,
  surveyId: string,
  invitationId: string,
): Promise<SurveyInvitationDetail> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/invitations/${invitationId}/resend`, {
    method: 'POST',
  }).then((response) => response.json() as Promise<SurveyInvitationDetail>)
}

export function revokeSurveyInvitation(
  baseUrl: string,
  surveyId: string,
  invitationId: string,
): Promise<SurveyInvitationDetail> {
  return authFetch(`${baseUrl}/surveys/${surveyId}/invitations/${invitationId}/revoke`, {
    method: 'POST',
  }).then((response) => response.json() as Promise<SurveyInvitationDetail>)
}

/**
 * Invitations that are out and not yet resolved: sent, opened, or started, minus anything
 * revoked or expired.
 *
 * Derived here rather than in each component, because "outstanding" is the number the
 * reminder button acts on and two definitions of it would let the page promise a
 * different count than the server acts on. Mirrors the `outstanding` array in
 * `SendRemindersAsync`, plus its `ExpiresAt > now` filter.
 */
export function outstandingInvitations(
  invitations: readonly SurveyInvitationDetail[],
): SurveyInvitationDetail[] {
  return invitations.filter(
    (invitation) =>
      !invitation.isExpired &&
      (invitation.status === 'sent' ||
        invitation.status === 'opened' ||
        invitation.status === 'started'),
  )
}

/**
 * True when this survey's tracking is capped below `state`, so a zero in that bucket is a
 * structural absence rather than a measurement.
 *
 * Reads `suppressedStates` off the payload instead of recomputing the ceiling from
 * `anonymous`: the server owns that rule (`SurveyInvitationStatuses.AnonymityCeiling`),
 * and a second copy here is a second place for it to be wrong.
 */
export function isSuppressedForAnonymity(
  anonymity: SurveyAnonymityGuarantee,
  state: string,
): boolean {
  return anonymity.suppressedStates.includes(state)
}
