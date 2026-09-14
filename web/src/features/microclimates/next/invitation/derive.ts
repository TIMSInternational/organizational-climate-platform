import type {
  MicroclimateLinkError,
  MicroclimateInvitationTokenDetail,
} from '../../api/microclimateLinks'

/**
 * The pure rules behind the redesigned `/microclimate-invitations/:token`
 * (the MicroclimateInvitation and MicroclimateInvitationStates artboards, 10 Sep).
 *
 * The states artboard draws a catalogue of six cards on one page; in the product each of
 * them IS the page, drawn **in place of the invitation** — its own words: "Una frase por
 * caso, en el lugar de la invitación". So the whole screen is one of seven views, and
 * which one is decided here rather than in the render, for the reason
 * `microclimateLinkFailure.ts` gives for its own mapping: every branch has a different
 * next step for the person holding the link, all of them reach the page as either a
 * rejected promise or a flag on one payload, and a `switch` buried in JSX is the easiest
 * place in the world to lose one.
 *
 * ## Order is the fail-closed rule, not a style choice
 *
 * A dead token is settled first and from the error alone: nothing about the session is
 * read, drawn or even in scope on that branch, so a link that is unknown, expired,
 * revoked or already answered cannot put a pulse's title, description or dates on an
 * anonymous page. Only a token the server actually resolved reaches the branches that
 * name the session.
 *
 * Then `closed` before `signIn`: a pulse that has stopped taking answers cannot be
 * answered by signing in either, and telling somebody to fetch their password for a
 * session that ended on Tuesday is a worse sentence than the one that says it ended.
 */

/** A token the server refused, in the vocabulary the states artboard labels its cards in. */
export type DeadKind = 'notFound' | 'revoked' | 'expired' | 'used' | 'unknown'

/** The whole screen: the landing card, or one of the six states drawn in its place. */
export type InvitationView =
  | { kind: 'loading' }
  | { kind: 'landing'; detail: MicroclimateInvitationTokenDetail }
  /** The token resolved, but the session has stopped taking answers. */
  | { kind: 'closed'; closesAt: string }
  /** An identified pulse reached by a browser holding no session at all. */
  | { kind: 'signIn' }
  | { kind: 'dead'; dead: DeadKind; serverMessage: string | null }

/** What the page knows about its token: the three outcomes of one `GET`. */
export type ResolveState =
  | { status: 'loading' }
  | { status: 'resolved'; detail: MicroclimateInvitationTokenDetail }
  | { status: 'dead'; error: MicroclimateLinkError | null }

/**
 * The server's `reason` vocabulary, mapped onto the states artboard's cards.
 *
 * Deliberately the same table `microclimateLinkFailure.ts` keeps, and deliberately a
 * second copy of it rather than an import: that module answers a *copy* question (which
 * key, which tone) against the older wording, and this one answers a *view* question.
 * Mapping one onto the other would mean matching on its returned key strings, which is
 * the one coupling neither `keysExist` nor `catalogues` can check.
 *
 * A map rather than a chain of `if`s, so a reason this build has not heard of falls
 * through to the status rule instead of matching the nearest-looking case — a client
 * guessing at a reason it does not recognise is how "revoked" comes to be reported as
 * "expired".
 */
const KIND_BY_REASON: Readonly<Record<string, DeadKind>> = {
  not_found: 'notFound',
  revoked: 'revoked',
  expired: 'expired',
  // Not a failure the respondent should be made to feel bad about: their answers are in.
  // Only ever reachable on a non-anonymous session — an anonymous one never records
  // `completed`, so its invitees can re-open their link, which is the cost of the
  // guarantee and is correct.
  already_completed: 'used',
}

/**
 * Which card a refused token earns.
 *
 * Reason first, status second: `LoadByTokenAsync` answers **410 for both a revoked
 * invitation and an expired one** and separates them only by `reason`, and the server
 * goes out of its way to keep them apart. A 404 with no reason is still a 404; every
 * other status is left to `unknown` on purpose, because a 410 whose reason this build
 * does not recognise means the invitation is gone for a cause we cannot name.
 */
export function deadKind(error: MicroclimateLinkError | null): DeadKind {
  if (error === null) return 'unknown'
  if (error.reason !== null && Object.hasOwn(KIND_BY_REASON, error.reason)) {
    return KIND_BY_REASON[error.reason]
  }
  return error.status === 404 ? 'notFound' : 'unknown'
}

/**
 * The one view the screen draws.
 *
 * `hasSession` is "this browser holds a stored token", not "the token is valid" — this
 * page has no way to ask, and the server remains the authority on what the browser may
 * do. It is only ever consulted for a session the payload itself reports as NOT
 * anonymous: an anonymous pulse takes an unauthenticated respondent by design, and
 * asking one to sign in would be a gate the API does not have.
 */
