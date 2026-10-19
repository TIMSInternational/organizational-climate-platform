import { describe, it, expect } from 'vitest'
import {
  NUMERIC_SCALE_TYPES,
  SURVEY_QUESTION_TYPES,
  answerShapeOf,
  answeredCount,
  choicesFor,
  commentIsRequired,
  hydrateAnswers,
  isAnswered,
  missingRequired,
  missingRequiredComments,
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

  /**
   * The open question is asked LAST even when the survey randomises, and that is the
   * whole point of these three.
   *
   * ESPH's climate instrument asks its one open question at order 63 of 63, and the
   * reviewer's screenshot of it there is what made the position look settled. It was
   * only settled because that rehearsal was not randomised: turning randomisation on
   * for every ESPH survey put question 63 anywhere from 1/63 to 63/63, which nobody
   * asked for and nobody would have seen until a respondent hit it first.
   *
   * Several seeds rather than one, because a single seed can leave the open question
   * last by luck -- it is 1 in 8 here -- and would then pass against the shuffle this
   * fix replaced.
   */
  const SEEDS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']

  function withOpenInTheMiddle(): SurveyRespondQuestion[] {
    return [
      question({ id: 'c1', order: 0 }),
      question({ id: 'c2', order: 1 }),
      question({ id: 'c3', order: 2 }),
      question({ id: 'open', order: 3, type: 'open_ended', options: null }),
      question({ id: 'c4', order: 4 }),
      question({ id: 'c5', order: 5 }),
      question({ id: 'c6', order: 6 }),
      question({ id: 'c7', order: 7 }),
    ]
  }

  it('asks the open question last under every seed, wherever it was authored', () => {
    const asked = SEEDS.map((seed) => orderQuestions(withOpenInTheMiddle(), true, seed).map((q) => q.id))

    for (const order of asked) {
      expect(order[order.length - 1], `seed order: ${order.join()}`).toBe('open')
      // Last, not merely present once at the end: a shuffle that duplicated it would
      // satisfy the line above.
      expect(order.filter((id) => id === 'open')).toHaveLength(1)
      expect([...order].sort()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'open'])
    }

    // And the closed questions are still shuffled: holding the open one back must not
    // have cost the randomisation it was held back from. Different seeds, different
    // orders -- otherwise this whole block would pass against a function that returned
    // the authored order and never shuffled at all.
    expect(new Set(asked.map((order) => order.join())).size).toBeGreaterThan(1)
  })

  /**
   * ESPH's Teletrabajo instrument asks two open questions, at orders 11 and 15 of 15.
   * "Last" has to mean both of them, in the order their author wrote them in -- one at
   * the end and one still buried in the shuffle would be the same defect, half fixed.
   */
  it('asks TWO open questions last, in their authored order', () => {
    const questions: SurveyRespondQuestion[] = [
      ...Array.from({ length: 10 }, (_unused, index) => question({ id: `c${index}`, order: index })),
      question({ id: 'open-11', order: 10, type: 'open_ended', options: null }),
      question({ id: 'c11', order: 11 }),
      question({ id: 'c12', order: 12 }),
      question({ id: 'c13', order: 13 }),
      question({ id: 'open-15', order: 14, type: 'open_ended', options: null }),
    ]

    for (const seed of SEEDS) {
      const asked = orderQuestions(questions, true, seed).map((q) => q.id)
      expect(asked.slice(-2), `seed order: ${asked.join()}`).toEqual(['open-11', 'open-15'])
      expect(asked).toHaveLength(15)
    }
  })

  /**
   * The exception is scoped to the shuffle. With randomisation off, the authored order
   * IS the order asked, open questions included -- an author who put free text at 11 of
   * 15 chose that, and this function has no business overruling them.
   */
  it('leaves an open question where its author put it when randomisation is off', () => {
    const asked = orderQuestions(withOpenInTheMiddle(), false, 's1').map((q) => q.id)
    expect(asked).toEqual(['c1', 'c2', 'c3', 'open', 'c4', 'c5', 'c6', 'c7'])
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

describe('commentIsRequired', () => {
  /** A question whose author wrote a prompt AND asked for it to be filled. */
  const asked = { commentPrompt: 'Comente brevemente las razones de su respuesta:', commentRequired: true }

  it('is the prompt AND the flag, never the flag alone', () => {
    expect(commentIsRequired(question(asked))).toBe(true)

    // The flag's DDL default is `true`, so on its own it is every question ever written.
    // Without a prompt there is no box, and a box nobody can see cannot be required.
    expect(commentIsRequired(question({ commentRequired: true, commentPrompt: null }))).toBe(false)
    expect(commentIsRequired(question({ ...asked, commentRequired: false }))).toBe(false)
  })

  it('is never asked of an open question, which renders no comment box at all', () => {
    // Its answer already IS its text, and `toAnswerInputs` sends no separate comment for
    // it -- a required comment there would be unsatisfiable.
    expect(commentIsRequired(question({ ...asked, type: 'open_ended', options: null }))).toBe(false)
  })

  it('is never asked of a question this build cannot render', () => {
    expect(commentIsRequired(question({ ...asked, type: 'not_a_type_we_know' }))).toBe(false)
  })
})

describe('missingRequiredComments', () => {
  const asked = { commentPrompt: 'Comente brevemente las razones de su respuesta:', commentRequired: true }

  it('names an answered question whose required comment is blank', () => {
    const q = question({ id: 'q12', ...asked })
    expect(missingRequiredComments([q], { q12: { value: 'agree' } })).toEqual(['q12'])
    expect(missingRequiredComments([q], { q12: { value: 'agree', text: '   ' } })).toEqual(['q12'])
  })

  it('is satisfied by any non-blank comment', () => {
    const q = question({ id: 'q12', ...asked })
    expect(missingRequiredComments([q], { q12: { value: 'agree', text: 'Rindo mas en casa.' } })).toEqual([])
  })

  it('asks nothing of a question nobody answered', () => {
    // Either it is required and `missingRequired` already has it, or it is optional and
    // skipped -- and demanding an explanation for an answer nobody gave would make an
    // optional question impossible to leave alone. It matches the box, which is read-only
    // until the question is answered.
    const q = question({ id: 'q12', ...asked })
    expect(missingRequiredComments([q], {})).toEqual([])
    expect(missingRequiredComments([q], { q12: { value: '' } })).toEqual([])
  })

  it('leaves every question whose comment the author did not require', () => {
    const optional = question({ id: 'q1', commentPrompt: 'Anything to add?', commentRequired: false })
    expect(missingRequiredComments([optional], { q1: { value: 'agree' } })).toEqual([])
  })

  it('returns the ids in the order the questions are asked', () => {
    const a = question({ id: 'a', ...asked })
    const b = question({ id: 'b', ...asked })
    const answers = { a: { value: 'agree' }, b: { value: 'agree' } }
    expect(missingRequiredComments([a, b], answers)).toEqual(['a', 'b'])
    expect(missingRequiredComments([b, a], answers)).toEqual(['b', 'a'])
  })
})
