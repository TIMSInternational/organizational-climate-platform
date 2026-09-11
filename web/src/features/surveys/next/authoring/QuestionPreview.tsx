import type { ReactNode } from 'react'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import type { SurveyRespondQuestion } from '../../api/surveyResponses'
import { dimensionLabel } from '../../dimensionLabel'
import { NUMERIC_SCALE_TYPES, answerShapeOf, choicesFor } from '../../respondAnswers'

/**
 * A question as the respondent will meet it, drawn the way the SurveyBuilder and SurveyDetail
 * artboards draw it: a dimension header ("SEGURIDAD PSICOLÓGICA — 1 de 6"), then a card with the
 * position chip, the text and "(obligatoria)", the answer points in 34px boxes and the author's
 * two anchor words under the ends of the row.
 *
 * The answer points come from the respond page's own rules — `answerShapeOf` and `choicesFor`
 * (`respondAnswers.ts`), the functions `RespondQuestionField` renders from — so a likert with no
 * authored options shows exactly the points the respondent will be offered, a yes/no its two
 * words, and a choice question its resolved labels. It is a picture, not a control: nothing here
 * takes focus or emits an answer, which is why it is not `RespondQuestionField` itself (a live
 * radiogroup on an admin screen would be a control that does nothing).
 */
export function PreviewSection({
  category,
  index,
  count,
  children,
}: {
  category: string | null
  index: number
  count: number
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div data-slot="preview-section" className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        {/* `leading-normal` throughout: the artboards set these 10-11px lines on the body's 1.5
            (15px, 16.5px), where the type scale's snug 1.35 made every preview card 3px short. */}
        <span className="text-2xs font-bold uppercase leading-normal tracking-[0.16em] text-fg-label">
          {category ? dimensionLabel(category, t) : t('surveys.next.preview.noDimension')}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-line-light" />
        <span className="font-mono text-xs leading-normal text-fg-secondary tabular-nums">
          {t('surveys.next.preview.sectionOf', { index, count })}
        </span>
      </div>
      {children}
    </div>
  )
}

export function PreviewQuestion({
  question,
  position,
  total,
}: {
  question: SurveyRespondQuestion
  position: number
  total: number
}) {
  const { t } = useTranslation()
  const { t: tr } = useTranslation('surveyRespond')
  const shape = answerShapeOf(question)
  const numeric = NUMERIC_SCALE_TYPES.includes(question.type) && (question.options?.length ?? 0) === 0
  const choices = shape === 'single' || shape === 'ordered' ? choicesFor(question) : []
  const label = (value: string, text: string | null) =>
    question.type === 'yes_no' ? (value === 'yes' ? tr('yes') : tr('no')) : (text ?? value)

  return (
    <div
      data-slot="preview-question"
      className="flex flex-col gap-2.5 rounded-lg border border-line-default bg-surface-card px-3.5 py-3"
    >
      {/* `items-center`, the artboards' `align-items: center`: baseline alignment pushed the row
          1px past its 19.5px line, and every preview card 1px past the artboard's 118. */}
      <p className="m-0 flex items-center gap-2 text-base font-semibold text-fg-primary">
        <span
          aria-hidden="true"
          className="shrink-0 rounded bg-surface-icon-box px-1.5 py-px font-mono text-xs font-medium leading-normal text-fg-secondary tabular-nums"
        >
          {`${position}/${total}`}
        </span>
        <span className="min-w-0">
          {question.text?.trim() ? question.text : t('surveys.next.preview.noText')}{' '}
          <span className="font-normal text-fg-secondary">
            {question.required ? t('surveys.next.preview.required') : t('surveys.next.preview.optional')}
          </span>
        </span>
      </p>
      {shape === 'text' ? (
        <div aria-hidden="true" className="h-16 rounded border border-line-default bg-surface-card" />
      ) : shape === 'unsupported' ? null : (
        <div className={numeric ? 'flex gap-2' : 'flex flex-wrap gap-2'}>
          {choices.map((choice, index) => (
            <span
              key={choice.value}
              data-slot="preview-choice"
              // 36px: the artboards' cells are `height: 34px` plus a 1px border each side. A numeric
              // row never wraps, so its cells may shrink (`min-w-0`): at 390px five 40px cells ran
              // past the card's right edge (builder-390.png).
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center rounded border border-line-default bg-surface-card px-2 text-base text-fg-secondary',
                numeric ? 'min-w-0' : 'min-w-10',
              )}
            >
              {shape === 'ordered' ? `${index + 1}. ${label(choice.value, choice.label)}` : label(choice.value, choice.label)}
            </span>
          ))}
        </div>
      )}
      {numeric && (question.scaleLabelMin || question.scaleLabelMax) && (
        <div data-slot="preview-anchors" className="flex justify-between gap-2 text-xs leading-normal text-fg-secondary">
          <span>{question.scaleLabelMin ?? ''}</span>
          <span>{question.scaleLabelMax ?? ''}</span>
        </div>
      )}
    </div>
  )
}
