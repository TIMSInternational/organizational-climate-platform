import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { EyeOff, Info, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  LiveRegion,
  Progress,
} from '../../../components/ui'
import {
  answeredCount,
  hydrateAnswers,
  missingRequired,
  orderQuestions,
  toAnswerInputs,
  type AnswerMap,
  type AnswerState,
} from '../respondAnswers'
import { clearSessionId, ensureSessionId } from '../respondSession'
import {
  SurveyRespondError,
  getSurveyRespondView,
  submitSurveyResponse,
  type SurveyRespondView,
  type SurveySubmissionResult,
} from '../api/surveyResponses'
import { questionFieldId } from '../respondFieldIds'
import RespondQuestionField from './RespondQuestionField'

export interface SurveyRespondFormProps {
  surveyId: string
  /**
   * True on the unauthenticated `/survey/:id` route.
   *
   * Changes exactly one thing: what a 401 means. Behind `RequireAuth` a 401 is a
   * stale token and the answer is "sign in again"; on the public route it means the
   * survey is either closed or not open to anonymous respondents, and the server
   * deliberately does not say which — telling an unauthenticated visitor "this exists
   * but is not anonymous" is a disclosure about a tenant's survey they have no claim
   * to.
   */
  publicEntry?: boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; view: SurveyRespondView }
  | { status: 'failed'; error: SurveyRespondError | null }

/**
 * The respondent experience, shared by the authenticated and the public route.
 *
 * One component rather than two: the two routes differ in who may reach them and in
 * what surrounds them, never in how a survey is answered. Two implementations is how
 * the anonymity notice comes to be shown on one of them and not the other.
 *
 * ## What it honours rather than invents
 *
 * `Survey.Settings` already decides the shape of this page, so nothing here is a
 * product decision taken locally: `ShowProgress` gates the progress bar,
 * `AllowPartialResponses` gates the save-and-continue button, `RandomizeQuestions`
 * gates the shuffle and `TimeLimitMinutes` gates the countdown. Each one is off
 * unless the survey turned it on.
 *
 * **`AutoSave` is the exception, and it is a gap rather than a decision.** The
 * setting exists on `SurveySettingsDto`, but `SurveyRespondView` — the payload this
 * page is served — does not carry it, so this page cannot know whether the author
 * asked for it. Auto-saving anyway would be inventing behaviour for every survey that
 * did not; the save button is offered instead, gated on the flag that *is* served.
 */
