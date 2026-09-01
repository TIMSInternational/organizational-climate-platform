/**
 * The microclimate invitation link, from the invitee's side of it
 * (`src/ClimateProject.Api/Endpoints/MicroclimateInvitationEndpoints.cs`).
 *
 * `GET /microclimate-invitations/{token}` resolves one invitee's personal token and the
 * three `POST` routes beside it record their progress. This is #130's half of the pair
 * `surveys/api/surveyLinks.ts` already covers, and it is a separate module rather than a
 * second export there for the reason the backend keeps two of everything: the two surfaces
 * read two different tables, and a call that reached the wrong one would resolve nothing,
 * throw nothing, and leave a respondent looking at a "link not valid" page for a link that
 * is perfectly valid.
 *
 * ## Why this is `fetch` and not `authFetch`, and why it sends no bearer at all
 *
 * Two reasons, and the second is the stronger one.
 *
 * **`authFetch` would break the page.** It clears the stored token and sets
 * `window.location.href = '/login'` on any 401, which on these routes would yank a
 * respondent who has no account off the page before an error could render.
 *
 * **And a bearer token would be a credential sent for nothing.** Checked against the
 * handlers rather than assumed: `ValidateInvitationTokenAsync` and `RecordStateAsync` take
 * no `ClaimsPrincipal` and the group carries no `RequireAuthorization()` — the token in the
 * path IS the credential, and the server cannot see an `Authorization` header on these
 * routes even if one arrives. Handing a second credential to a route that ignores it is a
 * leak with no upside.
 */

/**
 * The anonymity contract, mirroring `MicroclimateAnonymityGuaranteeDto`.
 *
 * Structurally identical to the survey one and deliberately its own type: they are served
 * by different endpoints about different rows, and a shared alias would make it possible to
 * pass one where the other was meant without the compiler minding.
 */
export interface MicroclimateAnonymityGuarantee {
  anonymous: boolean
  highestRecordableState: string
  suppressedStates: string[]
  guarantee: string
}

/**
 * What the holder of an invitation token is shown, mirroring
 * `MicroclimateInvitationTokenDetail`.
 *
 * Note what is absent: the invitee's email address, the company, the author, the running
 * response count. The server does not echo any of them, so a leaked token discloses the
 * session and not the person — and this type not naming the fields is what stops a future
 * landing page greeting somebody by an address it would have had to be handed first.
 */
export interface MicroclimateInvitationTokenDetail {
  invitationId: string
  microclimateId: string
  microclimateTitle: string | null
  microclimateDescription: string | null
  language: string
  resolvedLocale: string
  fallbackFields: string[]
  /** The invitation's own rung on the ladder — `pending`, `sent`, `opened`, … */
  status: string
  /** The session's lifecycle status: `draft`, `active` or `closed`. */
  microclimateStatus: string
  startTime: string
  endTime: string
  expiresAt: string
  anonymity: MicroclimateAnonymityGuarantee
}

/**
 * The rungs of the ladder a respondent's own client can report. `pending` and `sent` are
 * the sender's business and `revoked` is an admin's, so none of the three has a route.
 *
 * `participated` is not here either. It exists as a route — the legacy verb, mapped onto
 * the same handler — but it writes `completed` and this client has no reason to prefer the
 * older spelling of the word.
 */
export const MICROCLIMATE_INVITATION_STEPS = ['opened', 'started', 'completed'] as const

export type MicroclimateInvitationStep = (typeof MICROCLIMATE_INVITATION_STEPS)[number]

/**
 * The outcome of recording a step, mirroring `MicroclimateInvitationStateResult`.
 *
 * `recorded: false` is a normal answer and arrives with 200, in two cases the server keeps
 * distinct: the step was not forward progress (a replayed ping), or the microclimate is
 * anonymous and the step is past `MicroclimateInvitationStatuses.AnonymityCeiling`, which is
 * `opened`. Nothing in this app renders any of it — it is telemetry about an invitation, not
 * information the respondent asked for — but it is typed rather than dropped, because a
 * client that treated a suppressed write as a successful one is exactly the lie the field
 * exists to prevent.
 */
export interface MicroclimateInvitationStateResult {
  invitationId: string
  status: string
  recorded: boolean
  suppressedForAnonymity: boolean
  reason: string | null
  anonymity: MicroclimateAnonymityGuarantee
}

/**
 * A failed link request, carrying the server's machine-readable `reason` alongside the
 * status.
 *
 * The status alone is not enough. `GET /microclimate-invitations/{token}` answers **410 for
 * both a revoked invitation and an expired one** and separates them only by `reason` — and
 * the server goes out of its way to keep them apart (`LoadByTokenAsync` checks revoked
 * *before* expiry precisely so an admin's deliberate act is not reported as the passage of
 * time). Collapsing them in the client would throw that away.
 */
export class MicroclimateLinkError extends Error {
  readonly status: number

  readonly reason: string | null

  constructor(status: number, message: string, reason: string | null) {
    super(message)
    this.name = 'MicroclimateLinkError'
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
  // A rate-limited request (`RateLimitPolicies.PublicToken` on these routes) is rejected by
  // middleware and need not be JSON at all, so neither field is assumed present.
  const body: unknown = await response.json().catch(() => null)
  throw new MicroclimateLinkError(
    response.status,
    stringField(body, 'message') ?? '',
    stringField(body, 'reason'),
  )
}

/**
 * Resolves one invitee's token.
 *
 * `encodeURIComponent` because this token comes straight out of the URL bar and is not yet
 * known to be one of ours: a real token is 43 base64url characters and needs no escaping,
 * and anything else is a caller-supplied path segment that must not be able to add segments
 * of its own.
 *
 * `lang` is sent because the landing card renders the session's own title and description,
 * and letting the server default the locale resolves against the *microclimate's* language
 * rather than the *reader's*. Re-reading on a language switch is free here — unlike the
 * survey share link, these routes increment no counter.
 */
export async function getMicroclimateInvitation(
  baseUrl: string,
  token: string,
  options: { lang?: string } = {},
): Promise<MicroclimateInvitationTokenDetail> {
  const query = options.lang ? `?lang=${encodeURIComponent(options.lang)}` : ''
  const response = await fetch(
    `${baseUrl}/microclimate-invitations/${encodeURIComponent(token)}${query}`,
  )
  if (!response.ok) return fail(response)
  return response.json() as Promise<MicroclimateInvitationTokenDetail>
}

/**
 * Records one step on the invitation ladder.
 *
 * The step is sent whatever the session's anonymity says, which is the server's own
 * instruction rather than an oversight: `MicroclimateInvitationStatuses` states that the
 * later states are accepted by the API — the respondent's client should not have to branch
 * on anonymity — and deliberately not persisted. Suppression is enforced in one place,
 * server-side, and a client that decided for itself would be a second implementation of the
 * anonymity boundary, which is the shape of drift this product cannot afford.
 */
export async function recordMicroclimateInvitationStep(
  baseUrl: string,
  token: string,
  step: MicroclimateInvitationStep,
): Promise<MicroclimateInvitationStateResult> {
  const response = await fetch(
    `${baseUrl}/microclimate-invitations/${encodeURIComponent(token)}/${step}`,
    { method: 'POST' },
  )
  if (!response.ok) return fail(response)
  return response.json() as Promise<MicroclimateInvitationStateResult>
}
