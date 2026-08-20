import type { SurveyAnonymityGuarantee } from './surveyDistribution'

/**
 * The two links this product actually hands to a human, from the respondent's side of
 * them (`src/ClimateProject.Api/Endpoints/SurveyDistributionEndpoints.cs`).
 *
 * `GET /survey-links/{token}` resolves the open share link stored in
 * `survey_distributions.public_url`; `GET /survey-invitations/{token}` resolves one
 * invitee's personal token, and the three `POST` routes beside it record their
 * progress. All five existed with no caller at all: the API minted `/s/{token}` and
 * mailed `/survey-invitations/{token}` while the web app routed neither, so every link
 * this product distributes resolved to the 404 boundary.
 *
 * ## Why this is `fetch` and not `authFetch`, and why it sends no bearer at all
 *
 * Two reasons, and the second is stronger than the one `surveyResponses.ts` gives.
 *
 * **`authFetch` would break the page.** It clears the stored token and sets
 * `window.location.href = '/login'` on any 401, which on these routes would yank a
 * respondent who has no account off the page before an error could render.
 *
 * **And a bearer token would be a credential sent for nothing.** Checked against the
 * handlers rather than assumed: `ResolvePublicLinkAsync`, `ValidateInvitationTokenAsync`
 * and `RecordStateAsync` take no `ClaimsPrincipal` and the group carries no
 * `RequireAuthorization()` — the token in the path IS the credential, and the server
 * cannot see an `Authorization` header on these routes even if one arrives. So unlike
 * `surveyResponses.ts`, which forwards a token because the same endpoint also serves an
 * authenticated respondent, this module attaches none: handing a second credential to a
 * route that ignores it is a leak with no upside. An administrator checking a share
 * link from the browser they administer in is the routine case.
 */

/**
 * What the holder of a public share link is shown, mirroring `SurveyPublicLinkDetail`.
 *
 * `surveyId` is the whole reason this call exists — the token is opaque and only the
 * server can turn it into the id the respond flow needs. The localized title and
 * description come along and are deliberately *not* rendered by `/s/:token`: the
 * respond payload carries its own, resolved for the locale the respondent picked, and
 * a page that rendered these would have to re-resolve the link on every language
 * switch — which on this endpoint means incrementing `total_accesses` again and
 * reporting one visitor as several.
 */
export interface SurveyPublicLinkDetail {
  surveyId: string
  surveyTitle: string | null
  surveyDescription: string | null
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  surveyStartDate: string
  surveyEndDate: string
  requireLogin: boolean
  allowAnonymous: boolean
  singleResponse: boolean
}

/**
 * What the holder of an invitation token is shown, mirroring
 * `SurveyInvitationTokenDetail`.
 *
 * Note what is absent: the invitee's email address. The server does not echo it, so a
 * leaked token discloses the survey and not the person — and this type not naming the
 * field is what stops a future landing page greeting somebody by an address it would
 * have had to be handed first.
 */
export interface SurveyInvitationTokenDetail {
  invitationId: string
  surveyId: string
  surveyTitle: string | null
  surveyDescription: string | null
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  status: string
  surveyStartDate: string
  surveyEndDate: string
  expiresAt: string
  anonymity: SurveyAnonymityGuarantee
}

/**
 * The rungs of `SurveyInvitationStatuses.Progression` a respondent's own client can
 * report. `pending` and `sent` are the sender's business and `revoked` is an admin's,
 * so none of the three has a route.
 */
export const SURVEY_INVITATION_STEPS = ['opened', 'started', 'completed'] as const

export type SurveyInvitationStep = (typeof SURVEY_INVITATION_STEPS)[number]

/**
 * The outcome of recording a step, mirroring `SurveyInvitationStateResult`.
 *
 * `recorded: false` is a normal answer and arrives with 200, in two cases the server
 * keeps distinct: the step was not forward progress (a replayed ping), or the survey is
 * anonymous and the step is past `SurveyInvitationStatuses.AnonymityCeiling`, which is
 * `opened`. Nothing in this app renders any of it — it is telemetry about an invitation,
 * not information the respondent asked for — but it is typed rather than dropped,
 * because a client that treated a suppressed write as a successful one is exactly the
 * lie the field exists to prevent.
 */
