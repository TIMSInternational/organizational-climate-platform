import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RespondQuestionField from './RespondQuestionField'
import { TranslationProvider } from '../../../i18n'
import type { SurveyRespondQuestion } from '../api/surveyResponses'

/**
 * Which end of a scale wears which face.
 *
 * ## The defect this exists for
 *
 * The faces used to be placed by POSITION -- `index === 0` got the frown, the last index
 * got the smile -- which reads the display order as the scale's direction. That is true
 * only of a scale authored worst-to-best.
 *
 * EAGLE's instrument is authored best-to-worst, because the client asked for the
 * positives first. On 2026-10-19 its live QR survey therefore showed a FROWN beside
 * "Totalmente de acuerdo" and a SMILE beside "Totalmente en desacuerdo", on all 79 likert
 * questions, to respondents who are operarios scanning a code on a plant floor. Nothing
 * caught it: the suite has no layout engine, every assertion was green, and the defect was
 * found by opening the link in a browser.
 *
 * So the faces follow the option's VALUE -- the stable scale point that lands in
 * `question_responses.response_value` -- and the author may order the list either way.
 */
const likert = (options: { value: string; label: string }[]): SurveyRespondQuestion => ({
  id: '11111111-1111-1111-1111-111111111111',
  text: 'Conozco las normas y políticas de la empresa relacionadas con mi puesto.',
  type: 'likert',
  options: options.map((option, order) => ({ order, value: option.value, label: option.label })),
  scaleMin: 1,
  scaleMax: 5,
  scaleLabelMin: null,
  scaleLabelMax: null,
  required: true,
  commentRequired: false,
  commentPrompt: null,
  order: 0,
  category: 'Administración',
})

const AGREE_FIRST = [
  { value: '5', label: 'Totalmente de acuerdo' },
  { value: '4', label: 'De acuerdo' },
  { value: '3', label: 'Ni de acuerdo ni en desacuerdo' },
  { value: '2', label: 'En desacuerdo' },
  { value: '1', label: 'Totalmente en desacuerdo' },
]

function draw(question: SurveyRespondQuestion) {
  return render(
    <TranslationProvider>
      <RespondQuestionField
        question={question}
        position={1}
        total={82}
        dimension="Administración"
        answer={undefined}
        invalid={false}
        disabled={false}
        onChange={() => {}}
        onAnnounce={() => {}}
      />
    </TranslationProvider>,
  )
}

/** The label of the choice whose cell holds the given face. */
function labelWearing(container: HTMLElement, slot: 'scale-least' | 'scale-most'): string {
  const face = container.querySelector(`[data-slot="${slot}"]`)
  expect(face, `no [data-slot="${slot}"] was rendered`).not.toBeNull()
  const cell = face!.closest('[data-slot="respond-choice"]')
  expect(cell, 'the face is not inside a choice cell').not.toBeNull()
  return (cell!.textContent ?? '').trim()
}

describe('RespondQuestionField, the scale faces', () => {
  afterEach(cleanup)

  it('puts the frown on the LOWEST value and the smile on the HIGHEST when the positives are listed first', () => {
    const { container } = draw(likert(AGREE_FIRST))

    expect(labelWearing(container, 'scale-least')).toContain('Totalmente en desacuerdo')
    expect(labelWearing(container, 'scale-most')).toContain('Totalmente de acuerdo')
  })

  it('still puts them on the ends when the scale is authored the usual way round', () => {
    const { container } = draw(likert([...AGREE_FIRST].reverse()))

    expect(labelWearing(container, 'scale-least')).toContain('Totalmente en desacuerdo')
    expect(labelWearing(container, 'scale-most')).toContain('Totalmente de acuerdo')
  })

  it('wears exactly two faces, whatever the order', () => {
    const { container } = draw(likert(AGREE_FIRST))

    expect(container.querySelectorAll('[data-slot="scale-least"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="scale-most"]')).toHaveLength(1)
  })

  it('falls back to first-and-last for a scale whose codes are words, which have no order', () => {
    const { container } = draw(
      likert([
        { value: 'nunca', label: 'Nunca' },
        { value: 'a_veces', label: 'A veces' },
        { value: 'siempre', label: 'Siempre' },
      ]),
    )

    expect(labelWearing(container, 'scale-least')).toContain('Nunca')
    expect(labelWearing(container, 'scale-most')).toContain('Siempre')
  })

  it('gives a multiple_choice question no faces: its options are alternatives, not a scale', () => {
    const { container } = draw({
      ...likert(AGREE_FIRST),
      type: 'multiple_choice',
    })

    expect(container.querySelector('[data-slot="scale-least"]')).toBeNull()
    expect(container.querySelector('[data-slot="scale-most"]')).toBeNull()
  })

  it('renders every choice the author wrote, in the author\'s order', () => {
    draw(likert(AGREE_FIRST))

    const labels = screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))
    expect(labels).toEqual(['5', '4', '3', '2', '1'])
  })
})
