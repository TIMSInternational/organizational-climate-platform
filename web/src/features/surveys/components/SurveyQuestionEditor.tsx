import type { Locale } from '../../../i18n'
import { useTranslation } from '../../../i18n'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CheckboxField,
  Separator,
  TextField,
  TextareaField,
} from '../../../components/ui'
import { questionTypeLabel } from '../surveyVocabulary'
import type { AuthoringOption, AuthoringQuestion } from '../api/surveyQuestionAuthoring'
import type { AuthoredText } from '../api/surveyInvitationCopy'

/**
 * The editable counterpart of `SurveyQuestionList`, in every language the survey is
 * written in — the same shape `InvitationCopyEditor` gives the invitation copy, because it
 * is the same problem: paired `*_en` / `*_es` columns (#195) where one text box files
 * whatever was typed into one column and silently leaves the other empty.
 *
 * ## What is shown is decided by the DATA, not by the type
 *
 * Options appear when the question has options; the scale labels appear when it has
 * bounds. Never from a `type === 'likert'` table in this file. Which types carry which
 * shape is the server's rule, it has changed before (`emoji_rating`, #198), and a copy of
 * it here would be a second place to update and a silent way to drop a field the server
 * still stores. Rendering what the payload actually holds cannot drift.
 *
 * ## Option `value` is shown and never editable
 *
 * It is the aggregation join key every recorded answer points at, and
 * `CreateSurveyQuestionOptionInput.Value` is optional server-side — omit it and the value
 * is re-derived from the label, repointing every answer already stored. `SurveyQuestionList`
 * shows it on the read side for the same reason: on an admin screen the key is what makes
 * cross-survey comparison work, and an author renaming a choice should be able to see they
 * are renaming a label rather than replacing an option.
 *
 * ## Adding a question is deliberately not here
 *
 * Creating one means choosing a type and constructing its options or scale, which is the
 * wizard's job (#108) and the template-copy path's (#267). A second question-builder here
 * would be exactly the duplication #273 refused when it kept the template preview
 * read-only rather than rebuilding it client-side. Rewording, reordering and trimming —
 * what a draft under review actually needs — are here.
 */

interface SurveyQuestionEditorProps {
  questions: readonly AuthoringQuestion[]
  locales: readonly Locale[]
  disabled?: boolean
  onChange: (next: AuthoringQuestion[]) => void
}

type LocalizedFieldKey = 'text' | 'commentPrompt' | 'scaleLabelMin' | 'scaleLabelMax'

/**
 * Blank means this locale holds nothing, which is what `localized()` reads to decide
 * whether to send the column at all. Clearing a box is therefore how an author says "this
 * is not translated", and it must not survive as an empty string in the other language's
 * column.
 */
function authoredText(text: string): AuthoredText {
  return { text, authored: text.trim().length > 0 }
}

/** Renumbered from position rather than swapped: `order` is stored, and the respond form
 *  reads it, so a gap or a duplicate here becomes a real ordering bug downstream. */
function renumber(questions: AuthoringQuestion[]): AuthoringQuestion[] {
  return questions.map((q, i) => ({ ...q, order: i }))
}

