/**
 * Frontend mirror of the backend's canonical question-type vocabulary
 * (`ClimateProject.Application.Questions.QuestionTypes`).
 *
 * #196: the backend previously kept `["multiple_choice", "open_text", "rating",
 * "yes_no"]` in `MicroclimateValidation` and this list was duplicated as a literal
 * inside `MicroclimateForm`, with a third copy as `case` labels in
 * `MicroclimateRespondPage`. Three independent copies is how the vocabulary drifted
 * from legacy in the first place, so there is now one per side and both are derived
 * from it.
 *
 * `open_text` was renamed to `open_ended` to match legacy and every other
 * vocabulary in the product; existing rows are migrated by
 * `RenameOpenTextQuestionTypeToOpenEnded`.
 *
 * Keep in step with the backend. There is no build-time link between the two — the
 * contract test in `questionTypes.test.ts` pins this list so a change here is
 * deliberate rather than incidental.
 */
export const QUESTION_TYPES = ['likert', 'multiple_choice', 'open_ended', 'yes_no', 'rating'] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

/**
 * Types answered on a 1-5 scale when the question configures no explicit options.
 * `likert` (agreement) and `rating` (quality) render and validate identically and
 * differ only in meaning, which is why both exist rather than one.
 */
export const NUMERIC_SCALE_TYPES: readonly QuestionType[] = ['likert', 'rating']

/** Default for a newly added question. Free text is the least constrained choice. */
export const DEFAULT_QUESTION_TYPE: QuestionType = 'open_ended'

export function isNumericScale(type: string): boolean {
  return (NUMERIC_SCALE_TYPES as readonly string[]).includes(type)
}
