import type { SurveyAnswerInput, SurveyRespondQuestion, SurveyRespondView } from './api/surveyResponses'
import { answerShapeOf, isAnswered, type AnswerMap } from './respondAnswers'

/**
 * The rules behind keeping a respondent's progress without them pressing anything
 * (#369), separated from the page so each one is provable on its own.
 *
 * Same split, and the same reason, as `respondAnswers`: a respondent's answers are the
 * least recoverable thing in the product, so the decisions about when they are written
 * and where the respondent is put on the way back in should be assertable directly
 * rather than only through a rendered form.
 *
 * ## What is deliberately NOT here
 *
 * The debounce, the request and the status the respondent reads all live in
 * `SurveyRespondForm`, because they are about a browser rather than about a rule. This
 * module answers three questions and nothing else: may this survey be saved in the
 * background, is there anything worth sending, and where did the respondent stop.
 */

/**
 * Long enough that a run of keystrokes or a re-ranked list is one save rather than
 * twenty, short enough that an interruption inside the window is rare.
 *
 * The same 1500ms `useSurveyDraft` settled on for the survey wizard. It is a floor on
 * how much can be lost, not a ceiling: the save fired when the page is hidden or closed
 * covers the window itself, so the delay costs nothing on the paths that actually lose
 * work.
 */
export const RESPOND_AUTOSAVE_DELAY_MS = 1500

/** How the respondent is told whether their answers are anywhere but this screen. */
export type RespondSaveStatus =
  /** This survey is not saved in the background at all; the button is the only way. */
  | 'off'
  /** Nothing has been answered yet, so there is nothing to keep. */
  | 'idle'
  /** Answered since the last save; a save is scheduled. */
  | 'pending'
  | 'saving'
  | 'saved'
  /** The last save failed. Sticky until one succeeds, and retried on the next answer. */
  | 'error'

export interface RespondSaveState {
  status: RespondSaveStatus
  /** When the last save succeeded, epoch ms. Survives a later failure on purpose. */
  savedAt: number | null
  /** The server's own message for a failure. */
  message: string | null
}

export const RESPOND_SAVE_IDLE: RespondSaveState = { status: 'idle', savedAt: null, message: null }

/**
 * Whether this survey's progress may be written without the respondent asking.
 *
 * Three gates, and each one is somebody else's decision rather than this page's:
 *
 * - **`allowPartialResponses`** is the survey author's, and it is also the server's:
 *   `SurveyResponseEndpoints` refuses a partial save on a survey that forbids them with
 *   a 400, so autosaving anyway would be a background request that can only ever fail
 *   and an error the respondent did nothing to cause.
 * - **`autoSave`** is the survey author's too, and until #369 this page could not see
 *   it — the payload carried every other setting and not that one.
 * - **`inProgress.isComplete`** is the respondent's own: a finished response is
 *   terminal, the page renders the already-answered notice instead of a form, and a
 *   background write against it would be refused as idempotent at best.
 *
 * Takes the whole view rather than three booleans so that a field added to the payload
 * cannot be silently left out of the decision at the one call site.
 */
export function respondAutosaveAllowed(view: SurveyRespondView | null): boolean {
  if (view === null) return false
  if (!view.allowPartialResponses) return false
  if (!view.autoSave) return false
  if (view.inProgress?.isComplete === true) return false
  return true
}

/**
 * Whether there is anything worth writing.
 *
 * `toAnswerInputs` already omits an unanswered question, so an empty payload means the
 * respondent has opened the survey and touched nothing. Posting it anyway would create
 * a bare `responses` row per visitor — a write amplifier, and on an identified survey a
 * record that a named employee opened a survey they never answered. The endpoint
 * accepts such a post and creates the row (asserted by
 * `An_empty_partial_save_still_creates_a_response_row_which_is_why_the_form_waits`),
 * so the restraint has to be here.
 *
 * `cleared` is why this is not simply `inputs.length > 0`. A respondent who erases the
 * only answer they had produces no inputs at all, and that submission is the one that
 * matters most: it IS the erasure. Gating on the answers alone is precisely how a
 * taken-back answer used to stay on the server forever.
 */
export function hasProgressToSave(
  inputs: readonly SurveyAnswerInput[],
  cleared: readonly string[] = [],
): boolean {
  return inputs.length > 0 || cleared.length > 0
}

/**
 * The questions the server still holds an answer for that the respondent has since
 * taken back — the payload's other half, and the one the first cut of #369 was missing.
 *
 * `toAnswerInputs` omits an unanswered question, so erasing an answer simply removed it
 * from the payload; the server's writer only ever touched what it was sent, and the
 * stored row survived. A respondent who deleted a free-text comment kept reading a form
 * that no longer showed it while the server kept it indefinitely. Naming the question is
 * what makes the erasure travel.
 *
 * **Scoped to `serverAnswered`**, so this can only ever ask for the deletion of a row the
 * server is known to hold — never a question that was simply never answered.
 *
 * **Scoped to questions this page can render**, which is the subtle one. `toAnswerInputs`
 * skips an `unsupported` question type, so such a question can never appear in `inputs`;
 * without this filter it would look permanently "taken back" and every save would ask the
 * server to delete an answer some other client had legitimately stored.
 */
export function clearedQuestionIds(
  serverAnswered: ReadonlySet<string>,
  questions: readonly SurveyRespondQuestion[],
  answers: AnswerMap,
): string[] {
  if (serverAnswered.size === 0) return []

  return questions
    .filter(
      (question) =>
        serverAnswered.has(question.id) &&
        answerShapeOf(question) !== 'unsupported' &&
        !isAnswered(question, answers[question.id]),
    )
    .map((question) => question.id)
}

/**
 * A stable string for one answer set, so an autosave can tell "changed" from "changed
 * back" and skip a write that would say nothing.
 *
 * `toAnswerInputs` walks the questions in the order they are asked, so the array order
 * is already deterministic and `JSON.stringify` is enough. It is a comparison key and
 * never leaves the browser.
 */
export function answerSignature(inputs: readonly SurveyAnswerInput[]): string {
  return JSON.stringify(inputs)
}

/**
 * Where a resumed respondent should be put: the first question they have not answered,
 * in the order the questions are asked.
 *
 * **Not `missingRequired`.** That list is the submit gate and skips optional questions,
 * so on a survey whose first eight questions are optional it would send somebody who
 * answered three of them past the five they had not reached. "Where they stopped" is
 * about the form, not about what the server will accept.
 *
 * A question whose type this page cannot render is skipped for the same reason it is
 * skipped by the submit gate: focus would land on an explanation with no control in it,
 * and the respondent would have nothing to do there.
 *
 * Returns null when everything is answered — a real state on resume, and one that must
 * not move focus at all: dropping somebody at the bottom of a form they have finished
 * hides the submit button they came back for.
 */
export function firstUnansweredQuestion(
  questions: readonly SurveyRespondQuestion[],
  answers: AnswerMap,
): SurveyRespondQuestion | null {
  return (
    questions.find(
      (question) =>
        answerShapeOf(question) !== 'unsupported' && !isAnswered(question, answers[question.id]),
    ) ?? null
  )
}
