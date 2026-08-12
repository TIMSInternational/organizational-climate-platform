import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { EyeOff, Info, Lock, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  LiveRegion,
  Progress,
} from '../../../components/ui'
import { RespondCaption, RespondReading } from '../../../components/layout'
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
    return (
      <RespondSurface>
        <p className="text-base text-fg-secondary">{tRoot('common.loading')}</p>
      </RespondSurface>
    )
  }

  if (state.status === 'failed') {
    return (
      <RespondSurface>
        <LoadFailure error={state.error} publicEntry={publicEntry} />
      </RespondSurface>
    )
  }

  if (result) {
    return (
      <RespondSurface>
        <Submitted result={result} />
      </RespondSurface>
    )
  }

  if (view && view.inProgress?.isComplete) {
    return (
      <RespondSurface>
        <AlreadyCompleted />
      </RespondSurface>
    )
  }

  if (!view) return null

  const total = questions.length
  const answered = answeredCount(questions, answers)
  const deadline =
    view.timeLimitMinutes === null ? null : startedAt.current + view.timeLimitMinutes * 60_000
  const remainingMs = deadline === null ? null : deadline - now

  return (
    <RespondSurface>
      <RespondCaption
        eyebrow={t('eyebrow')}
        title={view.title ?? t('untitledSurvey')}
        description={view.description}
      />

      <ContentLanguageNotice
        requested={locale}
        resolvedLocale={view.resolvedLocale}
        fallbackCount={view.fallbackFields.length}
      />

      {/* One row on a phone, two columns from `lg` up: the questions take two
          thirds and the instrument panel the last third. The panel is FIRST in the
          DOM and moved to column three by `col-start`, so a respondent on a phone
          — which is how this page is mostly answered — meets the anonymity promise
          and the progress reading before the first question rather than after the
          last one. On a wide screen `lg:sticky lg:top-gutter` keeps both in view
          while the questions scroll past.

          That last part depends on something outside this file: NO ancestor of the
          panel may set `overflow` on either axis, because the used value of the
          other axis is then promoted to `auto` and that ancestor becomes the
          panel's scrollport. `RespondShell`'s `<main>` used to carry
          `overflow-x-auto` and never scrolls itself — the document does — so the
          panel was pinned to a box that never moved and left the viewport with the
          questions. `components/layout/respondSticky.test.tsx` is the guard, and
          `RespondShell` records the measurement. */}
      <div className="grid gap-panel-gap lg:grid-cols-3">
        <section
          aria-label={t('panelLabel')}
          className="grid gap-panel-gap self-start lg:sticky lg:top-gutter lg:col-start-3 lg:row-start-1"
        >
          <AnonymityNotice anonymous={view.anonymous} />

          {view.showProgress && (
            <div className="grid gap-inline rounded-lg border border-line-light bg-surface-icon-box p-3">
              <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
                {t('progressReading')}
              </span>
              {/* The reading, in mono with tabular figures — the one typographic
                  rule that makes this read as an instrument. `aria-hidden` because
                  the sentence below says the same thing in words, and a screen
                  reader announcing "0 / 1" and then "0 of 1 questions answered" is
                  the same fact twice. */}
              <span
                aria-hidden="true"
                className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-fg-primary"
              >
                {`${answered} / ${total}`}
              </span>
              {/* The track is `bg-surface-panel`, not the default. `Progress`'s
                  own track is `bg-surface-icon-box` — the same token this tile
                  sits on — so at zero answers the bar vanished into the tile
                  completely. Seen in Chromium; invisible to happy-dom, which
                  computes no colour at all. */}
              <Progress
                className="bg-surface-panel"
                value={total === 0 ? 0 : Math.round((answered / total) * 100)}
                aria-label={t('progressLabel')}
              />
              <span className="text-xs text-fg-secondary">
                {t('progressCount', { answered, total })}
              </span>
            </div>
          )}

          {remainingMs !== null && remainingMs > 0 && (
            <RespondReading
              label={t('timeReading')}
              value={formatDuration(remainingMs)}
              sub={t('timeLimitHelp', { minutes: view.timeLimitMinutes ?? 0 })}
            />
          )}

          {/* One reading per row, flush with every tile above it, and NOT a
              two-column grid. It was `sm:grid-cols-2 lg:grid-cols-1
              xl:grid-cols-2`, which put CLOSES in a half-width tile with a
              stranded empty cell beside it at every viewport from 640px up —
              because its second child only exists when the survey turned progress
              OFF, which is the rarer case. Measured in Chromium at 1440x900: a
              402px panel with a 197px CLOSES tile under three 402px ones. A column
              of readings that are all the same width is also what makes them
              scannable as one instrument. */}
          <RespondReading label={t('closesReading')} value={formatDate(view.endDate, locale)} />
          {/* Only when the survey turned progress OFF. With the progress tile
              above it, `Questions 5` says the same thing the denominator of
              `0 / 5` already said, and two tiles reporting one fact is what
              makes an instrument panel read as decoration. */}
          {!view.showProgress && (
            <RespondReading label={t('questionsReading')} value={String(total)} />
          )}
        </section>

        {/* `noValidate`: the browser's own required-field bubbles are untranslated,
            land on a radio rather than on the question, and cannot be announced.
            `missingRequired` does the same job with copy from the catalogue and moves
            focus onto the question itself. */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="grid gap-panel-gap lg:col-span-2 lg:col-start-1 lg:row-start-1"
        >
          {/* The expired countdown stays with the questions rather than in the
              panel: it is an alert about what the respondent is doing right now,
              and `role="alert"` beside the form is where it will be read. */}
          {remainingMs !== null && remainingMs <= 0 && (
            <Alert variant="warning" role="alert">
              <Info aria-hidden="true" />
              <AlertTitle>{t('timeLimitExpired')}</AlertTitle>
              <AlertDescription>{t('timeLimitExpiredHelp')}</AlertDescription>
            </Alert>
          )}

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
      </div>

      <LiveRegion>{announcement}</LiveRegion>
    </RespondSurface>
  )
}