export interface SurveyInvitationStateResult {
  invitationId: string
  status: string
  recorded: boolean
  suppressedForAnonymity: boolean
  reason: string | null
  anonymity: SurveyAnonymityGuarantee
}

/**
 * A failed link request, carrying the server's machine-readable `reason` alongside the
 * status.
 *
 * The status alone is not enough here, which is why this is not
 * `SurveyRespondError`. `GET /survey-invitations/{token}` answers **410 for both a
 * revoked invitation and an expired one** and separates them only by `reason` —
 * and the server goes out of its way to keep them apart (`LoadByTokenAsync` checks
 * revoked *before* expiry precisely so an admin's deliberate act is not reported as
 * the passage of time). Collapsing them in the client would throw that away.
 *
 * `reason` is `null` for a response that carries none, which includes every
 * `/survey-links/{token}` failure: that route answers one deliberately undifferentiated
 * 404 for unknown, revoked and out-of-window, because a share link is held by anyone at
 * all and "this link existed but was revoked" confirms a tenant's survey exists to
 * someone who should learn nothing from a dead URL.
 */
export class SurveyLinkError extends Error {
  readonly status: number

  readonly reason: string | null

  constructor(status: number, message: string, reason: string | null) {
    super(message)
    this.name = 'SurveyLinkError'
    this.status = status
    this.reason = reason
  }
}

function stringField(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null
  const value = (body as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

async function fail(response: Response): Promise<never> {
  // A rate-limited request (`RateLimitPolicies.PublicToken` on the invitation routes,
  // `PublicLink` on the share link) is rejected by middleware and need not be JSON at
  // all, so neither field is assumed present.
  const body: unknown = await response.json().catch(() => null)
  throw new SurveyLinkError(
    response.status,
    stringField(body, 'message') ?? '',
    stringField(body, 'reason'),
  )
}

/**
 * Turns a share token into the survey it opens.
 *
 * `encodeURIComponent` because this token comes straight out of the URL bar and is not
 * yet known to be one of ours: a real token is 43 base64url characters and needs no
 * escaping, and anything else is a caller-supplied path segment that must not be able
 * to add segments of its own.
 *
 * No `lang` parameter, deliberately — see `SurveyPublicLinkDetail`. This call is a
 * token lookup, and it is also the one that increments `total_accesses`, so it is made
 * exactly once per visit.
 */
export async function resolveSurveyPublicLink(
  baseUrl: string,
  token: string,
): Promise<SurveyPublicLinkDetail> {
  const response = await fetch(`${baseUrl}/survey-links/${encodeURIComponent(token)}`)
  if (!response.ok) return fail(response)
  return response.json() as Promise<SurveyPublicLinkDetail>
}

/**
 * Resolves one invitee's token.
 *
 * `lang` is sent, unlike the share link above: this page renders the survey's own title
 * and description on a landing card before the respond form loads, and letting the
 * server default the locale resolves against the *survey's* language rather than the
 * *reader's*. Re-reading on a language switch is free here — the invitation routes
 * increment no counter.
 */
export async function getSurveyInvitation(
  baseUrl: string,
  token: string,
  options: { lang?: string } = {},
): Promise<SurveyInvitationTokenDetail> {
  const query = options.lang ? `?lang=${encodeURIComponent(options.lang)}` : ''
  const response = await fetch(`${baseUrl}/survey-invitations/${encodeURIComponent(token)}${query}`)
  if (!response.ok) return fail(response)
  return response.json() as Promise<SurveyInvitationTokenDetail>
}

/**
 * Records one step on the invitation ladder.
 *
 * The step is sent whatever the survey's anonymity says, which is the server's own
 * instruction rather than an oversight: `SurveyInvitationStatuses` states that the
 * later states "are accepted by the API (the respondent's client should not have to
 * branch on anonymity) and deliberately not persisted". Suppression is enforced in one
 * place, server-side, and a client that decided for itself would be a second
 * implementation of the anonymity boundary — the shape of drift this product cannot
 * afford.
 */
export async function recordSurveyInvitationStep(
  baseUrl: string,
  token: string,
  step: SurveyInvitationStep,
): Promise<SurveyInvitationStateResult> {
  const response = await fetch(
    `${baseUrl}/survey-invitations/${encodeURIComponent(token)}/${step}`,
    { method: 'POST' },
  )
  if (!response.ok) return fail(response)
  return response.json() as Promise<SurveyInvitationStateResult>
}
