import type { SurveyRespondView } from './api/surveyResponses'

/**
 * The anonymity block a page in front of `SurveyRespondForm` already drew, so the form does
 * not draw it again.
 *
 * ## The ruling (PROCOMER, 2026-11-18)
 *
 * «Anónima» is shown on the survey's start page and nowhere after it: the respondent read the
 * promise one tap ago, and the block repeated over the first question pushed the survey's own
 * welcome text and question 1 down the phone. Only two routes have a start page, and each
 * describes what it drew:
 *
 * - `'respondView'` — `/s/:token`. `PublicRespondEntryView` draws `AnonymityNotice` from the
 *   same `GET /surveys/{id}/respond` the form then reads, with the same three inputs (the
 *   response's anonymity, the survey's own intro, the participation clause). Same promise by
 *   construction.
 * - `{ invitation: anonymous }` — `/survey-invitations/:token`. The landing card has no respond
 *   view, only `SurveyInvitationTokenDetail.anonymity.anonymous` (the survey's setting), so it
 *   draws the catalogue's default wording for that flag: no intro of the survey's own and no
 *   participation clause.
 *
 * Every other route (`/surveys/:id/respond`, `/survey/:id`) has no start page, passes nothing,
 * and the form keeps drawing the promise itself.
 */
export type EntryPromise = 'respondView' | { invitation: boolean }

/**
 * Whether the start page already made the promise this form would make.
 *
 * True for `'respondView'`. For an invitation, true only when the form's block would say the
 * same thing the landing said, because the two inputs can disagree and the form must never
 * stay silent over a promise the respondent has not read:
 *
 * - the flag: the landing reads the SURVEY's setting, the form the RESPONSE's
 *   (`SurveyRespondView.anonymous` — an invitee with no session on an identified survey is
 *   stored anonymously, and is told so by the form);
 * - on an anonymous response, the survey's own intro and the participation clause, neither of
 *   which the landing can draw.
 */
export function promiseMadeAtEntry(
  entry: EntryPromise | undefined,
  view: Pick<SurveyRespondView, 'anonymous' | 'respondentIntro' | 'asksParticipantIdentity'>,
): boolean {
  if (entry === undefined) return false
  if (entry === 'respondView') return true
  if (entry.invitation !== view.anonymous) return false
  // `AnonymityNotice` ignores the intro and the participation clause on an identified
  // response, so on that branch the flag is the whole of what it says.
  if (!view.anonymous) return true
  return !view.respondentIntro?.trim() && view.asksParticipantIdentity !== true
}