/**
 * The one panel on the page.
 *
 * Every state this component can be in renders inside it — the form, the four
 * unavailable states, the confirmation — so a respondent who lands on a closed
 * survey gets a page rather than a sentence floating on a grey field. `flex-1`
 * fills the column `RespondShell`'s `<main>` gives it, for the same reason
 * `AdminLayout`'s content panel carries `min-h-full`.
 */
function RespondSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel">
      {children}
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
 *
 * ## Why it is the first thing in the panel, and not an alert in the flow
 *
 * This is the only surface an ordinary employee ever sees, and it decides whether
 * they answer honestly. So the promise sits at the top of the instrument panel:
 * first on a phone, and held in view by `sticky` on a wide screen while the
 * questions scroll past it — measured at 1440x900 on /survey/s1, the panel is at
 * `rect.top = 12px` at the page's maximum scroll, which is `top-gutter`. It was a
 * plain `Alert` in the run of the page before,
 * which put it above the fold once and then out of sight for the rest of a
 * forty-question survey.
 *
 * ## The state is carried by a word, never by the colour
 *
 * Green means anonymous and blue means identified, but the chip beside the icon
 * spells out which — WCAG 1.4.1, and the same rule the rest of the redesign keeps:
 * colour does one job and never carries meaning alone.
 */
function AnonymityNotice({ anonymous }: { anonymous: boolean }) {
  const { t } = useTranslation('surveyRespond')

  return (
    <section
      className={
        anonymous
          ? 'grid gap-inline rounded-xl border border-accent-green-ring bg-accent-green-soft p-card'
          : 'grid gap-inline rounded-xl border border-accent-blue-ring bg-accent-blue-soft p-card'
      }
    >
      <span className="flex items-center gap-inline">
        <span
          className={
            anonymous
              ? 'grid size-icon-box shrink-0 place-items-center rounded-md text-accent-green'
              : 'grid size-icon-box shrink-0 place-items-center rounded-md text-accent-blue'
          }
        >
          {anonymous ? (
            <EyeOff aria-hidden="true" className="size-icon" />
          ) : (
            <ShieldCheck aria-hidden="true" className="size-icon" />
          )}
        </span>
        {/* The word is `text-fg-secondary`, NOT the accent. Measured against the
            soft fill it sits on, `text-accent-green` is 3.49:1 in light and
            `text-accent-blue` is 3.40:1 — both under AA for text this size, and
            both perfectly legal classes that compile fine, which is the shape of
            failure this feature's contrast guard exists for. The accent stays on
            the icon, which is not text and does not carry the meaning. */}
        <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
          {anonymous ? t('anonymousChip') : t('identifiedChip')}
        </span>
      </span>
      <h2 className="text-base font-semibold text-fg-primary">
        {anonymous ? t('anonymousTitle') : t('identifiedTitle')}
      </h2>
      <p className="text-sm text-fg-secondary">
        {anonymous ? t('anonymousBody') : t('identifiedBody')}
      </p>
    </section>
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
    <div className="grid gap-panel-gap">
      <Alert variant="success" role="status">
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>
          {result.alreadySubmitted ? t('alreadyCompletedTitle') : t('thankYouTitle')}
        </AlertTitle>
        <AlertDescription>
          {result.alreadySubmitted ? t('alreadyCompletedBody') : t('thankYouBody')}
        </AlertDescription>
      </Alert>

      {/* The receipt. A respondent who has just handed over forty answers with no
          copy of them gets one reading back: how many of the questions were
          recorded. It is the server's own count, not the form's — what was stored,
          rather than what was typed. */}
      <div className="max-w-field">
        <RespondReading
          label={t('receiptReading')}
          value={String(result.answeredQuestionCount)}
          sub={t('receiptSub', { total: result.questionCount })}
        />
      </div>

      {result.suppressedDemographics.length > 0 && (
        // Protected is SHOWN, never hidden: a detail that was deliberately not
        // recorded is named, with the padlock and the word `protected` beside it,
        // rather than quietly omitted from a plain success message.
        //
        // Deliberately not `charts/ProtectedCell`: that primitive decides
        // suppression itself from a response count against the anonymity floor, and
        // its label states the floor ("withheld below 5 responses"). Neither number
        // reaches this page — `SurveySubmissionResult` carries the suppressed field
        // names and neither a cohort count nor the company's floor — so rendering it
        // here would mean inventing a count to force the suppressed branch and
        // announcing a threshold this page cannot know.
        // The count behind a suppressed value is never displayed here either, which
        // is the rule that primitive exists to keep.
        <Alert variant="info">
          <EyeOff aria-hidden="true" />
          <AlertTitle>
            <span className="flex flex-wrap items-center gap-inline">
              {t('suppressedTitle')}
              <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-default bg-surface-icon-box px-2 py-0.5 text-2xs font-semibold uppercase tracking-label text-fg-secondary">
                <Lock aria-hidden="true" className="size-3" />
                {t('protectedChip')}
              </span>
            </span>
          </AlertTitle>
          <AlertDescription>
            {t('suppressedBody', { fields: result.suppressedDemographics.join(', ') })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/**
 * `medium` rather than `long`.
 *
 * The closing date is a reading in the instrument panel now, not a sentence in the
 * run of the page. `long` renders "11 de septiembre de 2026", which wrapped onto
 * two lines inside the tile at every width measured; `medium` is "11 sept 2026",
 * which is the same fact at the size a reading wants to be.
 */
function formatDate(value: string, locale: string): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parsed)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
