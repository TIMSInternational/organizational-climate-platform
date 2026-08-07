import type { SurveyAnswerInput, SurveyRespondOption, SurveyRespondQuestion, SurveySavedAnswer } from './api/surveyResponses'

/**
 * The pure half of answering a survey: what an answer is, whether a question has
 * one, what order the questions are asked in, and the exact payload the submission
 * endpoint takes.
 *
 * Separated from the page so it can be tested without a DOM, for the same reason
 * `SurveyAnswerValidation` sits in Application rather than in the endpoint: a
 * respondent's answer is the least recoverable thing in the product, and the rules
 * that shape it should be provable directly.
 *
 * **What this module deliberately does NOT do is re-implement the server's
 * validation.** Scale bounds, ranking permutations, yes/no codes and option
 * membership are all decided by `SurveyAnswerValidation`, and a second copy here
 * would eventually disagree with it — offering a control the server then refuses.
 * The approach instead is to make an invalid answer *unrepresentable* by the UI (a
 * radio can only emit a listed option value; a ranking can only be permuted, never
 * truncated) and to let the server be the authority on everything else.
 *
 * The one rule that is genuinely client-side is "which required questions are still
 * unanswered". A form has to know that to put focus and an inline message on the
 * right question, and the server can only answer it with a list of GUIDs inside an
 * English sentence.
 */

/**
 * Frontend mirror of `ClimateProject.Application.Questions.QuestionTypes.ForSurvey`.
 *
 * Not derived from `features/microclimates/questionTypes.ts`: that module mirrors
 * `ForMicroclimate`, which is a different subset — it has no `ranking`, and a survey
 * that asks one would render as an unanswerable text box. Two subsets of one
 * vocabulary, each mirrored beside the feature that uses it, is the shape #196
 * settled on.
 *
 * `emoji_rating` is absent because `ForSurvey` does not contain it. See the note on
 * `answerShapeOf`.
 *
 * Pinned by `respondAnswers.test.ts` so a change here is deliberate rather than
 * incidental.
 */
export const SURVEY_QUESTION_TYPES = [
  'likert',
  'multiple_choice',
  'ranking',
  'open_ended',
  'yes_no',
  'rating',
] as const

export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number]

/** Types answered on a numeric scale when the question configures no option set. */
export const NUMERIC_SCALE_TYPES: readonly string[] = ['likert', 'rating']

/** The scale used when a question configures neither an option set nor bounds. */
export const DEFAULT_SCALE_MIN = 1
export const DEFAULT_SCALE_MAX = 5

/** The two canonical yes/no codes. Codes, not labels — locale-independent by construction. */
export const YES_CODE = 'yes'
export const NO_CODE = 'no'

/**
 * How a question is answered, which is the only thing rendering and payload-building
 * need to know about its type.
 *
 * `unsupported` covers two real cases rather than being defensive noise. A question
 * whose type is outside `ForSurvey` — `emoji_rating` is the live example, valid in
 * the vocabulary but not on a survey — cannot be answered through the submission
 * endpoint, which rejects it explicitly. And a `multiple_choice` question with no
 * options is unanswerable by construction: the server refuses free text there
 * precisely so an unanswerable question cannot come to look answered.
 */
export type AnswerShape = 'single' | 'text' | 'ordered' | 'unsupported'

export function answerShapeOf(question: SurveyRespondQuestion): AnswerShape {
  const options = question.options ?? []
  switch (question.type) {
    case 'open_ended':
      return 'text'
    case 'ranking':
      return options.length > 0 ? 'ordered' : 'unsupported'
    case 'yes_no':
      return 'single'
    case 'multiple_choice':
      return options.length > 0 ? 'single' : 'unsupported'
    case 'likert':
    case 'rating':
      return 'single'
    default:
      return 'unsupported'
  }
}

/**
 * The choices a single-valued question offers, as stable values with display labels.
 *
 * For `yes_no` the two codes; for a question with a configured option set, that set;
 * for a bare numeric scale, the points between its bounds. Every one of them carries
 * the value the server stores, never the label the respondent reads.
 */
export function choicesFor(question: SurveyRespondQuestion): SurveyRespondOption[] {
  if (question.type === 'yes_no') {
    return [
      { order: 0, value: YES_CODE, label: null },
      { order: 1, value: NO_CODE, label: null },
    ]
  }

  const options = question.options ?? []
  if (options.length > 0) return options

  if (!NUMERIC_SCALE_TYPES.includes(question.type)) return []

  const min = question.scaleMin ?? DEFAULT_SCALE_MIN
  const max = question.scaleMax ?? DEFAULT_SCALE_MAX
  if (max < min) return []

  const points: SurveyRespondOption[] = []
  for (let point = min; point <= max; point += 1) {
    const value = String(point)
    points.push({ order: point - min, value, label: value })
  }
  return points
}

/** One question's answer as the form holds it. `values` is a ranking; `value` everything else. */
export interface AnswerState {
  value?: string
  values?: string[]
  /** The respondent's free-text comment. Never set on an `open_ended` question. */
  text?: string
}

export type AnswerMap = Record<string, AnswerState>