export default function SurveyQuestionEditor({
  questions,
  locales,
  disabled = false,
  onChange,
}: SurveyQuestionEditorProps) {
  const { t } = useTranslation()
  const bilingual = locales.length > 1

  function replace(index: number, next: AuthoringQuestion): void {
    const copy = [...questions]
    copy[index] = next
    onChange(copy)
  }

  function move(index: number, by: number): void {
    const target = index + by
    if (target < 0 || target >= questions.length) return
    const copy = [...questions]
    const [lifted] = copy.splice(index, 1)
    copy.splice(target, 0, lifted)
    onChange(renumber(copy))
  }

  function localeName(locale: Locale): string {
    return t(`surveys.distribution.locale.${locale}`)
  }

  function localizedField(
    question: AuthoringQuestion,
    index: number,
    locale: Locale,
    field: LocalizedFieldKey,
    labelKey: string,
    multiline = false,
  ) {
    const Control = multiline ? TextareaField : TextField
    return (
      <Control
        key={`${field}-${locale}`}
        // The language belongs in the accessible NAME, not only in the section heading
        // above it. A bilingual survey renders this control once per locale, and two
        // inputs called "Question" in one card are indistinguishable to anybody not
        // reading the layout — which on this product is a stated part of the audience.
        label={bilingual ? `${t(labelKey)} (${localeName(locale)})` : t(labelKey)}
        value={question[field][locale]?.text ?? ''}
        disabled={disabled}
        onChange={(text: string) =>
          replace(index, {
            ...question,
            [field]: { ...question[field], [locale]: authoredText(text) },
          })
        }
      />
    )
  }

  function optionField(
    question: AuthoringQuestion,
    index: number,
    option: AuthoringOption,
    optionIndex: number,
    locale: Locale,
  ) {
    return (
      <TextField
        key={`${option.value}-${locale}`}
        // The key is in the label, not in an input: an author needs to see which option
        // they are renaming, and must not be able to rename the key itself.
        label={
          bilingual
            ? `${t('surveys.questionEditor.optionLabel')} (${localeName(locale)}) — ${option.value}`
            : `${t('surveys.questionEditor.optionLabel')} — ${option.value}`
        }
        value={option.label[locale]?.text ?? ''}
        disabled={disabled}
        onChange={(text: string) => {
          const options = [...question.options!]
          options[optionIndex] = {
            ...option,
            label: { ...option.label, [locale]: authoredText(text) },
          }
          replace(index, { ...question, options })
        }}
      />
    )
  }

  /** True when this locale holds nothing of this question at all. */
  function untranslated(question: AuthoringQuestion, locale: Locale): boolean {
    const fields: LocalizedFieldKey[] = ['text', 'commentPrompt', 'scaleLabelMin', 'scaleLabelMax']
    const anyField = fields.some((f) => question[f][locale]?.authored)
    const anyOption = (question.options ?? []).some((o) => o.label[locale]?.authored)
    return !anyField && !anyOption
  }

  return (
    <ol className="flex flex-col gap-panel-gap" aria-label={t('surveys.questions')}>
      {questions.map((question, index) => (
        <li key={question.id}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-inline">
              <span className="text-sm font-medium text-fg-secondary">
                {index + 1}. {questionTypeLabel(t, question.type)}
              </span>
              <span className="flex flex-wrap gap-inline">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  {t('surveys.questionEditor.moveUp')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || index === questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  {t('surveys.questionEditor.moveDown')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(renumber(questions.filter((_, i) => i !== index)))}
                >
                  {t('surveys.questionEditor.remove')}
                </Button>
              </span>
            </CardHeader>

            <CardContent className="flex flex-col gap-panel-gap">
              {/*
                Side by side on a wide viewport, stacked on a narrow one — the same choice
                InvitationCopyEditor makes, and for the same reason: two columns is what
                makes the pair comparable at a glance, which is the point of editing them
                together rather than on two screens.
              */}
              <div className={bilingual ? 'grid gap-panel-gap md:grid-cols-2' : 'grid gap-panel-gap'}>
                {locales.map((locale) => (
                  <section key={locale} className="flex flex-col gap-panel-gap">
                    {bilingual && (
                      <h4 className="flex items-center gap-inline text-base font-semibold text-fg-primary">
                        {localeName(locale)}
                        {untranslated(question, locale) && (
                          <Badge variant="outline">
                            {t('surveys.distribution.copyUntranslated')}
                          </Badge>
                        )}
                      </h4>
                    )}

                    {localizedField(question, index, locale, 'text', 'surveys.questionEditor.text', true)}

                    {question.options?.map((option, optionIndex) =>
                      optionField(question, index, option, optionIndex, locale),
                    )}

                    {(question.scaleMin !== null || question.scaleMax !== null) && (
                      <>
                        {localizedField(question, index, locale, 'scaleLabelMin', 'surveys.questionEditor.scaleLabelMin')}
                        {localizedField(question, index, locale, 'scaleLabelMax', 'surveys.questionEditor.scaleLabelMax')}
                      </>
                    )}

                    {localizedField(question, index, locale, 'commentPrompt', 'surveys.questionEditor.commentPrompt')}
                  </section>
                ))}
              </div>

              {/*
                Locale-independent, so outside the per-language columns — and separated
                from them, because it did not read that way. These controls are capped at
                `max-w-field` like every other field, which left them sitting directly
                under the first language's column with nothing between: on a bilingual
                survey the dimension looked like the English dimension, and the two
                checkboxes like English's. A rule across the full width is what says the
                section ended.
              */}
              {bilingual && <Separator />}
              <TextField
                label={t('surveys.questionEditor.category')}
                description={t('surveys.questionEditor.categoryHint')}
                value={question.category ?? ''}
                disabled={disabled}
                onChange={(text) => replace(index, { ...question, category: text || null })}
              />
              <CheckboxField
                label={t('surveys.questionEditor.required')}
                checked={question.required}
                disabled={disabled}
                onChange={(checked) => replace(index, { ...question, required: checked })}
              />
              <CheckboxField
                label={t('surveys.questionEditor.commentRequired')}
                checked={question.commentRequired}
                disabled={disabled}
                onChange={(checked) => replace(index, { ...question, commentRequired: checked })}
              />
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  )
}
