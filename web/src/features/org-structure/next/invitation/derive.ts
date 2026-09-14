/**
 * Which sentence a refused `POST /invitations/{token}/accept` earns, and whether the form
 * survives it.
 *
 * ## The artboard asked for exactly this
 *
 * AcceptInvitation (10 Sep) draws three refusals beside the form — caducada, ya usada, no
 * encontrada — and says what is wrong with them today in its own words: "Hoy estas tres
 * llegan como la frase del servidor en inglés («Invitation has expired»). La propuesta:
 * frases del catálogo, en el idioma de la persona, **en lugar del formulario**." Both
 * halves matter. A Spanish-speaking invitee met an English sentence, and they met it above
 * a form that could never succeed no matter what they typed into it.
 *
 * ## Why the match is on the server's sentence and not on the status
 *
 * Because the status does not separate the cases. `InvitationAcceptEndpoints.AcceptAsync`
 * answers **400** for an expired invitation *and* for a password that misses the policy
 * *and* for an email on the wrong domain; it answers **409** for an invitation already
 * accepted *and* for an address that already has a user. A status-keyed table would
 * therefore tell somebody whose password was four characters short that their invitation
 * had expired, and strand them.
 *
 * The endpoint carries no machine-readable `reason` — unlike the microclimate link routes,
 * which do, and whose client keys on it (`microclimateLinkFailure.ts`). So the sentence is
 * the only signal there is, and it is matched **exactly**, against literals quoted from
 * that file. This is a coupling and it is written down as one: if the server rewords a
 * message, this table stops recognising it and the branch falls back to UNRESOLVED, which
 * is the behaviour the page had before this module existed. It degrades to the old screen
 * rather than to a wrong one.
 *
 * ## Fail-closed means keeping the form, not replacing it
 *
 * `terminal: true` takes the form away. That is right for a dead invitation and wrong for
 * anything the invitee can fix, so the default is `terminal: false`: an unrecognised
 * refusal leaves the form standing with the server's own words above it. The failure that
 * would cost somebody their account is replacing a correctable refusal with a dead end,
 * and the default is chosen so that mistake cannot be made by omission.
 *
 * Nothing on any branch names a company, an inviter or a role: the accept endpoint echoes
 * none of them, and a page that cannot read the invitation must not appear to have.
 */

export type AcceptFailureKind =
  | 'expired'
  | 'used'
  | 'notFound'
  | 'accountExists'
  | 'inactive'
  | 'unresolved'

export interface AcceptInvitationFailure {
  kind: AcceptFailureKind
  /**
   * True when nothing the person can type will succeed, so the sentence replaces the form
   * rather than sitting above it.
   */
  terminal: boolean
  /** A key in the `auth` namespace, or `null` on the unresolved branch. */
  titleKey: string | null
  /**
   * A key in the `auth` namespace, or `null` meaning "we have no better sentence than the
   * server's own" — the caller then shows the thrown `Error.message`.
   */
  bodyKey: string | null
  /** Whether the way out of this state is the sign-in page. */
  offerSignIn: boolean
}

/**
 * The branch for a refusal this client has no specific copy for: every 400 about the
 * password or the email, a 429 from `RateLimitPolicies.PublicToken`, a 5xx, or a network
 * failure. The form stays, and the server's message is shown above it — which is exactly
 * what this page did for every refusal before the redesign.
 */
const UNRESOLVED: AcceptInvitationFailure = {
  kind: 'unresolved',
  terminal: false,
  titleKey: null,
  bodyKey: null,
  offerSignIn: false,
}

/**
 * The five refusals that end the invitation, keyed by the exact sentence the endpoint
 * sends.
 *
 * `serverText` and not `message`: `i18n/noHardcodedStrings.test.ts` reads a property named
 * `message` as copy, and these are protocol — matched on, never rendered. The same
 * reasoning `features/dashboard/api/dashboard.ts` records for the two strings it compares
 * against.
 */
const TERMINAL: readonly { serverText: string; failure: AcceptInvitationFailure }[] = [
  {
    // `Results.Json(new { message = "Invitation not found" }, statusCode: 404)`
    serverText: 'Invitation not found',
    failure: {
      kind: 'notFound',
      terminal: true,
      titleKey: 'next.accept.notFoundTitle',
      bodyKey: 'next.accept.notFoundBody',
      offerSignIn: false,
    },
  },
  {
    // `… "Invitation has already been accepted" …, statusCode: 409`
    serverText: 'Invitation has already been accepted',
    failure: {
      kind: 'used',
      terminal: true,
      titleKey: 'next.accept.usedTitle',
      bodyKey: 'next.accept.usedBody',
      offerSignIn: true,
    },
  },
  {
    // `… "Invitation has expired" …, statusCode: 400`
    serverText: 'Invitation has expired',
    failure: {
      kind: 'expired',
      terminal: true,
      titleKey: 'next.accept.expiredTitle',
      bodyKey: 'next.accept.expiredBody',
      offerSignIn: false,
    },
  },
  {
    // `… "A user with this email already exists" …, statusCode: 409`. A different case
    // from `used`: the invitation may still be pending, but this address already has an
    // account, and re-submitting cannot change that. Saying "esta invitación ya se usó"
    // here would be a lie, so it has a sentence of its own.
    serverText: 'A user with this email already exists',
    failure: {
      kind: 'accountExists',
      terminal: true,
      titleKey: 'next.accept.accountExistsTitle',
      bodyKey: 'next.accept.accountExistsBody',
      offerSignIn: true,
    },
  },
  {
    // `AuthEndpoints.IssueTokenForAsync`'s refusal, passed through by this endpoint:
    // `Results.Json(new { message = "Account is not active" }, statusCode: 401)`. The
    // account row exists by then, so there is nothing to resubmit. Reuses the sentences
    // `/auth/inactive` already says.
    serverText: 'Account is not active',
    failure: {
      kind: 'inactive',
      terminal: true,
      titleKey: 'accountInactiveTitle',
      bodyKey: 'accountInactiveDetail',
      offerSignIn: false,
    },
  },
]

/**
 * Copy for a failed acceptance.
 *
 * @param serverMessage the message the rejection carried. `acceptInvitation` synthesises
 * `Request failed: {status}` when the body had none, which matches nothing here and so
 * reaches the unresolved branch — correctly, because a bodiless 500 is not a dead
 * invitation.
 */
export function acceptInvitationFailure(serverMessage: string): AcceptInvitationFailure {
  const hit = TERMINAL.find((entry) => entry.serverText === serverMessage)
  return hit ? hit.failure : UNRESOLVED
}

/** Every key `acceptInvitationFailure` can hand a translator, for the catalogue assertion. */
export const ACCEPT_FAILURE_KEYS: readonly string[] = TERMINAL.flatMap((entry) =>
  [entry.failure.titleKey, entry.failure.bodyKey].filter((key): key is string => key !== null),
)
