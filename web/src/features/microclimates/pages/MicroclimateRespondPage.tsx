import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { getMicroclimatePublic, submitResponse, type PublicMicroclimateDetail, type Question } from '../api/microclimates'
import { useTranslation } from '../../../i18n'

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: Question
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()

  switch (question.type) {
    case 'multiple_choice':
      // The backend now rejects multiple_choice questions with fewer than 2 options at
      // creation time, but this stays defensive against any question created before that
      // validation existed -- an empty radiogroup with no message is indistinguishable from
      // a loading/broken UI to the respondent.
      if (!question.options || question.options.length === 0) {
        return <p role="alert">{t('microclimates.questionHasNoOptions')}</p>
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
              {option === 'yes' ? t('common.yes') : t('common.no')}
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

/**
 * A failure carried as data rather than as a finished string.
 *
 * The message from a real API error is already human-readable and locale-agnostic
 * here; only the fallback needs translating, and doing that at render keeps `t`
 * out of the fetch effect's dependency array.
 */
interface PageError {
  message: string | null
}

function toPageError(err: unknown): PageError {
  return { message: err instanceof Error ? err.message : null }
}

export default function MicroclimateRespondPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<PublicMicroclimateDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<PageError | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    getMicroclimatePublic(baseUrl, id)
      .then(setMicroclimate)
      .catch((err) => setError(toPageError(err)))
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
      setError(toPageError(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return <p role="alert">{error.message ?? t('errors.generic')}</p>
  }

  if (submitted) {
    return <p>{t('microclimates.thankYouForResponse')}</p>
  }

  if (!microclimate) {
    return <p>{t('common.loading')}</p>
  }

  if (microclimate.status !== 'active') {
    return <p>{t('microclimates.notAcceptingResponses')}</p>
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
        <button type="submit" disabled={submitting}>{submitting ? t('common.submitting') : t('common.submit')}</button>
      </form>
    </div>
  )
}
