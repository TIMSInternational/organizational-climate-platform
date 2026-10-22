import { SurveyRespondError } from './api/surveyResponses'

/**
 * Why a save or a submit on the respond page did not land, in the respondent's terms.
 *
 * ## Why this exists
 *
 * `POST /surveys/{id}/responses` refuses in fixed English (`SurveyResponseEndpoints.cs`):
 * "This survey is not currently accepting responses", "This survey has reached its response
 * limit", "This survey does not allow partial responses", and the browser adds its own
 * "Failed to fetch" / "Load failed" when there is no response at all. The respond page used
 * to print `error.message` for every one of them except the 402, so a Costa Rican respondent
 * whose page outlived the close read English on an otherwise Spanish screen (audit
 * 2026-10-22, R1). **No server text reaches the screen any more**: every failure is one of
 * these kinds, and every kind is a catalogued sentence in both languages that says what
 * happened and whether what was just sent was recorded.
 *
 * ## Status first, message second
 *
 * The status is the contract. Only a 400 needs more than its status, because the endpoint
 * answers 400 for several different things; for those three refusals the server's message
 * is matched EXACTLY, against the constants below, purely to choose between our own
 * sentences. A message this build does not recognise — reworded, translated, or a validation
 * error — is still a 400 and still gets a translated sentence (`rejected`); it is never
 * printed. Matching on the text is therefore an optimisation of the wording and never a
 * path to the screen.
 */
export type RespondFailureKind =
  | 'closed'
  | 'responseLimit'
  | 'partialNotAllowed'
  | 'rejected'
  | 'noSeats'
  | 'signedOut'
  | 'unavailable'
  | 'notYours'
  | 'notFound'
  | 'conflict'
  | 'tooMany'
  | 'server'
  | 'network'

/** `SurveyResponseEndpoints.NotAccepting()` — the survey closed, or was never opened. */
export const SERVER_NOT_ACCEPTING = 'This survey is not currently accepting responses'
/** `SurveyResponseEndpoints.SubmitAsync`, the response-limit check. */
export const SERVER_RESPONSE_LIMIT = 'This survey has reached its response limit'
/** `SurveyResponseEndpoints.SubmitAsync`, a partial save on a survey that takes none. */
export const SERVER_PARTIAL_NOT_ALLOWED = 'This survey does not allow partial responses'

/**
 * @param publicEntry whether the page was reached by the open link or QR (`/s/:token`). A
 * 401 means something different there: nobody on that route is signed in, so it is the
 * server's `Unavailable()` — the survey stopped taking answers from a visitor — and never an
 * expired session (`entry/derive.ts`, `respondFailureOutcome`).
 */
export function respondFailureKind(error: unknown, publicEntry: boolean): RespondFailureKind {
  // Anything that is not a status from the API is a request that never got an answer:
  // `fetch` rejects with a `TypeError` ("Failed to fetch" in Chrome, "Load failed" in
  // Safari) when the network is down, the connection drops, or the request is cancelled.
  if (!(error instanceof SurveyRespondError)) return 'network'

  switch (error.status) {
    case 400:
      if (error.message === SERVER_NOT_ACCEPTING) return 'closed'
      if (error.message === SERVER_RESPONSE_LIMIT) return 'responseLimit'
      if (error.message === SERVER_PARTIAL_NOT_ALLOWED) return 'partialNotAllowed'
      return 'rejected'
    case 401:
      return publicEntry ? 'unavailable' : 'signedOut'
    case 402:
      return 'noSeats'
    case 403:
      return 'notYours'
    case 404:
      return 'notFound'
    case 409:
      return 'conflict'
    case 422:
      return 'rejected'
    case 429:
      return 'tooMany'
    default:
      return 'server'
  }
}

/**
 * The `surveyRespond` key that says it.
 *
 * `noSeats` keeps the sentence it has had since the licensing slice (`noSeatsBody`), so a
 * respondent who already met it reads the same words; every other kind is under `failure.`.
 */
export function respondFailureKey(kind: RespondFailureKind): string {
  return kind === 'noSeats' ? 'noSeatsBody' : `failure.${kind}`
}

/** Every key `respondFailureKey` can return, for the catalogue assertion. */
export const RESPOND_FAILURE_KINDS: readonly RespondFailureKind[] = [
  'closed',
  'responseLimit',
  'partialNotAllowed',
  'rejected',
  'noSeats',
  'signedOut',
  'unavailable',
  'notYours',
  'notFound',
  'conflict',
  'tooMany',
  'server',
  'network',
]
