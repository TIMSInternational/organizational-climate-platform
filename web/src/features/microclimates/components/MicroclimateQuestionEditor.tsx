import { useId } from 'react'
import { GripVertical, Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TextField,
} from '../../../components/ui'
import { QUESTION_TYPES } from '../questionTypes'
import { questionTypeLabel } from '../microclimateVocabulary'
import {
  defaultEmojiScale,
  emptyEmojiOption,
  emptyOption,
  needsBothLanguages,
  type ContentLanguage,
  type WizardEmojiOptionValues,
  type WizardOptionValues,
  type WizardQuestionValues,
} from '../wizardValues'

interface MicroclimateQuestionEditorProps {
  question: WizardQuestionValues
  /** 1-based, and the same number the server uses in its own messages. */
  order: number
  language: ContentLanguage
  onChange: (question: WizardQuestionValues) => void
  onRemove: () => void
  /** Mints a stable key for a newly added option row. */
  nextKey: () => string
  disabled?: boolean
}

/**
 * One question in the creation wizard.
 *
 * ## Options are edited as rows, not as a comma-separated string
 *
 * `MicroclimateForm` (the single-shot form this wizard replaces) took options as
 * `"Yes, No, Maybe"` and split on commas. That is unusable the moment a bilingual
 * session needs an English *and* a Spanish label per option, and it silently
 * mangles any option containing a comma — "Yes, mostly" becomes two options. A row
 * per option also gives the duplicate check something to point at.
 *
 * ## Why the option `value` is never shown
 *
 * `MicroclimateContent.DeriveOptionValue` derives the stored, locale-independent
 * value from the English label (or the Spanish one when there is no English). An
 * author does not need to see it, and exposing it as an editable field invites two
 * options that differ only in their value — the ambiguity the stable value exists to
 * prevent. `wizardValues.derivedOptionValue` reproduces the same derivation so the
 * duplicate warning fires on exactly the pairs the server would reject.
 *
 * ## Only `multiple_choice` gets an option editor
 *
 * `likert` and `rating` fall back to a 1-5 scale server side and `yes_no` and
 * `open_ended` need nothing, so an option list on those would collect input that is
 * never stored. `MicroclimateRespondPage` renders exactly this split.
 *
 * ## `emoji_rating` gets a different editor, not the same one (#198)
 *
 * Its faces are stored in their own table with the glyph and the label in separate
 * columns, because a face's label is the accessible name a screen reader announces —
 * an emoji-only option has none. So the row here is **two fields per face**, and the
 * label is marked required rather than optional the way a multiple-choice label is.
 * Reusing the option editor and asking authors to type the emoji into the label field
 * is precisely the shape #198 rejected.
 *
 * ## Drawn as the row beside it, not as a card of its own
 *
 * In the creation page this block sits between `QuestionRow`s (the collapsed rows for the
 * types that need no options), so it takes their grammar exactly: the same hairline box and
 * padding, the grip and the number disc, the `Obligatoria`/`Opcional` switch in the header
 * instead of a checkbox, and the type as a compact select where the row shows its chip. A
 * remove action is an icon button with the action as its accessible name (the trash for the
 * question, a cross for an option) and an add action is the tinted text button (`.btn.t`),
 * never bare text or a second carded button -- HIG `buttons.md` § "Best practices": a
 * button must look like one, and one control grammar per list.
 */
