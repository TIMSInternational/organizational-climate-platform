import { EntryOutcomeCard } from '../next/entry/EntryOutcomeCard'
import type { LinkFailureCopy } from '../linkFailure'

export interface LinkOutcomeProps {
  copy: LinkFailureCopy
  /**
   * `SurveyLinkError.message`, used only when `copy.bodyKey` is null — i.e. when this
   * client has no sentence of its own for the status it got back. Empty when the
   * response carried no message, in which case the generic error copy stands in.
   */
  serverMessage: string
}

/**
 * The end of a survey link that did not open a survey.
 *
 * One component for both token routes, because the four dead-link outcomes are the same
 * four whichever link was followed and the visitor is the same person: somebody who
 * clicked something they were sent and now needs one sentence they can act on.
 *
 * ## Why it does not offer a "try again" or a link anywhere
 *
 * Nothing here is retryable. A revoked token stays revoked, an expired one stays
 * expired, and a wrong one is wrong on the next click too — so a retry button would be
 * a control whose only function is to produce the same message a second time. Nor is
 * there a link into the app: the visitor is not, and may never have been, a user of it,
 * and `RequireAuth` would meet them with a sign-in form nobody asked for.
 *
 * The one action that ever helps is naming who to ask, which the copy does.
 *
 * ## The tone comes from the mapping, not from the fact that a promise rejected
 *
 * `already_completed` arrives as a 409 and is not a problem: the respondent's answers
 * are in and there is nothing left for them to do. It renders in the success treatment
 * with the tick, exactly as `SurveyRespondForm`'s own already-completed state does, so
 * one situation does not have two faces depending on which route reached it.
 *
 * ## Why it is now a wrapper and not a component
 *
 * PublicRespondEntryStates (10 Sep) draws all seven of these outcomes — the two share
 * links' and the invitation's — as one card. `EntryOutcomeCard` is that card, and the
 * `/s/:token` entry needs it with one extra thing this signature cannot express: a
 * sign-in control, for the one outcome whose answer genuinely is signing in. Rather
 * than widen `LinkFailureCopy` — which is the module about *what to say*, shared by
 * both token routes — the card takes the richer shape and this stays the invitation
 * route's door to it. Deleting this file and calling the card directly from
 * `SurveyInvitationPage` is a fine follow-up; it is an edit to that page, with that
 * page's tests, rather than a side effect of redrawing the share link's entry.
 */
export function LinkOutcome({ copy, serverMessage }: LinkOutcomeProps) {
  return <EntryOutcomeCard outcome={{ ...copy, signIn: false }} serverMessage={serverMessage} />
}
