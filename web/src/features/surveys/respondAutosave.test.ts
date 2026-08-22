import { describe, it, expect } from 'vitest'
import {
  RESPOND_AUTOSAVE_DELAY_MS,
  answerSignature,
  firstUnansweredQuestion,
  hasProgressToSave,
  clearedQuestionIds,
  respondAutosaveAllowed,
} from './respondAutosave'
import { toAnswerInputs, type AnswerMap } from './respondAnswers'
import type {
  SurveyRespondQuestion,
  SurveyRespondView,
  SurveyResponseState,
} from './api/surveyResponses'

/**
 * The rules behind #369, each proved on its own.
 *
 * `SurveyRespondPage.test.tsx` proves the page obeys them — that a debounce fires, that
 * a hidden page writes, that focus lands. This file proves the rules themselves, which
 * is the half a rendered assertion is worst at: "no autosave when the survey turned it
 * off" is one boolean among four, and a form test that happened to render a survey with
 * partial responses already off would pass whatever the other three did.
 */

function question(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return {
    id: 'q1',
    text: 'How satisfied are you?',
    type: 'multiple_choice',
    options: [
      { order: 0, value: 'agree', label: 'Agree' },
      { order: 1, value: 'disagree', label: 'Disagree' },
    ],
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    required: false,
    commentRequired: false,
    commentPrompt: null,
    order: 0,
    category: null,
    ...overrides,
  }
}

function inProgress(overrides: Partial<SurveyResponseState> = {}): SurveyResponseState {
  return {
    responseId: 'r1',
    sessionId: 'session-1',
    isComplete: false,
    language: 'es',
    startTime: '2026-06-01T10:00:00Z',
    completionTime: null,
    answers: [],
    ...overrides,
  }
}

function view(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 's1',
    title: 'Clima laboral 2026',
    description: null,
    type: 'general_climate',
    language: 'both',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-31T00:00:00Z',
    anonymous: true,
    allowPartialResponses: true,
    autoSave: true,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [question()],
    inProgress: null,
    ...overrides,
  }
}

describe('respondAutosaveAllowed', () => {
  it('allows it when the survey takes partial responses and asked for autosave', () => {
    expect(respondAutosaveAllowed(view())).toBe(true)
  })

  /**
   * The server refuses this with a 400 at `SurveyResponseEndpoints`, so autosaving
   * anyway is a request that can only ever fail and an error the respondent did
   * nothing to cause.
   */
  it('refuses it when the survey does not take partial responses', () => {
    expect(respondAutosaveAllowed(view({ allowPartialResponses: false }))).toBe(false)
  })

  /**
   * The setting this page could not see until #369 served it. It is a second gate,
   * which is why it is asserted independently of the one above rather than only in
   * combination — a check that read `allowPartialResponses && something` would pass a
   * test that only ever varied the first.
   */
  it('refuses it when the survey turned autosave off, even though partials are allowed', () => {
    expect(respondAutosaveAllowed(view({ allowPartialResponses: true, autoSave: false }))).toBe(
      false,
    )
  })

  it('refuses it once the response in progress is complete', () => {
    expect(respondAutosaveAllowed(view({ inProgress: inProgress({ isComplete: true }) }))).toBe(
      false,
    )
  })

  it('allows it for a response in progress that is not complete', () => {
    expect(respondAutosaveAllowed(view({ inProgress: inProgress() }))).toBe(true)
  })

  it('refuses it before the payload has arrived', () => {
    expect(respondAutosaveAllowed(null)).toBe(false)
  })
})

describe('hasProgressToSave', () => {
  /**
   * The gate on the very first write. The endpoint accepts an empty partial save and
   * creates a bare `responses` row for it, which is a write per visitor who merely
   * opened the link and — on an identified survey — a record that a named employee
   * opened a survey they never answered.
   */
  it('is false for an untouched form, so no response row is created for a visitor', () => {
    expect(hasProgressToSave(toAnswerInputs([question()], {}))).toBe(false)
  })

  it('is false when a comment exists but the question it belongs to is unanswered', () => {
    const answers: AnswerMap = { q1: { text: 'A thought' } }
    expect(hasProgressToSave(toAnswerInputs([question()], answers))).toBe(false)
  })

  it('is true from the first real answer', () => {
    const answers: AnswerMap = { q1: { value: 'agree' } }
    expect(hasProgressToSave(toAnswerInputs([question()], answers))).toBe(true)
  })

  /**
   * The erasure case, and the reason this is not `inputs.length > 0`. A respondent who
   * takes back the only answer they had produces no inputs at all — and that submission
   * is the one that matters most, because it IS the erasure. Gating on the answers alone
   * is exactly how a taken-back answer used to stay on the server forever.
   */
  it('is true for an erasure that leaves nothing answered, because the deletion still has to travel', () => {
    expect(hasProgressToSave(toAnswerInputs([question()], {}), ['q1'])).toBe(true)
  })
})

