import type { SurveyPublicLinkDetail, SurveyLinkError } from '../../api/surveyLinks'
import type { SurveyRespondError, SurveyRespondView } from '../../api/surveyResponses'
import { publicLinkFailureCopy } from '../../linkFailure'
import { estimatedMinutes, isUnderAMinute } from '../../respondEstimate'

/**
 * The pure rules behind `/s/:token` — the PublicRespondEntry and
 * PublicRespondEntryStates artboards (10 Sep).
 *
 * The page is two requests deep and every one of its screens is a state of those two,
 * so the whole of its behaviour is a function of two load states and one flag. Written
 * here rather than as branches inside the component for the reason `linkFailure.ts`
 * gives for the same split: this is the file where "a closed survey must never be
 * reported as a broken link" can be asserted directly, and where a rendering test that
 * only ever walks the happy path cannot hide a wrong branch.
 */

// ----------------------------------------------------------------------------
// The two loads
// ----------------------------------------------------------------------------

/** `GET /survey-links/{token}` — the opaque share token, turned into a survey id. */
export type LinkLoad =
  | { status: 'resolving' }
  | { status: 'resolved'; detail: SurveyPublicLinkDetail }
  | { status: 'dead'; error: SurveyLinkError | null }

/**
 * `GET /surveys/{id}/respond` — the survey itself.
 *
 * The entry card cannot be drawn without it. The link payload carries a question count
 * nowhere, and its `allowAnonymous` is `SurveyDistribution.AccessRules.AllowAnonymous`
 * — who may open the link — **not** `Survey.Settings.Anonymous`, which is what decides
 * whether a response is written with a user id on it. Rendering the anonymity promise
 * off the link payload would put "Sus respuestas se guardan sin su nombre" over a
 * survey that records exactly that, which is the worst sentence this product could
 * print. `SurveyRespondView.anonymous` is the flag the server actually applies, so it
 * is the one the promise is made from.
 */
export type ViewLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; view: SurveyRespondView }
  | { status: 'failed'; error: SurveyRespondError | null }

// ----------------------------------------------------------------------------
// Outcomes
// ----------------------------------------------------------------------------

/**
 * One of the seven cards PublicRespondEntryStates draws, as copy rather than as
 * pixels.
 *
 * `tone` is `success` only for the one outcome that is not a failure — the respondent
 * has already answered — and it decides whether the card interrupts (`alert`) or waits
 * its turn (`status`). `signIn` is the only action any of these cards offers, because
 * nothing else here is retryable: a closed survey stays closed and a wrong link is
 * wrong on the next click too.
 */
export interface EntryOutcome {
  /** A key in the `surveyRespond` namespace. */
  titleKey: string
  /** A key in the `surveyRespond` namespace, or null meaning "the server's own message". */
  bodyKey: string | null
  tone: 'warning' | 'success'
  /** Whether the card offers a way to sign in. */
  signIn: boolean
}

/** The glyph in the card's tile, and the tile's fill. */
export type OutcomeGlyph = 'calendar' | 'link' | 'clock' | 'alert' | 'search' | 'check' | 'lock'
export type OutcomeTile = 'neutral' | 'warning' | 'good'

export interface OutcomeLook {
  glyph: OutcomeGlyph
  tile: OutcomeTile
}

/**
 * Which picture goes with which sentence, as PublicRespondEntryStates draws them.
 *
 * Keyed on the title rather than carried on `LinkFailureCopy`, so `linkFailure.ts` —
 * which both token routes share and whose whole subject is *what to say* — is not made
 * to hold a decision about *what to draw*. The map is total over the outcomes this
 * product can reach and falls back to the amber warning for anything it has not heard
 * of, which is the honest default: an unrecognised outcome is a failure.
 */