export default function MicroclimateQuestionEditor({
  question,
  order,
  language,
  onChange,
  onRemove,
  nextKey,
  disabled = false,
}: MicroclimateQuestionEditorProps) {
  const { t } = useTranslation()
  const bilingual = needsBothLanguages(language)
  const showsOptions = question.type === 'multiple_choice'
  const showsEmojiScale = question.type === 'emoji_rating'
  const switchId = useId()

  function updateOption(key: string, patch: Partial<WizardOptionValues>): void {
    onChange({
      ...question,
      options: question.options.map((option) =>
        option.key === key ? { ...option, ...patch } : option,
      ),
    })
  }

  function updateEmojiOption(key: string, patch: Partial<WizardEmojiOptionValues>): void {
    onChange({
      ...question,
      emojiOptions: question.emojiOptions.map((face) =>
        face.key === key ? { ...face, ...patch } : face,
      ),
    })
  }

  return (
    <div
      role="group"
      aria-label={t('microclimates.questionNumber', { order })}
      className="flex flex-col gap-2 rounded-xl border border-line-default px-3 pt-2.5 pb-3"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <GripVertical aria-hidden="true" className="size-4 shrink-0 text-fg-tertiary" />
        <span
          aria-hidden="true"
          className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full bg-surface-fill text-xs font-semibold tabular-nums text-fg-secondary"
        >
          {order}
        </span>
        <Select
          value={question.type}
          disabled={disabled}
          onValueChange={(type) =>
            onChange({
              ...question,
              type,
              // Two blank rows rather than none: the rule is "at least two", and
              // an empty list makes the author guess how many are needed.
              options:
                type === 'multiple_choice' && question.options.length === 0
                  ? [emptyOption(nextKey()), emptyOption(nextKey())]
                  : question.options,
              // Four faces, glyphs seeded and names blank. The glyphs are a
              // starting point an author can overwrite; the names are the one
              // thing nobody else can supply, so they are left empty and the
              // step refuses to advance until they are filled.
              emojiOptions:
                type === 'emoji_rating' && question.emojiOptions.length === 0
                  ? defaultEmojiScale(nextKey)
                  : question.emojiOptions,
            })
          }
        >
          <SelectTrigger size="sm" className="w-auto" aria-label={t('common.type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUESTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {questionTypeLabel(t, type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">
          <Switch
            id={switchId}
            checked={question.required}
            disabled={disabled}
            onCheckedChange={(required) => onChange({ ...question, required })}
          />
          <label htmlFor={switchId} className="m-0 text-sm font-normal leading-normal text-fg-secondary">
            {question.required ? t('microclimates.next.create.required') : t('microclimates.next.create.optional')}
          </label>
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-canvas"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('microclimates.removeQuestion')}
          title={t('microclimates.removeQuestion')}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      {bilingual ? (
        // Side by side on a wide screen, stacked on a phone. Both are always
        // rendered: a bilingual session that is missing one column cannot be
        // published, so hiding the second field behind a toggle would hide the
        // reason the publish gate later refuses.
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Input
            aria-label={t('microclimates.questionTextEn')}
            placeholder={t('microclimates.questionTextEn')}
            value={question.textEn}
            onChange={(event) => onChange({ ...question, textEn: event.target.value })}
            disabled={disabled}
            required
          />
          <Input
            aria-label={t('microclimates.questionTextEs')}
            placeholder={t('microclimates.questionTextEs')}
            value={question.textEs}
            onChange={(event) => onChange({ ...question, textEs: event.target.value })}
            disabled={disabled}
            required
          />
        </div>
      ) : (
        <Input
          // The same accessible name the field had as a labelled TextField, which the
          // wizard's tests (and a screen-reader user) find it by.
          aria-label={t('surveys.questionText')}
          placeholder={t('surveys.questionText')}
          value={language === 'es' ? question.textEs : question.textEn}
          onChange={(event) =>
            onChange(
              language === 'es'
                ? { ...question, textEs: event.target.value }
                : { ...question, textEn: event.target.value },
            )
          }
          disabled={disabled}
          required
        />
      )}

      {showsOptions && (
        <div className="flex flex-col gap-2">
          {question.options.map((option, index) => {
            const labelFirst = bilingual
              ? t('microclimates.optionLabelEn', { number: index + 1 })
              : t('microclimates.optionLabel', { number: index + 1 })
            return (
              <div key={option.key} className="flex items-center gap-2">
                <div className={bilingual ? 'grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2' : 'min-w-0 flex-1'}>
                  <Input
                    aria-label={labelFirst}
                    placeholder={labelFirst}
                    // The column the content language writes, like the question text and the
                    // emoji labels: a Spanish microclimate's options are `labelEs`, which is
                    // what `localizedFor` sends and what a draft is read back into (G23).
                    value={language === 'es' ? option.labelEs : option.labelEn}
                    onChange={(event) =>
                      updateOption(
                        option.key,
                        language === 'es' ? { labelEs: event.target.value } : { labelEn: event.target.value },
                      )
                    }
                    disabled={disabled}
                  />
                  {bilingual && (
                    <Input
                      aria-label={t('microclimates.optionLabelEs', { number: index + 1 })}
                      placeholder={t('microclimates.optionLabelEs', { number: index + 1 })}
                      value={option.labelEs}
                      onChange={(event) => updateOption(option.key, { labelEs: event.target.value })}
                      disabled={disabled}
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-canvas"
                  onClick={() =>
                    onChange({
                      ...question,
                      options: question.options.filter((candidate) => candidate.key !== option.key),
                    })
                  }
                  disabled={disabled}
                  aria-label={t('microclimates.removeOption', { number: index + 1 })}
                  title={t('microclimates.removeOption', { number: index + 1 })}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )
          })}
          <div>
            <Button
              type="button"
              variant="plain"
              size="canvas"
              className="-ml-2"
              onClick={() =>
                onChange({ ...question, options: [...question.options, emptyOption(nextKey())] })
              }
              disabled={disabled}
            >
              <Plus aria-hidden="true" />
              {t('microclimates.addOption')}
            </Button>
          </div>
        </div>
      )}

      {showsEmojiScale && (
        <div className="flex flex-col gap-2">
          {/* Said once, above the rows, rather than as help text on every label: the
              author needs to know WHY a face has to be named before they meet four
              required fields, and repeating it four times is noise. */}
          <p className="text-sm text-fg-secondary">{t('microclimates.emojiScaleHint')}</p>
          {question.emojiOptions.map((face, index) => (
            <div key={face.key} className="flex items-end gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3">
                <TextField
                  label={t('microclimates.emojiGlyph', { number: index + 1 })}
                  value={face.emoji}
                  onChange={(value) => updateEmojiOption(face.key, { emoji: value })}
                  disabled={disabled}
                  required
                />
                {bilingual ? (
                  <>
                    <TextField
                      label={t('microclimates.emojiLabelEn', { number: index + 1 })}
                      value={face.labelEn}
                      onChange={(value) => updateEmojiOption(face.key, { labelEn: value })}
                      disabled={disabled}
                      required
                    />
                    <TextField
                      label={t('microclimates.emojiLabelEs', { number: index + 1 })}
                      value={face.labelEs}
                      onChange={(value) => updateEmojiOption(face.key, { labelEs: value })}
                      disabled={disabled}
                      required
                    />
                  </>
                ) : (
                  // Bound to the column the CONTENT LANGUAGE actually writes, the way
                  // the question-text field above does it -- not always to `labelEn`.
                  // The plain option rows above bind the same way since G23.
                  <TextField
                    label={t('microclimates.emojiLabel', { number: index + 1 })}
                    value={language === 'es' ? face.labelEs : face.labelEn}
                    onChange={(value) =>
                      updateEmojiOption(
                        face.key,
                        language === 'es' ? { labelEs: value } : { labelEn: value },
                      )
                    }
                    disabled={disabled}
                    // Required whichever language it is: this is the option's
                    // accessible name, and the server refuses a face without one
                    // rather than storing an unnamed emoji.
                    required
                    className="md:col-span-2"
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-canvas"
                onClick={() =>
                  onChange({
                    ...question,
                    emojiOptions: question.emojiOptions.filter(
                      (candidate) => candidate.key !== face.key,
                    ),
                  })
                }
                disabled={disabled}
                aria-label={t('microclimates.removeEmojiOption', { number: index + 1 })}
                title={t('microclimates.removeEmojiOption', { number: index + 1 })}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="plain"
              size="canvas"
              className="-ml-2"
              onClick={() =>
                onChange({
                  ...question,
                  emojiOptions: [...question.emojiOptions, emptyEmojiOption(nextKey())],
                })
              }
              disabled={disabled}
            >
              <Plus aria-hidden="true" />
              {t('microclimates.addEmojiOption')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
