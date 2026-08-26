import { useTranslation } from '../../../i18n'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  SelectField,
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t('microclimates.questionNumber', { order })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-panel-gap">
        {bilingual ? (
          // Side by side on a wide screen, stacked on a phone. Both are always
          // rendered: a bilingual session that is missing one column cannot be
          // published, so hiding the second field behind a toggle would hide the
          // reason the publish gate later refuses.
          <div className="grid gap-panel-gap md:grid-cols-2">
            <TextField
              label={t('microclimates.questionTextEn')}
              value={question.textEn}
              onChange={(value) => onChange({ ...question, textEn: value })}
              disabled={disabled}
              required
            />
            <TextField
              label={t('microclimates.questionTextEs')}
              value={question.textEs}
              onChange={(value) => onChange({ ...question, textEs: value })}
              disabled={disabled}
              required
            />
          </div>
        ) : (
          <TextField
            label={t('surveys.questionText')}
            value={language === 'es' ? question.textEs : question.textEn}
            onChange={(value) =>
              onChange(
                language === 'es' ? { ...question, textEs: value } : { ...question, textEn: value },
              )
            }
            disabled={disabled}
            required
          />
        )}

        <div className="grid gap-panel-gap md:grid-cols-2">
          <SelectField
            label={t('common.type')}
            value={question.type}
            onChange={(type) =>
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
            options={QUESTION_TYPES.map((type) => ({
              value: type,
              label: questionTypeLabel(t, type),
            }))}
            disabled={disabled}
          />
          <CheckboxField
            label={t('microclimates.questionRequired')}
            checked={question.required}
            onChange={(checked) => onChange({ ...question, required: checked })}
            disabled={disabled}
          />
        </div>

        {showsOptions && (
          <div className="flex flex-col gap-inline">
            {question.options.map((option, index) => (
              <div key={option.key} className="flex flex-wrap items-end gap-inline">
                <div className="grid min-w-0 flex-1 gap-panel-gap md:grid-cols-2">
                  <TextField
                    label={
                      bilingual
                        ? t('microclimates.optionLabelEn', { number: index + 1 })
                        : t('microclimates.optionLabel', { number: index + 1 })
                    }
                    value={option.labelEn}
                    onChange={(value) => updateOption(option.key, { labelEn: value })}
                    disabled={disabled}
                    className={bilingual ? undefined : 'md:col-span-2'}
                  />
                  {bilingual && (
                    <TextField
                      label={t('microclimates.optionLabelEs', { number: index + 1 })}
                      value={option.labelEs}
                      onChange={(value) => updateOption(option.key, { labelEs: value })}
                      disabled={disabled}
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...question,
                      options: question.options.filter((candidate) => candidate.key !== option.key),
                    })
                  }
                  disabled={disabled}
                >
                  {t('microclimates.removeOption', { number: index + 1 })}
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({ ...question, options: [...question.options, emptyOption(nextKey())] })
                }
                disabled={disabled}
              >
                {t('microclimates.addOption')}
              </Button>
            </div>
          </div>
        )}

        {showsEmojiScale && (
          <div className="flex flex-col gap-inline">
            {/* Said once, above the rows, rather than as help text on every label: the
                author needs to know WHY a face has to be named before they meet four
                required fields, and repeating it four times is noise. */}
            <p className="text-sm text-fg-secondary">{t('microclimates.emojiScaleHint')}</p>
            {question.emojiOptions.map((face, index) => (
              <div key={face.key} className="flex flex-wrap items-end gap-inline">
                <div className="grid min-w-0 flex-1 gap-panel-gap md:grid-cols-3">
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
                    // The plain option rows below still bind to `labelEn` unconditionally
                    // while `localizedFor` reads `labelEs` for a Spanish microclimate;
                    // that mismatch is a pre-existing defect on the multiple-choice path
                    // and is deliberately not copied here.
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
                  onClick={() =>
                    onChange({
                      ...question,
                      emojiOptions: question.emojiOptions.filter(
                        (candidate) => candidate.key !== face.key,
                      ),
                    })
                  }
                  disabled={disabled}
                >
                  {t('microclimates.removeEmojiOption', { number: index + 1 })}
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...question,
                    emojiOptions: [...question.emojiOptions, emptyEmojiOption(nextKey())],
                  })
                }
                disabled={disabled}
              >
                {t('microclimates.addEmojiOption')}
              </Button>
            </div>
          </div>
        )}

        <div>
          <Button type="button" variant="ghost" onClick={onRemove} disabled={disabled}>
            {t('microclimates.removeQuestion')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
