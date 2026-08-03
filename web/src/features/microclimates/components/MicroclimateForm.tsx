import { useState, type FormEvent } from 'react'
import type { CreateQuestionInput } from '../api/microclimates'
import type { MicroclimateTemplate } from '../api/microclimateTemplates'
import { useTranslation } from '../../../i18n'

export interface MicroclimateFormValues {
  title: string
  startTime: string
  endTime: string
  targetParticipantCount: number
  anonymousResponses: boolean
  templateId?: string
  questions: CreateQuestionInput[]
}

const QUESTION_TYPES = ['multiple_choice', 'open_text', 'rating', 'yes_no']

const EMPTY_VALUES: MicroclimateFormValues = { title: '', startTime: '', endTime: '', targetParticipantCount: 10, anonymousResponses: true, templateId: undefined, questions: [] }

interface MicroclimateFormProps {
  templates?: MicroclimateTemplate[]
  onSubmit: (values: MicroclimateFormValues) => Promise<void>
}

export default function MicroclimateForm({ templates = [], onSubmit }: MicroclimateFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<MicroclimateFormValues>(EMPTY_VALUES)
  const [optionsDraft, setOptionsDraft] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function addQuestion() {
    setValues({ ...values, questions: [...values.questions, { text: '', type: 'open_text', required: true, order: values.questions.length + 1 }] })
  }

  function updateQuestion(index: number, question: CreateQuestionInput) {
    setValues({ ...values, questions: values.questions.map((q, i) => (i === index ? question : q)) })
  }

  function updateOptions(index: number, raw: string) {
    setOptionsDraft({ ...optionsDraft, [index]: raw })
    const options = raw.split(',').map((o) => o.trim()).filter(Boolean)
    updateQuestion(index, { ...values.questions[index], options: options.length > 0 ? options : undefined })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    // multiple_choice has no fallback rendering -- an unanswerable question must not reach
    // the backend (which also rejects this, but failing fast here gives the admin a clearer
    // message and avoids a round-trip).
    const invalidChoice = values.questions.find((q) => q.type === 'multiple_choice' && (q.options ?? []).length < 2)
    if (invalidChoice) {
      setError('Multiple choice questions need at least 2 options.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues(EMPTY_VALUES)
      setOptionsDraft({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('microclimates.title')}
        <input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} required />
      </label>
      <label>
        {t('microclimates.startTime')}
        <input type="datetime-local" value={values.startTime} onChange={(e) => setValues({ ...values, startTime: e.target.value })} required />
      </label>
      <label>
        {t('microclimates.endTime')}
        <input type="datetime-local" value={values.endTime} onChange={(e) => setValues({ ...values, endTime: e.target.value })} required />
      </label>
      <label>
        {t('surveys.targetParticipants')}
        <input type="number" value={values.targetParticipantCount} onChange={(e) => setValues({ ...values, targetParticipantCount: Number(e.target.value) })} min={1} />
      </label>
      <label>
        <input type="checkbox" checked={values.anonymousResponses} onChange={(e) => setValues({ ...values, anonymousResponses: e.target.checked })} />
        {t('microclimates.anonymousResponses')}
      </label>

      {templates.length > 0 && (
        // Reference-only, same as ActionPlanForm's template picker: selecting a template just
        // sets templateId on the create request (a one-field pass-through the backend
        // validates, scopes to the caller's company/system templates, and increments
        // UsageCount against). It does not copy the template's questions into this form --
        // that auto-population is explicitly out of scope for this slice.
        <label>
          {t('actionPlans.startFromTemplate')}
          <select
            value={values.templateId ?? ''}
            onChange={(e) => setValues({ ...values, templateId: e.target.value || undefined })}
          >
            <option value="">{t('actionPlans.noTemplate')}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      )}

      <h3>{t('surveys.questions')}</h3>
      {values.questions.map((question, index) => (
        <div key={index}>
          <input placeholder={t('surveys.questionText')} value={question.text} onChange={(e) => updateQuestion(index, { ...question, text: e.target.value })} />
          <select value={question.type} onChange={(e) => updateQuestion(index, { ...question, type: e.target.value })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {question.type === 'multiple_choice' && (
            <label>
              {t('microclimates.optionsCommaSeparatedMin2')}
              <input
                placeholder={t('users.optionsExample')}
                value={optionsDraft[index] ?? (question.options ?? []).join(', ')}
                onChange={(e) => updateOptions(index, e.target.value)}
              />
            </label>
          )}
        </div>
      ))}
      <button type="button" onClick={addQuestion}>{t('surveys.addQuestion')}</button>

      <button type="submit" disabled={submitting}>{submitting ? t('common.creating') : t('microclimates.createMicroclimate')}</button>
    </form>
  )
}