const LOOKS: Readonly<Record<string, OutcomeLook>> = {
  // "Enlace directo · encuesta cerrada": a calendar, on the plain tile. A survey that
  // closed on schedule is not an error and is not drawn as one.
  closedTitle: { glyph: 'calendar', tile: 'neutral' },
  // "Enlace compartido · no abre": the canvas's own broken-link glyph, amber.
  linkInvalidTitle: { glyph: 'link', tile: 'warning' },
  // "Invitación personal · caducada": a clock.
  invitationExpiredTitle: { glyph: 'clock', tile: 'warning' },
  // "Invitación personal · anulada": an exclamation in a circle — somebody acted.
  invitationRevokedTitle: { glyph: 'alert', tile: 'warning' },
  // "Invitación personal · no encontrada": a magnifier, on the plain tile.
  invitationNotFoundTitle: { glyph: 'search', tile: 'neutral' },
  notFoundTitle: { glyph: 'search', tile: 'neutral' },
  // "Invitación personal · ya respondida": a tick, green. Not a failure.
  alreadyCompletedTitle: { glyph: 'check', tile: 'good' },
  // "Encuesta con nombre · sin sesión iniciada": a padlock, on the plain tile.
  'next.entrySignInTitle': { glyph: 'lock', tile: 'neutral' },
  notYoursTitle: { glyph: 'lock', tile: 'neutral' },
  signInAgainTitle: { glyph: 'lock', tile: 'neutral' },
}

export function outcomeLook(titleKey: string, tone: EntryOutcome['tone']): OutcomeLook {
  if (Object.hasOwn(LOOKS, titleKey)) return LOOKS[titleKey]
  return { glyph: 'alert', tile: tone === 'success' ? 'good' : 'warning' }
}

/**
 * What a failed `GET /surveys/{id}/respond` means **once the share link has already
 * resolved**, which is the only place this function is called from.
 *
 * That precondition is what makes the 401 branch legible. `ResolveRespondentAsync`
 * refuses an unauthenticated caller when the survey is not anonymous **or** is not
 * accepting responses, and deliberately does not say which — telling a stranger "this
 * exists but is not anonymous" is a disclosure about a tenant's survey. Here the second
 * half is already ruled out: `ResolvePublicLinkAsync` answers 404 unless
 * `SurveyStatuses.AcceptsResponses` is true, and it answered a moment ago. So a 401
 * with no credentials in hand means the survey records who answers, and the respondent
 * can be told the one thing they can act on — sign in — instead of the ambiguous
 * sentence the bare respond route has to use.
 *
 * With a token in hand the ambiguity is back: the browser sent a bearer and the server
 * did not accept it, which could be a stale session or a survey that closed in the
 * seconds since the resolve. That branch keeps the honest `unavailable` copy and still
 * offers the sign-in, because signing in again is the one thing that might help.
 *
 * @param signedIn whether this browser holds a token at all — `getToken() !== null`.
 */
export function respondFailureOutcome(status: number | null, signedIn: boolean): EntryOutcome {
  switch (status) {
    case 400:
      return { titleKey: 'closedTitle', bodyKey: 'closedBody', tone: 'warning', signIn: false }
    case 401:
      return signedIn
        ? { titleKey: 'unavailableTitle', bodyKey: 'unavailableBody', tone: 'warning', signIn: true }
        : {
            titleKey: 'next.entrySignInTitle',
            bodyKey: 'next.entrySignInBody',
            tone: 'warning',
            signIn: true,
          }
    case 403:
      return { titleKey: 'notYoursTitle', bodyKey: 'notYoursBody', tone: 'warning', signIn: false }
    case 404:
      return { titleKey: 'notFoundTitle', bodyKey: 'notFoundBody', tone: 'warning', signIn: false }
    default:
      return { titleKey: 'loadFailedTitle', bodyKey: null, tone: 'warning', signIn: false }
  }
}

/** The respondent's answers are already in. A confirmation, never a warning. */
const ALREADY_ANSWERED: EntryOutcome = {
  titleKey: 'alreadyCompletedTitle',
  bodyKey: 'alreadyCompletedBody',
  tone: 'success',
  signIn: false,
}