export default function SurveyRespondForm({ surveyId, publicEntry = false }: SurveyRespondFormProps) {
  const { t, locale } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [invalidIds, setInvalidIds] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<'idle' | 'saving' | 'submitting'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<SurveySubmissionResult | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [now, setNow] = useState(() => Date.now())

  // The session id is minted before the first read, because it is both the resume
  // key on the way in and the idempotency key on the way out. Deriving it later
  // would mean the GET could not find a response the POST would then duplicate.
  const sessionId = useMemo(() => ensureSessionId(surveyId), [surveyId])

  // Answers are hydrated from the server exactly once. The read is re-issued when the
  // respondent switches language — the question TEXT has to come back translated —
  // and re-hydrating there would throw away everything they had typed since.
  const hydrated = useRef(false)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    getSurveyRespondView(baseUrl, surveyId, { lang: locale, sessionId })
      .then((view) => {
        if (cancelled) return
        if (!hydrated.current) {
          hydrated.current = true
          if (view.inProgress) {
            setAnswers(hydrateAnswers(view.inProgress.answers))
            startedAt.current = Date.parse(view.inProgress.startTime) || Date.now()
          }
        }
        setState({ status: 'ready', view })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'failed',
          error: error instanceof SurveyRespondError ? error : null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, surveyId, locale, sessionId])

  const view = state.status === 'ready' ? state.view : null
  const timeLimitMinutes = view?.timeLimitMinutes ?? null

  // Only ticks for a survey that actually sets a limit, so every other survey costs
  // no timer at all.
  useEffect(() => {
    if (timeLimitMinutes === null) return
    const handle = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(handle)
  }, [timeLimitMinutes])

  const questions = useMemo(
    () => (view ? orderQuestions(view.questions, view.randomizeQuestions, view.id) : []),
    [view],
  )

  const announce = useCallback((message: string) => setAnnouncement(message), [])

  function updateAnswer(questionId: string, next: AnswerState): void {
    setAnswers((current) => ({ ...current, [questionId]: next }))
    setInvalidIds((current) => current.filter((id) => id !== questionId))
  }

  async function send(isComplete: boolean): Promise<void> {
    if (!view) return
    setSubmitError(null)
    setBusy(isComplete ? 'submitting' : 'saving')
    try {
      const submission = await submitSurveyResponse(baseUrl, view.id, {
        answers: toAnswerInputs(questions, answers),
        sessionId,
        isComplete,
        // The locale the respondent actually READ, not the one they asked for. A
        // Spanish-only survey opened with the UI in English is answered in Spanish,
        // and `Response.Language` is what the results aggregation groups free text
        // by — recording 'en' there is how "trabajo" and "work" become unrelated
        // entries in one word cloud.
        language: view.resolvedLocale,
        ...(isComplete
          ? { totalTimeSeconds: Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)) }
          : {}),
      })

      if (isComplete) {
        // Nothing left to resume, and on a shared browser the id must not outlive
        // the response it belongs to.
        clearSessionId(view.id)
        setResult(submission)
      } else {
        announce(t('progressSaved'))
      }
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : tRoot('errors.generic')
      setSubmitError(message)
      announce(message)
    } finally {
      setBusy('idle')
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    if (!view) return

    const missing = missingRequired(questions, answers)
    if (missing.length > 0) {
      setInvalidIds(missing)
      announce(t('missingRequired', { count: missing.length }))
      // Focus the first unanswered question rather than a summary at the top: the
      // respondent has to reach the question anyway, and on a 40-question survey a
      // summary leaves them scrolling for it.
      document.getElementById(questionFieldId(missing[0]))?.focus()
      return
    }

    void send(true)
  }

  if (state.status === 'loading') {
    return <p>{tRoot('common.loading')}</p>
  }

  if (state.status === 'failed') {
    return <LoadFailure error={state.error} publicEntry={publicEntry} />
  }

  if (result) {
    return <Submitted result={result} />
  }

  if (view && view.inProgress?.isComplete) {
    return <AlreadyCompleted />
  }

  if (!view) return null

  const total = questions.length
  const answered = answeredCount(questions, answers)
  const deadline =
    view.timeLimitMinutes === null ? null : startedAt.current + view.timeLimitMinutes * 60_000
  const remainingMs = deadline === null ? null : deadline - now

  return (
    <div className="grid gap-section">
      <header className="grid gap-inline">
        <h1 className="text-2xl font-semibold text-fg-primary">
          {view.title ?? t('untitledSurvey')}
        </h1>
        {view.description && <p className="text-base text-fg-secondary">{view.description}</p>}
        <p className="text-sm text-fg-secondary">
          {t('closesOn', { date: formatDate(view.endDate, locale) })}
        </p>
      </header>

      <AnonymityNotice anonymous={view.anonymous} />

      <ContentLanguageNotice
        requested={locale}
        resolvedLocale={view.resolvedLocale}
        fallbackCount={view.fallbackFields.length}
      />

      {view.showProgress && (
        <div className="grid gap-inline">
          <p className="text-sm text-fg-secondary">
            {t('progressCount', { answered, total })}
          </p>
          <Progress
            value={total === 0 ? 0 : Math.round((answered / total) * 100)}
            aria-label={t('progressLabel')}
          />
        </div>
      )}

      {remainingMs !== null && (
        <Alert variant={remainingMs <= 0 ? 'warning' : 'info'} role={remainingMs <= 0 ? 'alert' : 'status'}>
          <Info aria-hidden="true" />
          <AlertTitle>
            {remainingMs <= 0
              ? t('timeLimitExpired')
              : t('timeLimitRemaining', { time: formatDuration(remainingMs) })}
          </AlertTitle>
          <AlertDescription>
            {remainingMs <= 0 ? t('timeLimitExpiredHelp') : t('timeLimitHelp', { minutes: view.timeLimitMinutes ?? 0 })}
          </AlertDescription>
        </Alert>
      )}

      {/* `noValidate`: the browser's own required-field bubbles are untranslated,
          land on a radio rather than on the question, and cannot be announced.
          `missingRequired` does the same job with copy from the catalogue and moves
          focus onto the question itself. */}
      <form onSubmit={handleSubmit} noValidate className="grid gap-row">
        {questions.map((question, index) => (
          <RespondQuestionField
            key={question.id}
            question={question}
            position={index + 1}
            total={total}
            answer={answers[question.id]}
            invalid={invalidIds.includes(question.id)}
            disabled={busy !== 'idle'}
            onChange={(next) => updateAnswer(question.id, next)}
            onAnnounce={announce}
          />
        ))}

        {submitError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('submitFailed')}</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-inline">
          <Button type="submit" variant="primary" disabled={busy !== 'idle'}>
            {busy === 'submitting' ? tRoot('common.submitting') : t('submitResponse')}
          </Button>
          {view.allowPartialResponses && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== 'idle'}
              onClick={() => void send(false)}
            >
              {busy === 'saving' ? t('savingProgress') : t('saveProgress')}
            </Button>
          )}
        </div>
      </form>

      <LiveRegion>{announcement}</LiveRegion>
    </div>
  )
}

/**
 * The anonymity promise, stated precisely and in both directions.
 *
 * Telling someone a survey is anonymous is part of the consent, not decoration — and
 * the inverse matters just as much. A survey that records who answered must say so;
 * saying nothing lets a respondent assume the more private of the two.
 *
 * The wording tracks what the server actually does. An anonymous response is written
 * with no user id, no IP address and no user agent, and a demographic whose cohort is
 * too small is not recorded either, so "not linked to you" is a description of the
 * row rather than a promise about who looks at it.
 */
