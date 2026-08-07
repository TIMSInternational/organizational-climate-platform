import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Textarea } from '../../../components/ui'
import {
  answerShapeOf,
  choicesFor,
  isAnswered,
  moveRankingEntry,
  type AnswerState,
} from '../respondAnswers'
import { questionErrorId, questionFieldId, questionLegendId, rankButtonId } from '../respondFieldIds'
import type { SurveyRespondQuestion } from '../api/surveyResponses'

export interface RespondQuestionFieldProps {
  question: SurveyRespondQuestion
  /** 1-based position as asked, which is not `question.order` once randomisation is on. */
  position: number
  total: number
  answer: AnswerState | undefined
  /** True once a submit attempt found this required question unanswered. */
  invalid: boolean
  disabled: boolean
  onChange: (next: AnswerState) => void
  /** Routed to the page's live region, for changes that move nothing visible into focus. */
  onAnnounce: (message: string) => void
}

/**
 * One question, rendered as the respondent answers it.
 *
 * ## Native radios, not the Radix `RadioGroup`
 *
 * A `<fieldset>` with a real `<legend>` is the only construct that names a group of
 * radios to a screen reader without an `aria-label` duplicating the question text,
 * and native `<input type="radio">` gives arrow-key navigation, roving focus and
 * label association for free. `index.css` already styles both in the element layer,
 * with `accent-color: var(--admin-accent-blue)`, so they are themed in light and dark
 * without a single class here. `MicroclimateRespondPage` set the same precedent.
 *
 * ## Every control emits the stable option value
 *
 * The radio's `value`, the ranking's entries — all of them are
 * `SurveyQuestionOptionDto.Value`, never the label the respondent read. Submitting
 * the label is what makes the same answer given in Spanish and in English into two
 * unrelated groups that reconcile by row count and disagree by meaning (#195).
 */