// ----------------------------------------------------------------------------
// The page's state
// ----------------------------------------------------------------------------

/**
 * What `/s/:token` is showing.
 *
 * `waiting` covers both loads on purpose: the respondent made one gesture — they
 * followed a link — and two spinners in a row for two requests they did not ask for
 * reads as a page that failed and retried.
 */
export type EntryState =
  | { status: 'waiting' }
  | { status: 'landing'; detail: SurveyPublicLinkDetail; view: SurveyRespondView }
  | { status: 'blocked'; outcome: EntryOutcome; serverMessage: string }
  | { status: 'answering'; surveyId: string }

/**
 * The whole page, as a function of its two loads.
 *
 * Order matters and is the privacy rule in code: a **dead link is answered before the
 * survey is ever looked at**, so a token that did not resolve cannot reach a branch
 * that renders a survey's name, its close date, its question count or its anonymity —
 * there is nothing in scope to render. That is the same "fail closed" shape a shared
 * report link learned the hard way, written where it can be asserted rather than left
 * to the order of `if`s inside a component.
 *
 * @param answering set by the respondent pressing "Empezar"; the form owns the page
 * from then on.
 * @param signedIn whether this browser holds a token — see `respondFailureOutcome`.
 */
export function entryState(
  link: LinkLoad,
  view: ViewLoad,
  answering: boolean,
  signedIn: boolean,
): EntryState {
  if (link.status === 'resolving') return { status: 'waiting' }

  if (link.status === 'dead') {
    const copy = publicLinkFailureCopy(link.error)
    return {
      status: 'blocked',
      outcome: { ...copy, signIn: false },
      serverMessage: link.error?.message ?? '',
    }
  }

  if (answering) return { status: 'answering', surveyId: link.detail.surveyId }

  switch (view.status) {
    case 'idle':
    case 'loading':
      return { status: 'waiting' }
    case 'failed':
      return {
        status: 'blocked',
        outcome: respondFailureOutcome(view.error?.status ?? null, signedIn),
        serverMessage: view.error?.message ?? '',
      }
    case 'ready':
      // Somebody who has already finished is not offered "Empezar". The form would
      // meet them with the same sentence one screen later; saying it here means the
      // page they land on is the page they needed.
      return view.view.inProgress?.isComplete
        ? { status: 'blocked', outcome: ALREADY_ANSWERED, serverMessage: '' }
        : { status: 'landing', detail: link.detail, view: view.view }
  }
}

// ----------------------------------------------------------------------------
// The entry card's one derived sentence
// ----------------------------------------------------------------------------

/** A catalogue key with the numbers it interpolates. */
export interface EntryPace {
  key: string
  params: { count: number; minutes: number }
}

/**
 * "Seis preguntas, una a la vez. Unos 4 minutos." — the line the artboard writes under
 * the survey's name.
 *
 * It describes the SHAPE of what is about to happen rather than the survey's subject,
 * which is why the author's own description is not printed here: the form prints that
 * on its first page (`SurveyRespondForm`, `index === 0 && view.description`), and the
 * same paragraph twice in two screens is how a respondent learns to skip both.
 *
 * Three keys rather than one because this catalogue has no plural machinery and
 * `interpolate` is a straight `{name}` substitution: "1 preguntas" is what one key
 * would print for a single-question survey, and "unos 1 minutos" for a short one.
 * `estimatedMinutes` is the product's one estimate — the Home card and the respond
 * footer quote the same arithmetic, so a survey cannot be described two ways.
 */
export function entryPace(questionCount: number): EntryPace {
  const minutes = estimatedMinutes(questionCount)
  const params = { count: questionCount, minutes }

  if (questionCount === 1) return { key: 'next.entryPaceOne', params }
  if (isUnderAMinute(questionCount)) return { key: 'next.entryPaceBrief', params }
  return { key: 'next.entryPace', params }
}
