import type { SurveyLinkError } from './api/surveyLinks'

/**
 * Which sentence a dead survey link earns.
 *
 * ## Why this is a pure function and not a `switch` inside the page
 *
 * A dead link has four genuinely different causes and each one has a different next
 * step for the person holding it: a wrong link is retyped, a revoked one is asked
 * about, an expired one is asked to be reissued, and an already-answered one needs
 * nothing at all. Collapsing them into one "something went wrong" is what makes a
 * respondent keep reloading a survey that closed a week ago — and it is the easiest
 * thing in the world to do by accident, because all four arrive as a rejected promise.
 *
 * Pulling the mapping out of the render means it can be asserted directly, including
 * the assertion no rendering test makes: that every key it can return exists in
 * **both** catalogues. `translate()` has no default value, so a typo here would put
 * `invitationExpiredTitle` on screen in the place of a sentence — and a page test that
 * only ever exercises the happy path would never see it.
 *
 * ## Reason first, status second
 *
 * The status alone cannot separate revoked from expired: `LoadByTokenAsync` answers 410
 * for both and distinguishes them only by `reason`. So `reason` is consulted first and
 * the status is the fallback for a response that carries none — which is every
 * `/survey-links/{token}` failure, by design.
 */
export interface LinkFailureCopy {
  /** A key in the `surveyRespond` namespace. */
  titleKey: string
  /**
   * A key in the `surveyRespond` namespace, or `null` meaning "we have no better
   * sentence than the server's own". The caller then shows `SurveyLinkError.message`,
   * falling back to `errors.generic` when the response carried none — the same rule
   * `SurveyRespondForm`'s load failure already follows.
   */
  bodyKey: string | null
  /**
   * How the outcome should read.
   *
   * Presentation, in a mapping that is otherwise about copy, because it is the same
   * decision: `already_completed` is not a failure and must not be dressed as one. A
   * respondent whose answers are already in, told in an amber box with a warning
   * glyph, will assume something went wrong and go looking for somebody to ask.
   */
  tone: 'warning' | 'success'
}

/**
 * The generic branch. Reached for a status this client has no specific copy for, which
 * in practice is a 429 from the token rate limiter, a 5xx, or a network failure that
 * produced no response at all.
 */
const UNKNOWN: LinkFailureCopy = { titleKey: 'loadFailedTitle', bodyKey: null, tone: 'warning' }

/**
 * The server's `reason` vocabulary, from the four places `SurveyDistributionEndpoints`
 * emits one.
 *
 * A map rather than a chain of `if`s, so a reason this build has not heard of falls
 * through to the status rules below instead of matching the nearest-looking case — the
 * client guessing at a reason it does not recognise is how "revoked" comes to be
 * reported as "expired".
 */
const BY_REASON: Readonly<Record<string, LinkFailureCopy>> = {
  not_found: {
    titleKey: 'invitationNotFoundTitle',
    bodyKey: 'invitationNotFoundBody',
    tone: 'warning',
  },
  revoked: { titleKey: 'invitationRevokedTitle', bodyKey: 'invitationRevokedBody', tone: 'warning' },
  expired: { titleKey: 'invitationExpiredTitle', bodyKey: 'invitationExpiredBody', tone: 'warning' },
  // Not an error the respondent should be made to feel bad about, and the one case
  // where copy already in the catalogue is exactly right: their answers are in.
  already_completed: {
    titleKey: 'alreadyCompletedTitle',
    bodyKey: 'alreadyCompletedBody',
    tone: 'success',
  },
}

/**
 * Copy for a failed `GET /survey-invitations/{token}`.
 *
 * @param error the rejection, or `null` when the promise rejected with something that
 * was not a `SurveyLinkError` at all — a `TypeError` out of `fetch`, typically, which
 * is what an offline respondent gets.
 */
export function invitationFailureCopy(error: SurveyLinkError | null): LinkFailureCopy {
  if (error === null) return UNKNOWN

  if (error.reason !== null && Object.hasOwn(BY_REASON, error.reason)) {
    return BY_REASON[error.reason]
  }

  // A 404 with no reason is still a 404. Every other status is left to the generic
  // branch on purpose: a 410 whose reason this build does not recognise means the
  // invitation is gone for a cause we cannot name, and the server's own message is a
  // better answer than the nearest sentence we happen to have.
  return error.status === 404 ? BY_REASON.not_found : UNKNOWN
}

/**
 * Copy for a failed `GET /survey-links/{token}`.
 *
 * One sentence for the whole 404, and that is not laziness — it is the client half of a
 * deliberate server decision. `ResolvePublicLinkAsync` answers the same
 * undifferentiated 404 for an unknown token, a revoked link and a survey outside its
 * window, because a share link is held by anyone at all and "this link existed but was
 * revoked" confirms a tenant's survey exists to somebody who should learn nothing from
 * a dead URL. So the copy has to be honest about the ambiguity rather than pick
 * whichever of the three reads best.
 */
export function publicLinkFailureCopy(error: SurveyLinkError | null): LinkFailureCopy {
  if (error?.status === 404) {
    return { titleKey: 'linkInvalidTitle', bodyKey: 'linkInvalidBody', tone: 'warning' }
  }
  return UNKNOWN
}
