import { useState, type FormEvent } from 'react'
import type { CreateQuestionInput } from '../api/microclimates'

export interface MicroclimateFormValues {
  title: string
  startTime: string
  endTime: string
  targetParticipantCount: number
  anonymousResponses: boolean
  questions: CreateQuestionInput[]
}

const QUESTION_TYPES = ['multiple_choice', 'open_text', 'rating', 'yes_no']

const EMPTY_VALUES: MicroclimateFormValues = { title: '', startTime: '', endTime: '', targetParticipantCount: 10, anonymousResponses: true, questions: [] }

export default function MicroclimateForm({ onSubmit }: { onSubmit: (values: MicroclimateFormValues) => Promise<void> }) {
  const [values, setValues] = useState<MicroclimateFormValues>(EMPTY_VALUES)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function addQuestion() {
    setValues({ ...values, questions: [...values.questions, { text: '', type: 'open_text', required: true, order: values.questions.length + 1 }] })
  }

  function updateQuestion(index: number, question: CreateQuestionInput) {
    setValues({ ...values, questions: values.questions.map((q, i) => (i === index ? question : q)) })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues(EMPTY_VALUES)
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
        Title
        <input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} required />
      </label>
      <label>
        Start time
        <input type="datetime-local" value={values.startTime} onChange={(e) => setValues({ ...values, startTime: e.target.value })} required />
      </label>
      <label>
        End time
        <input type="datetime-local" value={values.endTime} onChange={(e) => setValues({ ...values, endTime: e.target.value })} required />
      </label>
      <label>
        Target participants
        <input type="number" value={values.targetParticipantCount} onChange={(e) => setValues({ ...values, targetParticipantCount: Number(e.target.value) })} min={1} />
      </label>
      <label>
        <input type="checkbox" checked={values.anonymousResponses} onChange={(e) => setValues({ ...values, anonymousResponses: e.target.checked })} />
        Anonymous responses
      </label>

      <h3>Questions</h3>
      {values.questions.map((question, index) => (
        <div key={index}>
          <input placeholder="Question text" value={question.text} onChange={(e) => updateQuestion(index, { ...question, text: e.target.value })} />
          <select value={question.type} onChange={(e) => updateQuestion(index, { ...question, type: e.target.value })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={addQuestion}>Add question</button>

      <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create microclimate'}</button>
    </form>
  )
}