describe('clearedQuestionIds', () => {
  it('names a question the server holds an answer for that is no longer answered', () => {
    expect(clearedQuestionIds(new Set(['q1']), [question()], {})).toEqual(['q1'])
  })

  it('names nothing while the answer is still there', () => {
    const answers: AnswerMap = { q1: { value: 'agree' } }
    expect(clearedQuestionIds(new Set(['q1']), [question()], answers)).toEqual([])
  })

  /**
   * A question that was never saved cannot be "taken back". Without this the first save
   * of a 40-question survey would ask the server to delete the 39 not yet reached.
   */
  it('names nothing the server was never told about', () => {
    expect(clearedQuestionIds(new Set(), [question()], {})).toEqual([])
  })

  /**
   * The subtle one. `toAnswerInputs` skips a question type this page cannot render, so
   * such a question can NEVER appear in the payload — and a rule that read "on the server
   * and not in the payload" would therefore mark it deleted on every single save,
   * destroying an answer some other client had legitimately stored.
   */
  it('never asks to delete an answer to a question this page cannot render', () => {
    const unsupported = question({ id: 'q1', type: 'matrix', options: null })
    expect(clearedQuestionIds(new Set(['q1']), [unsupported], {})).toEqual([])
  })
})

describe('answerSignature', () => {
  const questions = [question({ id: 'a', order: 0 }), question({ id: 'b', order: 1 })]

  it('is equal for the same answers, so a re-render costs no write', () => {
    const answers: AnswerMap = { a: { value: 'agree' } }
    expect(answerSignature(toAnswerInputs(questions, answers))).toBe(
      answerSignature(toAnswerInputs(questions, { a: { value: 'agree' } })),
    )
  })

  it('changes when an answer changes', () => {
    const before = answerSignature(toAnswerInputs(questions, { a: { value: 'agree' } }))
    const after = answerSignature(toAnswerInputs(questions, { a: { value: 'disagree' } }))
    expect(after).not.toBe(before)
  })

  /**
   * Answering B then A and answering A then B are the same state, and must cost one
   * write rather than two. `toAnswerInputs` walks the questions in the order they are
   * asked, so the array order does not depend on the order the map was filled in —
   * this pins that, because a signature built from `Object.keys(answers)` would not
   * have it and the failure would be invisible: extra saves, never wrong data.
   */
  it('does not depend on the order the respondent answered in', () => {
    const answeredForwards: AnswerMap = { a: { value: 'agree' }, b: { value: 'disagree' } }
    const answeredBackwards: AnswerMap = { b: { value: 'disagree' }, a: { value: 'agree' } }
    expect(answerSignature(toAnswerInputs(questions, answeredBackwards))).toBe(
      answerSignature(toAnswerInputs(questions, answeredForwards)),
    )
  })
})

describe('firstUnansweredQuestion', () => {
  const questions = [
    question({ id: 'a', order: 0 }),
    question({ id: 'b', order: 1 }),
    question({ id: 'c', order: 2 }),
  ]

  it('is the first question with no answer, in the order they are asked', () => {
    const answers: AnswerMap = { a: { value: 'agree' } }
    expect(firstUnansweredQuestion(questions, answers)?.id).toBe('b')
  })

  it('is the first question of all on a form nobody has touched', () => {
    expect(firstUnansweredQuestion(questions, {})?.id).toBe('a')
  })

  it('is null when every question has an answer, so focus is not moved', () => {
    const answers: AnswerMap = {
      a: { value: 'agree' },
      b: { value: 'agree' },
      c: { value: 'agree' },
    }
    expect(firstUnansweredQuestion(questions, answers)).toBeNull()
  })

  /**
   * Not `missingRequired`. That list is the submit gate, and it skips optional
   * questions — resuming a survey whose first eight questions are optional would send
   * somebody who answered three of them past the five they had not reached.
   */
  it('counts an unanswered OPTIONAL question, which the submit gate does not', () => {
    const optionalThenRequired = [
      question({ id: 'a', order: 0, required: false }),
      question({ id: 'b', order: 1, required: true }),
    ]
    expect(firstUnansweredQuestion(optionalThenRequired, {})?.id).toBe('a')
  })

  /**
   * A question this page cannot render has no control to put a cursor in — a
   * `multiple_choice` with no options is the live shape. Focus would land on an
   * explanation and the respondent would have nothing to do there.
   */
  it('skips a question the form cannot render', () => {
    const unanswerable = [
      question({ id: 'a', order: 0, type: 'multiple_choice', options: [] }),
      question({ id: 'b', order: 1 }),
    ]
    expect(firstUnansweredQuestion(unanswerable, {})?.id).toBe('b')
  })

  /**
   * A ranking counts as unanswered until it has actually been reordered, which is
   * `isAnswered`'s rule and the one that stops a presented order being mistaken for a
   * deliberate one. Pinned here because resume is the place a respondent would
   * otherwise be walked straight past a ranking they never touched.
   */
  it('treats an untouched ranking as unanswered', () => {
    const ranking = [
      question({
        id: 'a',
        order: 0,
        type: 'ranking',
        options: [
          { order: 0, value: 'one', label: 'One' },
          { order: 1, value: 'two', label: 'Two' },
        ],
      }),
    ]
    expect(firstUnansweredQuestion(ranking, {})?.id).toBe('a')
    expect(firstUnansweredQuestion(ranking, { a: { values: ['two', 'one'] } })).toBeNull()
  })
})

describe('RESPOND_AUTOSAVE_DELAY_MS', () => {
  /**
   * A bound rather than an exact value, because the number itself is a judgement.
   * What is not a judgement: a delay of zero saves on every keystroke, and a delay of
   * minutes makes the debounce window the very interruption the feature is for.
   */
  it('is a debounce and not a poll', () => {
    expect(RESPOND_AUTOSAVE_DELAY_MS).toBeGreaterThan(0)
    expect(RESPOND_AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(5000)
  })
})
