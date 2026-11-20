import type { SurveyRespondView } from './api/surveyResponses'
import { effectiveText, type RespondentContentSource } from './api/respondentContent'

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
 *   response's anonymity, the client's words, the participation clause). Same promise by
 *   construction.
 * - `invitationPromise(detail, locale)` — `/survey-invitations/:token`. The landing card has no
 *   respond view, only `SurveyInvitationTokenDetail`: the survey's anonymity setting and, since
 *   2026-11-19, the client's words for the block (`anonymousChip`, `anonymousBody` from the
 *   survey → company chain). It says which words it drew — the client's, or null for the
 *   catalogue's — in which language; it never draws the participation clause.
 *
 * Every other route (`/surveys/:id/respond`, `/survey/:id`) has no start page, passes nothing,
 * and the form keeps drawing the promise itself.
 */
export type EntryPromise =
  | 'respondView'
  | {
      /** The survey's anonymity setting, which the landing drew. */
      invitation: boolean
      /** The screen language the landing drew in. */
      locale: string
      /** The client's `anonymousBody` the landing drew, or null when it drew the catalogue's. */
      anonymousBody: string | null
      /** The client's `anonymousChip` the landing drew, or null when it drew the catalogue's. */
      anonymousChip: string | null
    }

/** What `/survey-invitations/:token`'s landing card drew: the words `AnonymityNotice` read from `detail`. */
export function invitationPromise(
  detail: RespondentContentSource & { anonymity: { anonymous: boolean } },
  locale: string,
): EntryPromise {
  return {
    invitation: detail.anonymity.anonymous,
    locale,
    anonymousBody: effectiveText(detail, locale, 'anonymousBody'),
    anonymousChip: effectiveText(detail, locale, 'anonymousChip'),
  }
}

/**
 * Whether the start page already made the promise this form would make.
 *
 * True for `'respondView'`. For an invitation, true only when the form's block would say the
 * same thing the landing said, because the inputs can disagree and the form must never stay
 * silent over a promise the respondent has not read:
 *
 * - the flag: the landing reads the SURVEY's setting, the form the RESPONSE's
 *   (`SurveyRespondView.anonymous` — an invitee with no session on an identified survey is
 *   stored anonymously, and is told so by the form);
 * - the language: a landing drawn in another language did not say these words;
 * - on an anonymous response, the client's words (the form draws its own view's, which can
 *   differ if they were edited in between) and the participation clause, which the landing
 *   never draws.
 */
export function promiseMadeAtEntry(
  entry: EntryPromise | undefined,
  view: Pick<SurveyRespondView, 'anonymous' | 'asksParticipantIdentity'> & RespondentContentSource,
  locale: string,
): boolean {
  if (entry === undefined) return false
  if (entry === 'respondView') return true
  if (entry.invitation !== view.anonymous) return false
  if (entry.locale !== locale) return false
  // `AnonymityNotice` reads only the catalogue on an identified response (the identified
  // variants are not in the registry), so on that branch the flag is the whole of what it says.
  if (!view.anonymous) return true
  if (view.asksParticipantIdentity === true) return false
  return (
    effectiveText(view, locale, 'anonymousBody') === entry.anonymousBody
    && effectiveText(view, locale, 'anonymousChip') === entry.anonymousChip
  )
}
