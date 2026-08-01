import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getMicroclimatePublic, submitResponse, type PublicMicroclimateDetail, type Question } from '../api/microclimates'

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: Question
  value: string
  onChange: (value: string) => void
}) {
  switch (question.type) {
    case 'multiple_choice':
      // The backend now rejects multiple_choice questions with fewer than 2 options at
      // creation time, but this stays defensive against any question created before that
      // validation existed -- an empty radiogroup with no message is indistinguishable from
      // a loading/broken UI to the respondent.
      if (!question.options || question.options.length === 0) {
        return <p role="alert">This question has no configured options and cannot be answered.</p>
      }
      return (
        <div role="radiogroup" aria-label={question.text}>
          {question.options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={value === option}
                required={question.required}
                onChange={(e) => onChange(e.target.value)}
              />
              {option}
            </label>
          ))}
        </div>
      )
    case 'rating': {
      const scale = question.options && question.options.length > 0 ? question.options : ['1', '2', '3', '4', '5']
      return (
        <div role="radiogroup" aria-label={question.text}>
          {scale.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={value === option}
                required={question.required}
                onChange={(e) => onChange(e.target.value)}
              />
              {option}
            </label>
          ))}
        </div>
      )
    }
    case 'yes_no':
      return (
        <div role="radiogroup" aria-label={question.text}>
          {['yes', 'no'].map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={value === option}
                required={question.required}
                onChange={(e) => onChange(e.target.value)}
              />
              {option === 'yes' ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
      )
    case 'open_text':
    default:
      return (
        <input
          type="text"
          required={question.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

export default function MicroclimateRespondPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<PublicMicroclimateDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    getMicroclimatePublic(baseUrl, id)
      .then(setMicroclimate)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [id, baseUrl])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!id) return
    setError(null)
    setSubmitting(true)
    try {
      await submitResponse(baseUrl, id, answers)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit response')
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (submitted) {
    return <p>Thank you for your response.</p>
  }

  if (!microclimate) {
    return <p>Loading…</p>
  }

  if (microclimate.status !== 'active') {
    return <p>This microclimate is not currently accepting responses.</p>
  }

  return (
    <div>
      <h1>{microclimate.title}</h1>
      <form onSubmit={handleSubmit}>
        {microclimate.questions.map((question) => (
          <fieldset key={question.id}>
            <legend>{question.text}</legend>
            <QuestionInput
              question={question}
              value={answers[question.id] ?? ''}
              onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
            />
          </fieldset>
        ))}
        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</button>
      </form>
    </div>
  )
}