function AnonymityNotice({ anonymous }: { anonymous: boolean }) {
  const { t } = useTranslation('surveyRespond')

  return (
    <Alert variant={anonymous ? 'success' : 'info'}>
      {anonymous ? <EyeOff aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
      <AlertTitle>{anonymous ? t('anonymousTitle') : t('identifiedTitle')}</AlertTitle>
      <AlertDescription>
        {anonymous ? t('anonymousBody') : t('identifiedBody')}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Two independent signals, because either alone hides a real case (#195).
 *
 * `resolvedLocale !== requested` means the payload as a whole was served in another
 * language — a Spanish-only survey opened with the UI in English. `fallbackFields`
 * being non-empty means it resolved correctly at the top level but individual
 * questions had to reach for the other language.
 */
function ContentLanguageNotice({
  requested,
  resolvedLocale,
  fallbackCount,
}: {
  requested: string
  resolvedLocale: string
  fallbackCount: number
}) {
  const { t } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()

  if (resolvedLocale === requested && fallbackCount === 0) return null

  return (
    <Alert variant="warning">
      <Info aria-hidden="true" />
      <AlertTitle>{t('contentLanguageTitle')}</AlertTitle>
      <AlertDescription>
        {resolvedLocale !== requested &&
          t('contentLanguageBody', { language: tRoot(`language.${localeNameKey(resolvedLocale)}`) })}
        {fallbackCount > 0 && t('contentLanguageFields', { count: fallbackCount })}
      </AlertDescription>
    </Alert>
  )
}

function localeNameKey(locale: string): string {
  return locale === 'es' ? 'spanish' : 'english'
}

/**
 * Four distinct outcomes, kept distinct.
 *
 * The issue asks for expired, already-completed and closed to be handled separately,
 * and they genuinely are separate: gone, closed, not yours, and not available to an
 * anonymous visitor each have a different next step for the respondent. Collapsing
 * them into one "something went wrong" is what makes a respondent retry a survey that
 * closed a week ago.
 */
function LoadFailure({
  error,
  publicEntry,
}: {
  error: SurveyRespondError | null
  publicEntry: boolean
}) {
  const { t } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()

  const body = (): { title: string; description: string; signIn: boolean } => {
    switch (error?.status) {
      case 404:
        return { title: t('notFoundTitle'), description: t('notFoundBody'), signIn: false }
      case 400:
        return { title: t('closedTitle'), description: t('closedBody'), signIn: false }
      case 401:
        return publicEntry
          ? { title: t('unavailableTitle'), description: t('unavailableBody'), signIn: true }
          : { title: t('signInAgainTitle'), description: t('signInAgainBody'), signIn: true }
      case 403:
        return { title: t('notYoursTitle'), description: t('notYoursBody'), signIn: false }
      default:
        return {
          title: t('loadFailedTitle'),
          description: error?.message || tRoot('errors.generic'),
          signIn: false,
        }
    }
  }

  const { title, description, signIn } = body()

  return (
    <div className="grid gap-row">
      <Alert variant="warning" role="alert">
        <Info aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
      {signIn && (
        <p>
          <Link to="/login">{t('signIn')}</Link>
        </p>
      )}
    </div>
  )
}

function AlreadyCompleted() {
  const { t } = useTranslation('surveyRespond')

  return (
    <Alert variant="success" role="status">
      <ShieldCheck aria-hidden="true" />
      <AlertTitle>{t('alreadyCompletedTitle')}</AlertTitle>
      <AlertDescription>{t('alreadyCompletedBody')}</AlertDescription>
    </Alert>
  )
}

/**
 * The confirmation.
 *
 * `suppressedDemographics` is surfaced rather than dropped. A respondent whose
 * department is too small for its answers to stay anonymous has had that field
 * deliberately not recorded, and reporting a suppressed write as a plain success is
 * the same silent substitution the content-i18n rules forbid, wearing a different
 * hat.
 */
function Submitted({ result }: { result: SurveySubmissionResult }) {
  const { t } = useTranslation('surveyRespond')

  return (
    <div className="grid gap-row">
      <Alert variant="success" role="status">
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>
          {result.alreadySubmitted ? t('alreadyCompletedTitle') : t('thankYouTitle')}
        </AlertTitle>
        <AlertDescription>
          {result.alreadySubmitted ? t('alreadyCompletedBody') : t('thankYouBody')}
        </AlertDescription>
      </Alert>

      {result.suppressedDemographics.length > 0 && (
        <Alert variant="info">
          <EyeOff aria-hidden="true" />
          <AlertTitle>{t('suppressedTitle')}</AlertTitle>
          <AlertDescription>
            {t('suppressedBody', { fields: result.suppressedDemographics.join(', ') })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function formatDate(value: string, locale: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(parsed)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