/**
 * Restores a response in progress into form state.
 *
 * An `open_ended` answer arrives with the text in `value` (the answer *is* the text)
 * and also echoed in `text`, so the comment slot is deliberately left empty for it —
 * otherwise resuming would show the answer twice and submit it as a comment the
 * server then rejects.
 */
export function hydrateAnswers(saved: readonly SurveySavedAnswer[]): AnswerMap {
  const answers: AnswerMap = {}
  for (const answer of saved) {
    const state: AnswerState = {}
    if (answer.values && answer.values.length > 0) {
      state.values = [...answer.values]
      if (answer.text) state.text = answer.text
    } else if (answer.value !== null && answer.value !== undefined) {
      state.value = answer.value
      if (answer.text && answer.text !== answer.value) state.text = answer.text
    }
    if (state.value !== undefined || state.values !== undefined || state.text !== undefined) {
      answers[answer.questionId] = state
    }
  }
  return answers
}

/**
 * Whether a question has an answer worth submitting.
 *
 * A comment alone is not one: the server rejects an answer whose value is empty and
 * tells the caller to omit the question entirely, so a comment on an unanswered
 * question has nowhere to go. The form makes that visible rather than dropping it
 * silently — the comment box stays read-only until the question itself is answered.
 *
 * A ranking counts as answered only once the respondent has actually reordered it.
 * Treating the order it happened to be presented in as a deliberate ranking would
 * fabricate an answer for every required ranking a respondent skipped, and it would
 * be indistinguishable from a real one afterwards.
 */
export function isAnswered(question: SurveyRespondQuestion, answer: AnswerState | undefined): boolean {
  if (!answer) return false
  if (answerShapeOf(question) === 'ordered') {
    return (answer.values?.length ?? 0) > 0
  }
  return (answer.value ?? '').trim().length > 0
}

export function answeredCount(
  questions: readonly SurveyRespondQuestion[],
  answers: AnswerMap,
): number {
  return questions.filter((question) => isAnswered(question, answers[question.id])).length
}

/** The ids of required questions still unanswered, in the order they are asked. */
export function missingRequired(
  questions: readonly SurveyRespondQuestion[],
  answers: AnswerMap,
): string[] {
  return questions
    .filter(
      (question) =>
        question.required &&
        answerShapeOf(question) !== 'unsupported' &&
        !isAnswered(question, answers[question.id]),
    )
    .map((question) => question.id)
}

/**
 * The submission payload.
 *
 * Unanswered questions are omitted rather than sent empty, which is exactly what the
 * endpoint asks for. An `open_ended` answer goes in `value` and carries no separate
 * comment, because its answer already *is* its text — sending both would leave two
 * free-text fields on one question with nothing saying which one a word cloud or an
 * export should read, and the server refuses it.
 */
export function toAnswerInputs(
  questions: readonly SurveyRespondQuestion[],
  answers: AnswerMap,
): SurveyAnswerInput[] {
  const inputs: SurveyAnswerInput[] = []

  for (const question of questions) {
    const answer = answers[question.id]
    if (!isAnswered(question, answer) || !answer) continue

    const shape = answerShapeOf(question)
    if (shape === 'unsupported') continue

    const comment = shape === 'text' ? undefined : answer.text?.trim() || undefined

    if (shape === 'ordered') {
      inputs.push({ questionId: question.id, values: [...(answer.values ?? [])], ...(comment ? { text: comment } : {}) })
      continue
    }

    inputs.push({
      questionId: question.id,
      value: (answer.value ?? '').trim(),
      ...(comment ? { text: comment } : {}),
    })
  }

  return inputs
}

// ---------------------------------------------------------------------------
// Question order
// ---------------------------------------------------------------------------

/** xmur3 — a string to a 32-bit seed. */
function seedFrom(text: string): number {
  let hash = 1779033703 ^ text.length
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }
  return hash >>> 0
}

/** mulberry32 — a seeded generator, so the same seed always gives the same order. */
function randomFrom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The order the questions are asked in, honouring `Survey.Settings.RandomizeQuestions`.
 *
 * The shuffle is **seeded by the survey id**, not by `Math.random`. A respondent who
 * saves progress and comes back a day later, or simply reloads, must see the same
 * order they left — a re-shuffle on every mount would move the question they were
 * halfway through and make a partially answered survey feel corrupted. Deterministic
 * also means the order is assertable in a test rather than merely "different
 * sometimes".
 *
 * The order is per-survey rather than per-respondent, which is the honest limit of
 * doing this client-side: it removes the ordering bias between *questions* that
 * randomisation exists for, and does not vary between people. Varying per respondent
 * would need the order recorded server-side, since it must survive a reload.
 */
export function orderQuestions(
  questions: readonly SurveyRespondQuestion[],
  randomize: boolean,
  seed: string,
): SurveyRespondQuestion[] {
  const ordered = [...questions].sort((left, right) => left.order - right.order)
  if (!randomize || ordered.length < 2) return ordered

  const next = randomFrom(seedFrom(seed))
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1))
    ;[ordered[index], ordered[swap]] = [ordered[swap], ordered[index]]
  }
  return ordered
}

/** Moves one entry of a ranking, clamped at the ends. Returns a new array. */
export function moveRankingEntry(order: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= order.length || to < 0 || to >= order.length) {
    return [...order]
  }
  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
