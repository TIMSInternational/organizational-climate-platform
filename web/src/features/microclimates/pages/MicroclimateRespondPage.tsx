import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { EyeOff, Info } from 'lucide-react'
import { getMicroclimatePublic, submitResponse, type PublicMicroclimateDetail, type Question } from '../api/microclimates'
import { useTranslation } from '../../../i18n'
import { detectLocale } from '../../../i18n/locale'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Progress,
} from '../../../components/ui'
import { RespondCaption, RespondShell } from '../../../components/layout'
import MicroclimateContentNotice from '../components/MicroclimateContentNotice'

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
        return (
          <p role="alert" className="text-sm text-fg-secondary">
            {t('microclimates.questionHasNoOptions')}
          </p>
        )
      }
      return (
        <ChoiceList
          // The stable value, never the label. Submitting the label is what
          // splits one answer into two across languages (#195).
          choices={question.options.map((option) => ({
            value: option.value,
            label: option.label ?? option.value,
          }))}
          question={question}
          value={value}
          onChange={onChange}
          stacked
        />
      )
    // likert and rating render identically -- a 1-5 radiogroup unless the question
    // configures its own option set. They stay distinct types because they mean
    // different things (agreement vs quality), not because they look different.
    case 'likert':
    case 'rating': {
      const scale =
        question.options && question.options.length > 0
          ? question.options
          : ['1', '2', '3', '4', '5'].map((n, order) => ({ order, value: n, label: n }))
      return (
        <ChoiceList
          choices={scale.map((option) => ({ value: option.value, label: option.label ?? option.value }))}
          question={question}
          value={value}
          onChange={onChange}
        />
      )
    }
    case 'yes_no':
      return (
        <ChoiceList
          choices={[
            { value: 'yes', label: t('common.yes') },
            { value: 'no', label: t('common.no') },
          ]}
          question={question}
          value={value}
          onChange={onChange}
        />
      )
    case 'open_ended':
    default:
      return (
        <input
          type="text"
          className="w-full"
          required={question.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/**
 * A row of radios, laid out for a phone.
 *
 * The three radio-shaped branches above used to spell out their own `<label><input
 * …/>{label}</label>` markup, three times, with the input nested inside the label
 * and no hit target beyond the words. A native radio is about 13px, which is far
 * under the 24px WCAG 2.2 target minimum on the device this page is mostly
 * answered on, so the label is given a full control-height strip and `htmlFor`
 * puts the hit target on it. Same treatment as
 * `surveys/RespondQuestionField.tsx`, which set the precedent.
 */
function ChoiceList({
  choices,
  question,
  value,
  onChange,
  stacked = false,
}: {
  choices: { value: string; label: string }[]
  question: Question
  value: string
  onChange: (value: string) => void
  /** One per line, for authored options that can be long. Scales wrap in a row. */
  stacked?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={question.text ?? undefined}
      className={stacked ? 'grid gap-1' : 'flex flex-wrap gap-x-section gap-y-1'}
    >
      {choices.map((choice) => {
        const inputId = `${question.id}-${choice.value}`
        return (
          <span key={choice.value} className="flex items-center gap-inline">
            <input
              type="radio"
              id={inputId}
              name={question.id}
              value={choice.value}
              checked={value === choice.value}
              required={question.required}
              onChange={(e) => onChange(e.target.value)}
            />
            <label
              htmlFor={inputId}
              className="mb-0 flex min-h-control-lg items-center text-base font-normal text-fg-primary"
            >
              {choice.label}
            </label>
          </span>
        )
      })}
    </div>
  )
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

/**
 * Answering a live microclimate session, without an account.
 *
 * ## The redesign
 *
 * This page used to be an unstyled `<h1>`, a stack of bare `<fieldset>`s and a
 * naked `<button>` — the only screen in the product with no layout at all, and the
 * only one an ordinary employee ever sees. It now uses `RespondShell`, the same
 * standalone centred frame as the two survey respond routes, so the three read as
 * one product.
 *
 * ## Why the anonymity statement is on this page at all
 *
 * `PublicMicroclimateDetail` carries no `anonymousResponses` flag, so this page
 * cannot report the session's configuration and does not try to. What it states
 * instead is what this client verifiably does: `submitResponse` in
 * `api/microclimates.ts` posts with `Content-Type` alone and attaches no bearer
 * token, so no name and no account leaves this page with the answers. That is a
 * description of the request, not a promise about the server, and the copy says
 * exactly that much.
 */
export default function MicroclimateRespondPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<PublicMicroclimateDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<PageError | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // An invited respondent has no stored preference and no authenticated locale, so
  // the language they are served has to come from the request itself -- exactly the
  // `?lang=` parameter web/src/i18n/README.md anticipated for this one public route.
  const locale = detectLocale()

  useEffect(() => {
    if (!id) return
    getMicroclimatePublic(baseUrl, id, locale)
      .then(setMicroclimate)
      .catch((err) => setError(toPageError(err)))
  }, [id, baseUrl, locale])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!id) return
    setError(null)
    setSubmitting(true)
    try {
      // Send the locale actually rendered, not the browser's current preference:
      // they are the same here, but the server records what the respondent saw.
      await submitResponse(baseUrl, id, answers, microclimate?.resolvedLocale ?? locale)
      setSubmitted(true)
    } catch (err) {
      setError(toPageError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const questions = microclimate?.questions ?? []
  const total = questions.length
  const answered = questions.filter((question) => (answers[question.id] ?? '') !== '').length

  return (
    <RespondShell skipLabel={t('microclimates.respondSkip')} contentId="questions">
      <Surface>
        {error ? (
          <Alert variant="warning" role="alert">
            <Info aria-hidden="true" />
            <AlertTitle>{t('microclimates.respondLoadFailedTitle')}</AlertTitle>
            <AlertDescription>{error.message ?? t('errors.generic')}</AlertDescription>
          </Alert>
        ) : submitted ? (
          <Alert variant="success" role="status">
            <EyeOff aria-hidden="true" />
            <AlertTitle>{t('microclimates.respondThanksTitle')}</AlertTitle>
            <AlertDescription>{t('microclimates.thankYouForResponse')}</AlertDescription>
          </Alert>
        ) : !microclimate ? (
          <p className="text-base text-fg-secondary">{t('common.loading')}</p>
        ) : microclimate.status !== 'active' ? (
          <Alert variant="warning" role="status">
            <Info aria-hidden="true" />
            <AlertTitle>{t('microclimates.respondClosedTitle')}</AlertTitle>
            <AlertDescription>{t('microclimates.notAcceptingResponses')}</AlertDescription>
          </Alert>
        ) : (
          <>
            <RespondCaption
              eyebrow={t('microclimates.respondEyebrow')}
              title={microclimate.title ?? t('microclimates.respondUntitled')}
            />

            <MicroclimateContentNotice
              language={microclimate.language}
              resolvedLocale={microclimate.resolvedLocale}
              fallbackFields={microclimate.fallbackFields}
            />

            {/* Panel first in the DOM and moved to the last column from `lg` up, so
                the anonymity statement and the progress reading come BEFORE the
                first question on a phone — which is how a five-minute pulse is
                actually answered — and stay in view beside the questions on a wide
                screen.

                `lg:sticky` here is only real while no ancestor sets `overflow`:
                the other axis is then promoted to `auto` and that ancestor becomes
                this panel's scrollport instead of the document. `RespondShell`'s
                `<main>` carried `overflow-x-auto` and does not scroll, which made
                this class inert on all three respond routes.
                `components/layout/respondSticky.test.tsx` is the guard against it
                coming back. */}
            <div className="grid gap-panel-gap lg:grid-cols-3">
              <section
                aria-label={t('microclimates.respondPanelLabel')}
                className="grid gap-panel-gap self-start lg:sticky lg:top-gutter lg:col-start-3 lg:row-start-1"
              >
                <AnonymityNote />

                <div className="grid gap-inline rounded-lg border border-line-light bg-surface-icon-box p-3">
                  <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
                    {t('microclimates.respondProgressReading')}
                  </span>
                  <span
                    aria-hidden="true"
                    className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-fg-primary"
                  >
                    {`${answered} / ${total}`}
                  </span>
                  {/* `bg-surface-panel` track: `Progress` defaults to
                      `bg-surface-icon-box`, which is the tile it sits on, so an
                      empty bar was invisible. */}
                  <Progress
                    className="bg-surface-panel"
                    value={total === 0 ? 0 : Math.round((answered / total) * 100)}
                    aria-label={t('microclimates.respondProgressReading')}
                  />
                  <span className="text-xs text-fg-secondary">
                    {t('microclimates.respondProgressCount', { answered, total })}
                  </span>
                </div>

              </section>

              <form
                onSubmit={handleSubmit}
                className="grid gap-panel-gap lg:col-span-2 lg:col-start-1 lg:row-start-1"
              >
                {questions.map((question, index) => (
                  <fieldset
                    key={question.id}
                    className="rounded-xl border border-line-panel bg-surface-card p-panel transition-colors focus-within:border-accent-blue-ring"
                  >
                    {/* `float-left w-full` closes the card's frame: a `<legend>`
                        in its default flow is cut out of the fieldset's own
                        border, so the question straddles the top edge and the
                        card reads as a form group rather than as a panel. The
                        block below clears the float. */}
                    <legend className="float-left w-full text-base font-medium text-fg-primary">
                      {/* The position as a reading: mono, tabular, and hidden from
                          assistive tech because the sentence beside it is what
                          "3/8" is supposed to say out loud. */}
                      <span
                        aria-hidden="true"
                        className="mr-inline inline-flex items-center rounded-md bg-surface-icon-box px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-fg-secondary"
                      >
                        {`${index + 1}/${total}`}
                      </span>
                      <span className="sr-only">
                        {t('microclimates.respondQuestionPosition', {
                          position: index + 1,
                          total,
                        })}
                      </span>
                      {question.text}{' '}
                      {/* The WORD carries whether an answer is required, never a
                          colour -- WCAG 1.4.1, and the same rule the survey
                          respond field keeps. */}
                      <span className="font-normal text-fg-secondary">
                        {question.required
                          ? t('microclimates.respondRequiredMarker')
                          : t('microclimates.respondOptionalMarker')}
                      </span>
                    </legend>
                    <div className="clear-both mt-row">
                      <QuestionInput
                        question={question}
                        value={answers[question.id] ?? ''}
                        onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
                      />
                    </div>
                  </fieldset>
                ))}

                <div className="flex flex-wrap gap-inline">
                  <Button type="submit" variant="primary" disabled={submitting}>
                    {submitting ? t('common.submitting') : t('common.submit')}
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </Surface>
    </RespondShell>
  )
}

/**
 * What this page does with the answers, stated as narrowly as it can be verified.
 *
 * Green plus the word: the chip spells out the state, so the colour is never the
 * only thing carrying it.
 */
function AnonymityNote() {
  const { t } = useTranslation()

  return (
    <section className="grid gap-inline rounded-xl border border-accent-green-ring bg-accent-green-soft p-card">
      <span className="flex items-center gap-inline">
        <span className="grid size-icon-box shrink-0 place-items-center rounded-md text-accent-green">
          <EyeOff aria-hidden="true" className="size-icon" />
        </span>
        {/* Secondary ink, not the accent: `text-accent-green` on the soft green
            fill measures 3.49:1 in light, under AA for text this size. The accent
            stays on the icon beside it. */}
        <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
          {t('microclimates.respondAnonymityChip')}
        </span>
      </span>
      <h2 className="text-base font-semibold text-fg-primary">
        {t('microclimates.respondAnonymityTitle')}
      </h2>
      <p className="text-sm text-fg-secondary">{t('microclimates.respondAnonymityBody')}</p>
    </section>
  )
}

/** The one panel on the page — every state renders inside it. */
function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel">
      {children}
    </div>
  )
}