export default function RespondQuestionField({
  question,
  position,
  total,
  answer,
  invalid,
  disabled,
  onChange,
  onAnnounce,
}: RespondQuestionFieldProps) {
  const { t } = useTranslation('surveyRespond')
  const shape = answerShapeOf(question)
  const answered = isAnswered(question, answer)
  const errorId = questionErrorId(question.id)
  const legendId = questionLegendId(question.id)

  return (
    <fieldset
      id={questionFieldId(question.id)}
      // Focusable only programmatically: the page moves focus here when a submit
      // attempt finds this required question unanswered, so the respondent lands on
      // the question rather than on a summary they then have to hunt from.
      tabIndex={-1}
      className="rounded-xl border border-line-panel bg-surface-card p-card"
    >
      <legend id={legendId} className="px-inline text-base font-medium text-fg-primary">
        <span className="mr-inline text-sm text-fg-secondary">
          {t('questionPosition', { position, total })}
        </span>
        {question.text ?? t('untitledQuestion')}{' '}
        {/* The WORD carries whether an answer is required, not a colour. WCAG 1.4.1
            wants that anyway, and `text-accent-red` measures 4.43:1 on the card
            surface in the dark palette — under AA for text this size, and exactly
            the light-passes/dark-fails asymmetry this project keeps shipping. */}
        <span className="font-normal text-fg-secondary">
          {question.required ? t('requiredMarker') : t('optionalMarker')}
        </span>
      </legend>

      {invalid && (
        // Soft red fill with primary ink, the treatment `alertVariants` already uses,
        // rather than red text on the card: measured, that pair clears AA in both
        // palettes (16.6:1 light, 12.7:1 dark) where red-on-card does not in dark.
        <p
          id={errorId}
          role="alert"
          className="mt-inline rounded-md border border-accent-red-ring bg-accent-red-soft px-inline py-1 text-sm text-fg-primary"
        >
          {t('answerRequired')}
        </p>
      )}

      {shape === 'unsupported' ? (
        <p role="alert" className="mt-row text-sm text-fg-secondary">
          {t('questionNotAnswerable')}
        </p>
      ) : shape === 'text' ? (
        <TextAnswer
          question={question}
          answer={answer}
          disabled={disabled}
          invalid={invalid}
          errorId={errorId}
          onChange={onChange}
        />
      ) : shape === 'ordered' ? (
        <RankingAnswer
          question={question}
          answer={answer}
          disabled={disabled}
          invalid={invalid}
          errorId={errorId}
          legendId={legendId}
          onChange={onChange}
          onAnnounce={onAnnounce}
        />
      ) : (
        <ChoiceAnswer
          question={question}
          answer={answer}
          disabled={disabled}
          invalid={invalid}
          errorId={errorId}
          onChange={onChange}
        />
      )}

      {shape !== 'text' && shape !== 'unsupported' && question.commentPrompt && (
        <CommentField
          question={question}
          answer={answer}
          answered={answered}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </fieldset>
  )
}

interface AnswerControlProps {
  question: SurveyRespondQuestion
  answer: AnswerState | undefined
  disabled: boolean
  invalid: boolean
  errorId: string
  onChange: (next: AnswerState) => void
}

function TextAnswer({ question, answer, disabled, invalid, errorId, onChange }: AnswerControlProps) {
  const { t } = useTranslation('surveyRespond')
  const inputId = `${questionFieldId(question.id)}-text`

  return (
    <div className="mt-row">
      {/* The legend names the fieldset, not this control, so the textarea gets its
          own label. Visually hidden rather than omitted: an unlabelled textarea is
          announced as "edit text, blank" with no indication of what it is for. */}
      <label htmlFor={inputId} className="sr-only">
        {question.text ?? t('untitledQuestion')}
      </label>
      <Textarea
        id={inputId}
        value={answer?.value ?? ''}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => onChange({ ...answer, value: event.target.value })}
      />
    </div>
  )
}

function ChoiceAnswer({ question, answer, disabled, invalid, errorId, onChange }: AnswerControlProps) {
  const { t } = useTranslation('surveyRespond')
  const choices = choicesFor(question)
  const scaleEnds = question.scaleLabelMin || question.scaleLabelMax
  // A yes/no question has two codes and no authored labels, so its copy comes from
  // the catalogue. Everything else shows the label the server resolved, falling back
  // to the stable value only when a translation is genuinely missing.
  const labelFor = (value: string, label: string | null): string => {
    if (question.type === 'yes_no') return value === 'yes' ? t('yes') : t('no')
    return label ?? value
  }

  return (
    <div className="mt-row">
      <div
        className={
          question.type === 'multiple_choice' ? 'grid gap-row' : 'flex flex-wrap gap-x-section gap-y-row'
        }
      >
        {choices.map((choice, index) => {
          const inputId = `${questionFieldId(question.id)}-choice-${index}`
          return (
            // `<label>` wraps nothing here: `htmlFor` keeps the hit target on the
            // text without nesting the input, which is what lets the flex row lay
            // the scale points out horizontally on a wide viewport and wrap on a
            // phone.
            <span key={choice.value} className="flex items-center gap-inline">
              <input
                type="radio"
                id={inputId}
                name={question.id}
                value={choice.value}
                checked={answer?.value === choice.value}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                onChange={() => onChange({ ...answer, value: choice.value })}
              />
              {/* Mobile-first: a native radio is ~13px, which is far under the 24px
                  WCAG 2.2 target minimum on a phone. The label is the real hit
                  target — clicking it checks the radio — so it is given a full
                  control-height strip rather than being left as bare text. */}
              <label
                htmlFor={inputId}
                className="mb-0 flex min-h-control-lg items-center text-base font-normal text-fg-primary"
              >
                {labelFor(choice.value, choice.label)}
              </label>
            </span>
          )
        })}
      </div>

      {scaleEnds && (
        <p className="mt-inline flex justify-between gap-inline text-sm text-fg-secondary">
          <span>{question.scaleLabelMin}</span>
          <span>{question.scaleLabelMax}</span>
        </p>
      )}
    </div>
  )
}

interface RankingAnswerProps extends AnswerControlProps {
  legendId: string
  onAnnounce: (message: string) => void
}

/**
 * A ranking, reordered with buttons rather than dragged.
 *
 * Drag-and-drop is the obvious implementation and is unusable by keyboard, which on
 * this page is not a nicety — #83 makes it a hard requirement and #80 shipped a nav
 * whose chevron was unreachable by keyboard at all. Two buttons per row are natively
 * focusable, natively activatable, and each announces which item it moves.
 *
 * The button at either end is genuinely disabled, so pressing it after a move would
 * drop focus onto `<body>` — the same class of trap. The effect below moves focus
 * onto the moved item's other button instead, and the live region says where the item
 * landed, because nothing about the reorder is visible to a screen reader otherwise.
 */
function RankingAnswer({
  question,
  answer,
  disabled,
  invalid,
  errorId,
  legendId,
  onChange,
  onAnnounce,
}: RankingAnswerProps) {
  const { t } = useTranslation('surveyRespond')
  const options = question.options ?? []
  const labels = new Map(options.map((option) => [option.value, option.label ?? option.value]))
  const indices = new Map(options.map((option, index) => [option.value, index]))
  const order = answer?.values && answer.values.length > 0 ? answer.values : options.map((o) => o.value)
  const [pendingFocus, setPendingFocus] = useState<{
    optionIndex: number
    direction: 'up' | 'down'
  } | null>(null)

  useEffect(() => {
    if (!pendingFocus) return
    setPendingFocus(null)

    const preferred = document.getElementById(
      rankButtonId(question.id, pendingFocus.optionIndex, pendingFocus.direction),
    )
    if (preferred instanceof HTMLButtonElement && !preferred.disabled) {
      preferred.focus()
      return
    }
    // The item reached an end, so the button just pressed is now disabled. Focus the
    // opposite one rather than letting focus fall to the document.
    const fallback = document.getElementById(
      rankButtonId(question.id, pendingFocus.optionIndex, pendingFocus.direction === 'up' ? 'down' : 'up'),
    )
    if (fallback instanceof HTMLButtonElement && !fallback.disabled) fallback.focus()
  }, [pendingFocus, question.id])

  function move(from: number, direction: 'up' | 'down'): void {
    const to = direction === 'up' ? from - 1 : from + 1
    const next = moveRankingEntry(order, from, to)
    const value = order[from]
    onChange({ ...answer, values: next })
    setPendingFocus({ optionIndex: indices.get(value) ?? from, direction })
    onAnnounce(
      t('rankingMoved', {
        option: labels.get(value) ?? value,
        position: to + 1,
        total: order.length,
      }),
    )
  }

  return (
    <div className="mt-row">
      <p className="text-sm text-fg-secondary">{t('rankingInstructions')}</p>
      <ol
        aria-labelledby={legendId}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="mt-row grid gap-row"
      >
        {order.map((value, index) => {
          const optionIndex = indices.get(value) ?? index
          return (
            <li
              key={value}
              className="flex items-center gap-inline rounded-md border border-line-light bg-surface-input px-inline py-2"
            >
              <span className="w-icon-box shrink-0 text-sm text-fg-secondary">
                {t('rankingPosition', { position: index + 1, total: order.length })}
              </span>
              <span className="min-w-0 flex-1 text-base text-fg-primary">
                {labels.get(value) ?? value}
              </span>
              <button
                type="button"
                id={rankButtonId(question.id, optionIndex, 'up')}
                disabled={disabled || index === 0}
                aria-label={t('rankingMoveUp', { option: labels.get(value) ?? value })}
                onClick={() => move(index, 'up')}
                className="size-control-lg shrink-0 justify-center rounded-md border border-line-default bg-surface-panel p-0 text-fg-secondary hover:not-disabled:border-line-hover disabled:opacity-50"
              >
                <ArrowUp aria-hidden="true" className="size-icon" />
              </button>
              <button
                type="button"
                id={rankButtonId(question.id, optionIndex, 'down')}
                disabled={disabled || index === order.length - 1}
                aria-label={t('rankingMoveDown', { option: labels.get(value) ?? value })}
                onClick={() => move(index, 'down')}
                className="size-control-lg shrink-0 justify-center rounded-md border border-line-default bg-surface-panel p-0 text-fg-secondary hover:not-disabled:border-line-hover disabled:opacity-50"
              >
                <ArrowDown aria-hidden="true" className="size-icon" />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

interface CommentFieldProps {
  question: SurveyRespondQuestion
  answer: AnswerState | undefined
  answered: boolean
  disabled: boolean
  onChange: (next: AnswerState) => void
}

/**
 * The optional free-text comment beside an answer.
 *
 * Rendered only when the question carries a `commentPrompt`, and deliberately NOT
 * when `commentRequired` is set: that column defaults to `true` in the DDL, so
 * keying off it would put a comment box under every question of every existing
 * survey. The submission endpoint does not enforce it either. An author who wants a
 * comment writes a prompt for it.
 *
 * Read-only until the question itself is answered, because the server refuses a
 * comment on a question with no value and tells the caller to omit the question
 * entirely — so a comment typed against an unanswered question would be silently
 * discarded at submit. Read-only rather than `disabled` keeps it focusable, so a
 * screen-reader user tabbing through meets it and hears why it is not yet editable.
 */
function CommentField({ question, answer, answered, disabled, onChange }: CommentFieldProps) {
  const { t } = useTranslation('surveyRespond')
  const commentId = `${questionFieldId(question.id)}-comment`
  const hintId = `${commentId}-hint`

  return (
    <div className="mt-row">
      <label htmlFor={commentId} className="text-sm font-normal text-fg-secondary">
        {question.commentPrompt}
      </label>
      <Textarea
        id={commentId}
        value={answer?.text ?? ''}
        readOnly={!answered}
        disabled={disabled}
        aria-describedby={answered ? undefined : hintId}
        onChange={(event) => onChange({ ...answer, text: event.target.value })}
      />
      {!answered && (
        <p id={hintId} className="mt-inline text-sm text-fg-secondary">
          {t('commentNeedsAnswer')}
        </p>
      )}
    </div>
  )
}
