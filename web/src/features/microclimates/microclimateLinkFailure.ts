import type { MicroclimateLinkError } from './api/microclimateLinks'

/**
 * Which sentence a dead microclimate invitation link earns.
 *
 * ## Why this is a pure function and not a `switch` inside the page
 *
 * A dead link has four genuinely different causes and each one has a different next step
 * for the person holding it: a wrong link is retyped, a revoked one is asked about, an
 * expired one is asked to be reissued, and an already-answered one needs nothing at all.
 * Collapsing them into one "something went wrong" is what makes a respondent keep reloading
 * a pulse that closed last Tuesday — and it is the easiest thing in the world to do by
 * accident, because all four arrive as a rejected promise.
 *
 * Pulling the mapping out of the render means it can be asserted directly, including the
 * assertion no rendering test makes: that every key it can return exists in **both**
 * catalogues. `translate()` has no default value, so a typo here would put
 * `invitationExpiredTitle` on screen in the place of a sentence — and a page test that only
 * ever exercises the happy path would never see it.
 *
 * ## Reason first, status second
 *
 * The status alone cannot separate revoked from expired: `LoadByTokenAsync` answers 410 for
 * both and distinguishes them only by `reason`. So `reason` is consulted first and the
 * status is the fallback for a response that carries none.
 *
 * ## Why this is not `surveys/linkFailure.ts` with a parameter
 *
 * The keys differ, and they have to. "This survey invitation has expired" is the wrong
 * sentence for a two-minute pulse that closed on its own end time, and the two catalogues
 * keep the words in the namespace of the thing they describe. Sharing the function and
 * passing a namespace in would put the prefix in the caller, which is the one place a typo
 * cannot be caught by `keysExist`.
 */
export interface MicroclimateLinkFailureCopy {
  /** A key in the `microclimates` namespace. */
  titleKey: string
  /**
   * A key in the `microclimates` namespace, or `null` meaning "we have no better sentence
   * than the server's own". The caller then shows `MicroclimateLinkError.message`, falling
   * back to `errors.generic` when the response carried none.
   */
  bodyKey: string | null
  /**
   * How the outcome should read.
   *
   * Presentation, in a mapping that is otherwise about copy, because it is the same
   * decision: `already_completed` is not a failure and must not be dressed as one. A
   * respondent whose answers are already in, told in an amber box with a warning glyph,
   * will assume something went wrong and go looking for somebody to ask.
   */
  tone: 'warning' | 'success'
}

/**
 * The generic branch. Reached for a status this client has no specific copy for, which in
 * practice is a 429 from the token rate limiter, a 5xx, or a network failure that produced
 * no response at all.
 */
const UNKNOWN: MicroclimateLinkFailureCopy = {
  titleKey: 'invitationLoadFailedTitle',
  bodyKey: null,
  tone: 'warning',
}

/**
 * The server's `reason` vocabulary, from the four places `MicroclimateInvitationEndpoints`
 * emits one.
 *
 * A map rather than a chain of `if`s, so a reason this build has not heard of falls through
 * to the status rule below instead of matching the nearest-looking case — the client
 * guessing at a reason it does not recognise is how "revoked" comes to be reported as
 * "expired".
 */
const BY_REASON: Readonly<Record<string, MicroclimateLinkFailureCopy>> = {
  not_found: {
    titleKey: 'invitationNotFoundTitle',
    bodyKey: 'invitationNotFoundBody',
    tone: 'warning',
  },
  revoked: {
    titleKey: 'invitationRevokedTitle',
    bodyKey: 'invitationRevokedBody',
    tone: 'warning',
  },
  expired: {
    titleKey: 'invitationExpiredTitle',
    bodyKey: 'invitationExpiredBody',
    tone: 'warning',
  },
  // Not an error the respondent should be made to feel bad about: their answers are in.
  // Only ever reachable on a non-anonymous session — an anonymous one never records
  // `completed`, so its invitees can re-open their link, which is the cost of the guarantee
  // and is correct.
  already_completed: {
    titleKey: 'invitationAlreadyCompletedTitle',
    bodyKey: 'invitationAlreadyCompletedBody',
    tone: 'success',
  },
}

/**
 * Copy for a failed `GET /microclimate-invitations/{token}`.
 *
 * @param error the rejection, or `null` when the promise rejected with something that was
 * not a `MicroclimateLinkError` at all — a `TypeError` out of `fetch`, typically, which is
 * what an offline respondent gets.
 */
export function microclimateInvitationFailureCopy(
  error: MicroclimateLinkError | null,
): MicroclimateLinkFailureCopy {
  if (error === null) return UNKNOWN

  if (error.reason !== null && Object.hasOwn(BY_REASON, error.reason)) {
    return BY_REASON[error.reason]
  }

  // A 404 with no reason is still a 404. Every other status is left to the generic branch
  // on purpose: a 410 whose reason this build does not recognise means the invitation is
  // gone for a cause we cannot name, and the server's own message is a better answer than
  // the nearest sentence we happen to have.
  return error.status === 404 ? BY_REASON.not_found : UNKNOWN
}
