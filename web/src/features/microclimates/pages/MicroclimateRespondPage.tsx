import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { getMicroclimateForRespond, submitResponse, type PublicMicroclimateDetail } from '../api/microclimates'

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
    // Uses getMicroclimateForRespond (plain, unauthenticated fetch against the
    // AllowAnonymous `GET /microclimates/{id}/respond` route), NOT getMicroclimate/authFetch --
    // the latter targets the authenticated `GET /microclimates/{id}` route and 401s (then
    // hard-redirects to /login) for a visitor with no token, which breaks this public page.
    getMicroclimateForRespond(baseUrl, id)
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
          <label key={question.id}>
            {question.text}
            <input
              required={question.required}
              value={answers[question.id] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
            />
          </label>
        ))}
        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</button>
      </form>
    </div>
  )
}
