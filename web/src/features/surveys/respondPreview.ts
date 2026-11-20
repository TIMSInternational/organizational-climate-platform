import type { SurveyAnswerInput, SurveyRespondView, SurveySubmissionResult } from './api/surveyResponses'

/**
 * The seam that turns `SurveyRespondForm` into «Ver como quien responde» (ruled 2026-11-19,
 * `docs/decisions/editable-respondent-content.md`): the real respond screens, saving nothing.
 *
 * ## What a preview does instead of each side effect
 *
 * | Respondent | Preview |
 * |---|---|
 * | `getSurveyRespondView` (the respond GET, with the resume key) | `load(lang)` — the preview payload |
 * | `ensureSessionId` (mints and stores a resume key) | `seed`, fresh per preview, stored nowhere |
 * | `useRespondLock` (one open tab, in `localStorage`) | no lock |
 * | `hasAnswered` / `markAnswered` (the answered-on-this-device flag) | never read, never written |
 * | autosave (timer, `pagehide`, unmount) | off |
 * | «Guardar y terminar después» | nothing is sent |
 * | the completing `submitSurveyResponse` | `previewSubmission` — the thank-you, drawn locally |
 * | `clearSessionId`, `onSubmitted` | not called |
 *
 * Nothing in a preview reaches the server but the read: no response, no session, no
 * participation, invitation or licence change, and no audit row.
 *
 * ## The shuffle
 *
 * A respondent's order is seeded by their session id, so it holds still while they answer.
 * A preview has no session; it is seeded by `seed`, minted once per preview (a fresh one on
 * «Ver de nuevo»), so an operator sees a real served order — shuffle applied, the free text
 * after it, «Mantener al final» last — and a different one each time they start over.
 */
export interface RespondPreviewSeam {
  /** The respond view in `lang`, from `GET /surveys/{id}/respond-preview`. */
  load: (lang: string) => Promise<SurveyRespondView>
  /** Seeds the shuffle in place of a session id. */
  seed: string
}

/** A seed no respondent's session id can collide with, minted per preview. */
export function mintPreviewSeed(): string {
  const source = globalThis.crypto
  const random =
    source && typeof source.randomUUID === 'function'
      ? source.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `preview:${random}`
}

/**
 * What the thank-you screen is drawn from, made in the browser: the counts the respondent's
 * own receipt would print for these answers, and nothing recorded anywhere. `responseId` is
 * empty because there is no response.
 */
export function previewSubmission(
  view: SurveyRespondView,
  inputs: readonly SurveyAnswerInput[],
  seed: string,
): SurveySubmissionResult {
  return {
    responseId: '',
    sessionId: seed,
    isComplete: true,
    isAnonymous: view.anonymous,
    alreadySubmitted: false,
    language: view.resolvedLocale,
    answeredQuestionCount: inputs.length,
    questionCount: view.questions.length,
    suppressedDemographics: [],
  }
}