export function invitationView(state: ResolveState, hasSession: boolean): InvitationView {
  if (state.status === 'loading') return { kind: 'loading' }

  if (state.status === 'dead') {
    return {
      kind: 'dead',
      dead: deadKind(state.error),
      // Only ever read on the `unknown` branch, and only when the server sent one. Every
      // named branch has a sentence of its own in both catalogues.
      serverMessage: state.error?.message ? state.error.message : null,
    }
  }

  const { detail } = state

  // Checked, not assumed. `GET /microclimates/{id}` serves an unauthenticated caller only
  // while the session is active, and a token can outlive its session's close: an
  // invitation minted at 09:00 for a pulse that ended at 09:30 still resolves at 09:29
  // and is useless at 09:31.
  if (detail.microclimateStatus !== 'active') {
    return { kind: 'closed', closesAt: detail.endTime }
  }

  // The other half of the same server rule: an identified session refuses an anonymous
  // caller outright — `POST .../responses` answers 401 — so the button would take this
  // respondent to a refusal they could not read as being about their browser.
  if (!detail.anonymity.anonymous && !hasSession) return { kind: 'signIn' }

  return { kind: 'landing', detail }
}

/**
 * The three sentences one dead state is drawn from: the small label over the card, the
 * title, and the explanation under it.
 *
 * Key strings rather than `t()` calls, and in this module rather than in the view, for the
 * reason `microclimateLinkFailure.ts` gives for the same shape: pulling the mapping out of
 * the render means it can be asserted directly, **including the assertion no rendering test
 * makes — that every key it can return exists in both catalogues**. `createTranslator` has
 * no default value, so a typo here would put `next.invitation.expiredTitle` on screen in
 * the place of a sentence, and a page test that only ever exercised one branch would never
 * see it. Written out rather than built with a template so the strings are greppable.
 */
export interface DeadCopy {
  /** A key in the `microclimates` namespace. */
  labelKey: string
  /** A key in the `microclimates` namespace. */
  titleKey: string
  /**
   * A key in the `microclimates` namespace, or `null` meaning "we have no better sentence
   * than the server's own". The caller then shows `MicroclimateLinkError.message`, falling
   * back to `errors.generic` when the response carried none.
   */
  bodyKey: string | null
}

const DEAD_COPY: Readonly<Record<DeadKind, DeadCopy>> = {
  notFound: {
    labelKey: 'next.invitation.notFoundLabel',
    titleKey: 'next.invitation.notFoundTitle',
    bodyKey: 'next.invitation.notFoundBody',
  },
  revoked: {
    labelKey: 'next.invitation.revokedLabel',
    titleKey: 'next.invitation.revokedTitle',
    bodyKey: 'next.invitation.revokedBody',
  },
  expired: {
    labelKey: 'next.invitation.expiredLabel',
    titleKey: 'next.invitation.expiredTitle',
    bodyKey: 'next.invitation.expiredBody',
  },
  used: {
    labelKey: 'next.invitation.usedLabel',
    titleKey: 'next.invitation.usedTitle',
    bodyKey: 'next.invitation.usedBody',
  },
  unknown: {
    labelKey: 'next.invitation.unknownLabel',
    titleKey: 'next.invitation.unknownTitle',
    bodyKey: null,
  },
}

export function deadCopy(kind: DeadKind): DeadCopy {
  return DEAD_COPY[kind]
}

/** Every key `deadCopy` can hand a translator, for the catalogue assertion. */
export const DEAD_COPY_KEYS: readonly string[] = Object.values(DEAD_COPY).flatMap((copy) =>
  [copy.labelKey, copy.titleKey, copy.bodyKey].filter((key): key is string => key !== null),
)

/**
 * The single deadline the landing card prints: "la fecha que llegue antes: el cierre del
 * pulso o el vencimiento de su enlace".
 *
 * Two dates go in and one comes out, which is the artboard's change from the shipped
 * page's pair of readings. They are genuinely different numbers — `endTime` is when the
 * session stops accepting answers, `expiresAt` is when this person's token stops working,
 * and an invitation can be issued with a shorter life than its session — so the reading
 * has to be the EARLIER of them. Printing the later one, or only one of the two, gives
 * whichever respondent the other applied to a deadline that is wrong in the direction
 * that costs them their answer.
 *
 * An unparseable date is not treated as `0` (which would win every comparison and print
 * 1970) nor silently dropped: the other date stands alone, and when neither parses the
 * answer is `null` and the caller prints no reading at all.
 */
export function respondUntil(endTime: string, expiresAt: string): string | null {
  const candidates = [endTime, expiresAt].filter((iso) => !Number.isNaN(Date.parse(iso)))
  if (candidates.length === 0) return null
  return candidates.reduce((earliest, iso) => (Date.parse(iso) < Date.parse(earliest) ? iso : earliest))
}
