import { describe, it, expect } from 'vitest'
import {
  NUMERIC_SCALE_TYPES,
  SURVEY_QUESTION_TYPES,
  answerShapeOf,
  answeredCount,
  choicesFor,
  hydrateAnswers,
  isAnswered,
  missingRequired,
  moveRankingEntry,
  orderQuestions,
  toAnswerInputs,
  type AnswerMap,
} from './respondAnswers'
import type { SurveyRespondQuestion } from './api/surveyResponses'

function question(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return {
    id: 'q1',
    text: 'How is it going?',
    type: 'multiple_choice',
    options: [
      { order: 0, value: 'agree', label: 'De acuerdo' },
      { order: 1, value: 'disagree', label: 'En desacuerdo' },
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

describe('the survey question vocabulary', () => {
  /**
   * Pinned against `QuestionTypes.ForSurvey`. A silent divergence here is exactly the
   * #196 failure: the frontend renders a type the backend refuses, or refuses one it
   * accepts, and neither side errors.
   */
  it('mirrors QuestionTypes.ForSurvey exactly', () => {
    expect([...SURVEY_QUESTION_TYPES].sort()).toEqual(
      ['likert', 'multiple_choice', 'open_ended', 'ranking', 'rating', 'yes_no'].sort(),
    )
  })

  it('does not include emoji_rating, which is not a survey type', () => {
    expect(SURVEY_QUESTION_TYPES).not.toContain('emoji_rating')
  })

  it('treats a type outside the vocabulary as unanswerable rather than as free text', () => {
    expect(answerShapeOf(question({ type: 'emoji_rating' }))).toBe('unsupported')
  })

  it('scales likert and rating alike', () => {
    expect([...NUMERIC_SCALE_TYPES].sort()).toEqual(['likert', 'rating'])
  })
})

describe('answerShapeOf', () => {
  it('gives multiple_choice with no options nowhere to put an answer', () => {
    // The server refuses free text on a multiple_choice question precisely so an
    // unanswerable question cannot come to look answered. Rendering a text box here
    // would produce answers the endpoint then rejects one at a time.
    expect(answerShapeOf(question({ options: [] }))).toBe('unsupported')
    expect(answerShapeOf(question({ options: null }))).toBe('unsupported')
  })

  it('gives ranking with no options nowhere to put an answer either', () => {
    expect(answerShapeOf(question({ type: 'ranking', options: [] }))).toBe('unsupported')
  })

  it('answers likert and rating even with no options, because they fall back to a scale', () => {
    expect(answerShapeOf(question({ type: 'likert', options: null }))).toBe('single')
    expect(answerShapeOf(question({ type: 'rating', options: null }))).toBe('single')
  })

  it('answers yes_no with no options at all', () => {
    expect(answerShapeOf(question({ type: 'yes_no', options: null }))).toBe('single')
  })
})

describe('choicesFor', () => {
  it('offers the locale-independent yes/no codes, never translated words', () => {
    expect(choicesFor(question({ type: 'yes_no', options: null })).map((c) => c.value)).toEqual([
      'yes',
      'no',
    ])
  })

  it('falls back to 1-5 when a scale question configures no bounds', () => {
    const points = choicesFor(question({ type: 'likert', options: null }))
    expect(points.map((point) => point.value)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('honours the question own bounds', () => {
    const points = choicesFor(
      question({ type: 'rating', options: null, scaleMin: 0, scaleMax: 3 }),
    )
    expect(points.map((point) => point.value)).toEqual(['0', '1', '2', '3'])
  })

  it('prefers a configured option set over the scale fallback', () => {
    const points = choicesFor(question({ type: 'likert', scaleMin: 1, scaleMax: 5 }))
    expect(points.map((point) => point.value)).toEqual(['agree', 'disagree'])
  })
})

describe('isAnswered', () => {
  it('does not count a comment as an answer', () => {
    // The endpoint rejects an answer whose value is empty and tells the caller to omit
    // the question, so a comment with nothing to attach to has nowhere to go.
    expect(isAnswered(question(), { text: 'some thoughts' })).toBe(false)
  })

  it('does not count whitespace as an answer', () => {
    expect(isAnswered(question({ type: 'open_ended', options: null }), { value: '   ' })).toBe(false)
  })

  /**
   * The one that matters. A ranking arrives with its options in *some* order, and
   * treating that presentation order as a deliberate ranking would fabricate an
   * answer for every required ranking a respondent skipped — indistinguishable
   * afterwards from one they really gave.
   */
  it('does not count an untouched ranking as answered', () => {
    const ranking = question({ type: 'ranking' })
    expect(isAnswered(ranking, undefined)).toBe(false)
    expect(isAnswered(ranking, { values: [] })).toBe(false)
    expect(isAnswered(ranking, { values: ['disagree', 'agree'] })).toBe(true)
  })
})

describe('missingRequired', () => {
  const required = question({ id: 'a', required: true })
  const optional = question({ id: 'b', required: false, order: 1 })

  it('lists required questions with no answer, in the order they are asked', () => {
    expect(missingRequired([required, optional], {})).toEqual(['a'])
  })

  it('does not demand an answer to a question that cannot be answered', () => {
    const broken = question({ id: 'c', required: true, options: [] })
    expect(missingRequired([broken], {})).toEqual([])
  })

  it('is satisfied by an answer', () => {
    expect(missingRequired([required], { a: { value: 'agree' } })).toEqual([])
  })
})

describe('answeredCount', () => {
  it('counts only questions with a real answer', () => {
    const questions = [question({ id: 'a' }), question({ id: 'b', order: 1 })]
    const answers: AnswerMap = { a: { value: 'agree' }, b: { text: 'just a comment' } }
    expect(answeredCount(questions, answers)).toBe(1)
  })
})

describe('toAnswerInputs', () => {
  it('submits the stable option value, never the label the respondent read', () => {
    const inputs = toAnswerInputs([question()], { q1: { value: 'agree' } })
    expect(inputs).toEqual([{ questionId: 'q1', value: 'agree' }])
    expect(JSON.stringify(inputs)).not.toContain('De acuerdo')
  })

  it('omits an unanswered question entirely rather than sending an empty value', () => {
    expect(toAnswerInputs([question()], {})).toEqual([])
    expect(toAnswerInputs([question()], { q1: { value: '' } })).toEqual([])
  })

  it('puts an open-ended answer in value and sends no separate comment', () => {
    // The endpoint refuses both on one question: its answer already IS its text, and
    // two free-text fields leave nothing saying which a word cloud should read.
    const open = question({ type: 'open_ended', options: null })
    const inputs = toAnswerInputs([open], { q1: { value: 'It is going well', text: 'ignored' } })
    expect(inputs).toEqual([{ questionId: 'q1', value: 'It is going well' }])
  })

  it('sends a ranking as the ordered values', () => {
    const ranking = question({ type: 'ranking' })
    const inputs = toAnswerInputs([ranking], { q1: { values: ['disagree', 'agree'] } })
    expect(inputs).toEqual([{ questionId: 'q1', values: ['disagree', 'agree'] }])
  })

  it('carries a comment alongside an answered choice', () => {
    const inputs = toAnswerInputs([question()], { q1: { value: 'agree', text: ' because ' } })
    expect(inputs).toEqual([{ questionId: 'q1', value: 'agree', text: 'because' }])
  })

  it('drops a whitespace-only comment rather than storing it', () => {
    const inputs = toAnswerInputs([question()], { q1: { value: 'agree', text: '   ' } })
    expect(inputs).toEqual([{ questionId: 'q1', value: 'agree' }])
  })

  it('skips a question the client cannot render an answer for', () => {
    const broken = question({ options: [] })
    expect(toAnswerInputs([broken], { q1: { value: 'anything' } })).toEqual([])
  })
})

describe('hydrateAnswers', () => {
  it('restores a saved single answer', () => {
    expect(hydrateAnswers([{ questionId: 'q1', value: 'agree', values: null, text: null, timeSpentSeconds: null }]))
      .toEqual({ q1: { value: 'agree' } })
  })

  it('restores a saved ranking', () => {
    expect(
      hydrateAnswers([
        { questionId: 'q1', value: null, values: ['b', 'a'], text: null, timeSpentSeconds: null },
      ]),
    ).toEqual({ q1: { values: ['b', 'a'] } })
  })

  /**
   * An open-ended answer comes back with the same text in BOTH columns, because the
   * answer is the text. Restoring it into the comment slot as well would show it
   * twice and then submit it as a comment the endpoint rejects.
   */
  it('does not restore an open-ended answer into the comment slot as well', () => {
    expect(
      hydrateAnswers([
        { questionId: 'q1', value: 'my answer', values: null, text: 'my answer', timeSpentSeconds: null },
      ]),
    ).toEqual({ q1: { value: 'my answer' } })
  })

  it('restores a genuine comment', () => {
    expect(
      hydrateAnswers([
        { questionId: 'q1', value: 'agree', values: null, text: 'because', timeSpentSeconds: null },
      ]),
    ).toEqual({ q1: { value: 'agree', text: 'because' } })
  })
})

describe('orderQuestions', () => {
  const questions = [
    question({ id: 'a', order: 2 }),
    question({ id: 'b', order: 0 }),
    question({ id: 'c', order: 1 }),
  ]

  it('asks in the authored order when randomisation is off', () => {
    expect(orderQuestions(questions, false, 'survey-1').map((q) => q.id)).toEqual(['b', 'c', 'a'])
  })

  /**
   * The property that matters more than the shuffle itself: a respondent who saves
   * progress and comes back must see the same order. A `Math.random` shuffle would
   * move the question they were halfway through on every reload.
   */
  it('produces the same order every time for the same survey', () => {
    const first = orderQuestions(questions, true, 'survey-1').map((q) => q.id)
    const second = orderQuestions(questions, true, 'survey-1').map((q) => q.id)
    expect(second).toEqual(first)
  })

  it('produces a different order for a different survey', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6'].map((seed) =>
      orderQuestions(questions, true, seed).map((q) => q.id).join(),
    )
    expect(new Set(seeds).size).toBeGreaterThan(1)
  })

  it('loses no question and invents none', () => {
    const shuffled = orderQuestions(questions, true, 'survey-1').map((q) => q.id)
    expect([...shuffled].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('moveRankingEntry', () => {
  it('moves an entry and keeps the rest in order', () => {
    expect(moveRankingEntry(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op past either end, so a ranking stays a permutation', () => {
    expect(moveRankingEntry(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveRankingEntry(['a', 'b'], 1, 2)).toEqual(['a', 'b'])
  })
})
