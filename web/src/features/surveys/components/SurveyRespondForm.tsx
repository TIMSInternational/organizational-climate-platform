import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link } from 'react-router'
import { Clock, EyeOff, FileText, Info, Lock, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  LiveRegion,
  Progress,
} from '../../../components/ui'
// Straight from the module rather than from `components/charts`, which is the one
// place this project asks callers to import charts from. The floor is a policy
// about data, not a chart, and this is the one page an unauthenticated visitor
// loads — reaching through the barrel would put every chart module in its import
// graph to read a single integer.
import { ANONYMITY_FLOOR } from '../../../components/charts/suppression'
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
import { respondDimensions, type RespondSection } from '../respondDimensions'
import { dimensionLabel } from '../dimensionLabel'
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
// Cross-feature, and the established pattern for this module: microclimates and
// analytics both reach for the dashboard's grammar helpers. `MonoReadings` is where
// "a translated sentence whose numbers are readings" is solved once.
import { MonoReadings } from '../../dashboard/components/dashboardGrammar'

export interface SurveyRespondFormProps {
  surveyId: string
  /**
   * True on the unauthenticated `/survey/:id` route.
   *
   * Changes exactly two things. **What a 401 means:** behind `RequireAuth` a 401 is a
   * stale token and the answer is "sign in again"; on the public route it means the
   * survey is either closed or not open to anonymous respondents, and the server
   * deliberately does not say which — telling an unauthenticated visitor "this exists
   * but is not anonymous" is a disclosure about a tenant's survey they have no claim
   * to. And **whether the confirmation offers a way back into the app**: a visitor
   * holding nothing but a link has no Home to be sent to, so the link is not drawn
   * for them rather than drawn and then bounced off `RequireAuth`.
   */
  publicEntry?: boolean
  /**
   * Called once, after the server has accepted a **complete** submission.
   *
   * Exists for `/survey-invitations/:token`, which has to close the invitation ladder
   * by posting `completed` — the third of the three state routes, and the only rung
   * this form is in a position to know about. A partial save does not fire it: the
   * ladder's `completed` means finished, and reporting it when somebody pressed "save
   * and finish later" would make an admin's invitation list say people had answered
   * when they had not.
   *
   * Deliberately not called on the `alreadySubmitted` path either. That branch means
   * the server matched an existing complete response for this session, so nothing was
   * written just now; the rung was already reported by whichever visit did write one,
   * and the server's monotonic rule would ignore it anyway. Not firing it keeps the
   * callback's meaning ("a response was just accepted") true rather than nearly true.
   */
  onSubmitted?: () => void
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
 * gates the shuffle — and, through `respondDimensions`, the dimension headings —
 * and `TimeLimitMinutes` gates the countdown. Each one is off unless the survey
 * turned it on.
 *
 * **`AutoSave` is the exception, and it is a gap rather than a decision.** The
 * setting exists on `SurveySettingsDto`, but `SurveyRespondView` — the payload this
 * page is served — does not carry it, so this page cannot know whether the author
 * asked for it. Auto-saving anyway would be inventing behaviour for every survey that
 * did not; the save button is offered instead, gated on the flag that *is* served.
 *
 * ## The shape the approved employee design asks for
 *
 * One column, not two. The anonymity promise is the first block on the page, the
 * questions run under dimension headings beneath it, and the answered count and the
 * two actions ride a bar stuck to the bottom of the viewport. The design's note says
 * why the instrument panel that used to hold all three moved: its position cost the
 * form a third of the width, left a column of white space below the fold, and did
 * not exist at all on a phone — which is where this page is mostly answered.
 */
export default function SurveyRespondForm({
  surveyId,
  publicEntry = false,
  onSubmitted,
}: SurveyRespondFormProps) {
  const { t, locale } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [invalidIds, setInvalidIds] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<'idle' | 'saving' | 'submitting'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<SurveySubmissionResult | null>(null)
  // The wall-clock moment the server accepted the response, kept because nothing in
  // `SurveySubmissionResult` carries one and the confirmation says "submitted at
  // 09:14". Recorded here rather than read off the clock while rendering, so the
  // time does not creep forward every time the confirmation re-renders.
  const [submittedAt, setSubmittedAt] = useState<number | null>(null)
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

  // Read out of `view` into a scalar first, so the memo below depends on a boolean
  // rather than on the whole payload — and so the dependency array is exactly what
  // it looks like.
  const randomizeQuestions = view?.randomizeQuestions ?? false

  // The grouping is `respondDimensions`' decision, never this page's: the same
  // normalisation the results screen aggregates by, so the respondent is asked under
  // the headings the analysis will report under. It returns the whole form either
  // way — `sectioned: false` means "print no headings", not "here is half of it".
  const dimensions = useMemo(
    () => respondDimensions(questions, randomizeQuestions),
    [questions, randomizeQuestions],
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
        setSubmittedAt(Date.now())
        setResult(submission)
        // After the state updates, never before: whatever the caller does with this
        // must not be able to stand between the respondent and their confirmation.
        // `alreadySubmitted` is excluded for the reason written on the prop.
        if (!submission.alreadySubmitted) onSubmitted?.()
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
        <Submitted
          result={result}
          endDate={view?.endDate ?? null}
          submittedAt={submittedAt}
          locale={locale}
          publicEntry={publicEntry}
        />
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

      {/* The promise, first and full width.
          It used to be the top tile of a right-hand rail. The rail held the right
          content and put it in the wrong place: a third of the width gone from the
          form, a column of white space below the fold, and — because it collapsed at
          `lg` — nothing at all on a phone until after the last question. Here it is
          the first thing every respondent reads on every viewport, which is what a
          promise that decides whether they answer honestly is worth. */}
      <AnonymityNotice anonymous={view.anonymous} />

      {/* The rail's readings, relocated rather than deleted: when the survey closes,
          how long it suggests, and — only when the survey turned progress off — how
          many questions there are.
          `grid-flow-col` with `auto-cols-fr` from `sm` up, NOT `sm:grid-cols-2`.
          A fixed track count strands an empty cell whenever the optional readings are
          absent, which is the common case: the rail shipped exactly that defect, a
          197px CLOSES tile beside a hole at every viewport from 640px up. Auto
          columns are as wide as there are readings to put in them. */}
      <section
        aria-label={t('panelLabel')}
        className="grid gap-panel-gap sm:grid-flow-col sm:auto-cols-fr"
      >
        <RespondReading label={t('closesReading')} value={formatDate(view.endDate, locale)} />
        {remainingMs !== null && remainingMs > 0 && (
          <RespondReading
            label={t('timeReading')}
            value={formatDuration(remainingMs)}
            sub={t('timeLimitHelp', { minutes: view.timeLimitMinutes ?? 0 })}
          />
        )}
        {/* Only when the survey turned progress OFF. With the count in the bottom
            bar, `Questions 5` says the same thing the denominator of `0 of 5`
            already said, and two readings of one fact is what makes an instrument
            read as decoration. */}
        {!view.showProgress && (
          <RespondReading label={t('questionsReading')} value={String(total)} />
        )}
      </section>

      {/* `noValidate`: the browser's own required-field bubbles are untranslated,
          land on a radio rather than on the question, and cannot be announced.
          `missingRequired` does the same job with copy from the catalogue and moves
          focus onto the question itself. */}
      <form onSubmit={handleSubmit} noValidate className="grid gap-panel-gap">
        {/* The expired countdown stays with the questions: it is an alert about what
            the respondent is doing right now, and `role="alert"` beside the form is
            where it will be read. */}
        {remainingMs !== null && remainingMs <= 0 && (
          <Alert variant="warning" role="alert">
            <Info aria-hidden="true" />
            <AlertTitle>{t('timeLimitExpired')}</AlertTitle>
            <AlertDescription>{t('timeLimitExpiredHelp')}</AlertDescription>
          </Alert>
        )}

        {dimensions.sections.map((section) => (
          <Fragment key={section.key}>
            {dimensions.sectioned && <DimensionHeading section={section} total={total} />}
            {section.questions.map((question, index) => (
              <RespondQuestionField
                key={question.id}
                question={question}
                // `firstIndex` is the section's 1-based place in READING order, so
                // the numbering runs 1..n down the page across every heading rather
                // than restarting inside each one.
                position={section.firstIndex + index}
                total={total}
                answer={answers[question.id]}
                invalid={invalidIds.includes(question.id)}
                disabled={busy !== 'idle'}
                onChange={(next) => updateAnswer(question.id, next)}
                onAnnounce={announce}
              />
            ))}
          </Fragment>
        ))}

        {submitError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('submitFailed')}</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <SubmitBar
          answered={answered}
          total={total}
          showProgress={view.showProgress}
          allowPartialResponses={view.allowPartialResponses}
          busy={busy}
          onSave={() => void send(false)}
        />
      </form>

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
 *
 * Exported because the two token-addressed link pages (`/s/:token` and
 * `/survey-invitations/:token`) render states of their own — resolving, a dead link,
 * an invitation's landing card — *before* this form ever mounts, and they have to sit
 * on the same panel. Re-typing these classes in two more files is how a page comes to
 * be half a step off the one it hands over to.
 */
export function RespondSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel">
      {children}
    </div>
  )
}

/**
 * The heading over one run of questions, with the range it covers.
 *
 * The design prints `PSYCHOLOGICAL SAFETY ———— 1–2 OF 12`: an eyebrow, a rule that
 * takes up the slack, and a reading of where in the form the respondent is. Its note
 * says why an ungrouped run of twelve questions is the thing being fixed — twelve on
 * one page is right, because a wizard makes "save and finish later" meaningless and
 * hides how much is left, but an unsectioned list tells the respondent nothing about
 * what is being asked.
 *
 * The rule is `aria-hidden` decoration. The range is not: it is the same fact the
 * question index gives, at the granularity of the section, and it is set in mono
 * with tabular figures like every other reading on this page.
 */
function DimensionHeading({ section, total }: { section: RespondSection; total: number }) {
  const { t } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()

  // "3 of 12" for a section of one, "1–2 of 12" for the rest. A range whose ends are
  // equal reads as an error rather than as a single question.
  const range =
    section.firstIndex === section.lastIndex
      ? t('dimensionPosition', { position: section.firstIndex, total })
      : t('dimensionRange', { from: section.firstIndex, to: section.lastIndex, total })

  const label = dimensionLabel(section.key, tRoot)

  return (
    /*
      `min-w-0` on the ROW, not only on the eyebrow.

      This row is a grid item of the `<form className="grid">` above, and a grid item's
      automatic minimum size is its min-content width. The eyebrow below is `truncate`,
      i.e. `white-space: nowrap`, so the row's min-content width is the whole category
      on one line — and the track grows to fit it, carrying the page with it. Measured
      before this class existed: a 100-character category rendered the respond page 983
      CSS px wide inside a 390 px viewport, ellipsising the eyebrow nine hundred pixels
      out and carrying the question cards past the viewport edge with it. `truncate` on
      the child does not bound anything while its parent is free to grow.
    */
    <div className="flex min-w-0 items-center gap-inline pt-2">
      {/*
        `min-w-0 truncate`, and `title` so nothing is lost.

        Until an uncatalogued category could reach this slot, only the catalogue's own
        short strings could, and the row could not be overrun. Now the author's
        own `varchar(100)` lands here: a hundred characters of eyebrow would either
        squeeze the rule to nothing and push the range off the row, or — with
        `min-w-0` alone — wrap the eyebrow to three lines and drag the rule and the
        reading down with it. `truncate` keeps the design's one-line eyebrow and
        `title` keeps the whole category reachable, which matters because it is the
        author's text and not ours to discard.
      */}
      <h2
        title={label}
        className="min-w-0 truncate text-2xs font-semibold uppercase tracking-eyebrow text-fg-secondary"
      >
        {label}
      </h2>
      {/*
        `min-w-8` so the rule is still a rule at the point the heading has taken the
        row: `flex-1` is `flex: 1 1 0%`, whose basis is zero, so it is the first thing
        a long heading shrinks away to nothing.
      */}
      <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-line-light" />
      {/*
        `shrink-0`: the range is a reading, not decoration. An ellipsised `1–2 OF…` is
        worse than an ellipsised heading, because a truncated number reads as a
        different number.
      */}
      <span className="shrink-0 font-mono text-xs tabular-nums text-fg-secondary">{range}</span>
    </div>
  )
}

/**
 * The bar the respondent finishes from, stuck to the bottom of the viewport.
 *
 * It carries what the right-hand rail used to: how much is answered, and the two
 * things that can be done about it. The design's reasoning is that a respondent
 * eight questions into twelve should never have to scroll to find out how many are
 * left or to stop for the day — and on a phone, where this page is mostly answered,
 * the rail was not rendered at all.
 *
 * ## Why `sticky` and not `fixed`
 *
 * `fixed` takes the bar out of flow and it then overlaps the last question at the
 * end of the document, where there is nothing left to scroll. `sticky` is in flow:
 * it rides the viewport while there is content below it and comes to rest above the
 * panel's bottom edge when there is not.
 *
 * There is no negative bottom margin on it, deliberately. Sticky positioning
 * constrains the MARGIN box, so `-mb-panel` with `bottom-0` would push the bar's
 * border box that far below the viewport and clip it — the full bleed is horizontal
 * only.
 *
 * ## What stays gated
 *
 * `ShowProgress` is a survey setting, and it gates the whole progress cluster here
 * exactly as it gated the tile before. A survey that turned progress off gets a bar
 * of two buttons, and the question count moves up to the readings row.
 */
function SubmitBar({
  answered,
  total,
  showProgress,
  allowPartialResponses,
  busy,
  onSave,
}: {
  answered: number
  total: number
  showProgress: boolean
  allowPartialResponses: boolean
  busy: 'idle' | 'saving' | 'submitting'
  onSave: () => void
}) {
  const { t, locale } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()

  return (
    <div
      data-slot="respond-submit-bar"
      className="sticky bottom-0 -mx-panel flex flex-wrap items-center justify-between gap-panel-gap border-t border-line-panel bg-surface-panel px-panel py-card"
    >
      {showProgress && (
        <span className="flex min-w-0 items-center gap-inline">
          {/* The track is `bg-surface-icon-box` against the panel it sits on, which
              is `Progress`'s own default — unlike the tile this replaced, where the
              track and the tile were the same token and the bar vanished at zero. */}
          <Progress
            className="w-32"
            value={total === 0 ? 0 : Math.round((answered / total) * 100)}
            aria-label={t('progressLabel')}
          />
          {/* Numerals in mono, prose in sans — `MonoReadings` exists for exactly this
              sentence shape, and the rule is not decorative: the countdown two
              readings away is already asserted `font-mono tabular-nums`, so setting
              this one in the sans face made a single instrument print its two
              readings in two typefaces. Tabular figures come with it, which is what
              stops the line reflowing on every answer. */}
          <span className="text-sm text-fg-secondary">
            <MonoReadings
              t={t}
              messageKey="answeredOfTotal"
              params={{ answered, total }}
              locale={locale}
            />
          </span>
        </span>
      )}

      {/* Save first, submit last, which is the order the design draws and the order
          the two actions are reached in: the destination is on the right. */}
      <span className="flex flex-wrap gap-inline">
        {allowPartialResponses && (
          <Button type="button" variant="secondary" disabled={busy !== 'idle'} onClick={onSave}>
            {busy === 'saving' ? t('savingProgress') : t('saveAndFinishLater')}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy !== 'idle'}>
          {busy === 'submitting' ? tRoot('common.submitting') : t('submitResponse')}
        </Button>
      </span>
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
 * ## Why it is the first block on the page
 *
 * This is the only surface an ordinary employee ever sees, and it decides whether
 * they answer honestly. It was a plain `Alert` in the run of the page once — above
 * the fold and then out of sight for the rest of a forty-question survey — and then
 * the top tile of a sticky right-hand rail, which held it in view on a wide screen
 * and did not exist at all below `lg`. It is now the first full-width block under
 * the title on every viewport, which is the one placement that does not depend on
 * the width of the screen it is read on.
 *
 * ## The state is carried by a word, never by the colour
 *
 * Green means anonymous and blue means identified, but the chip beside the icon
 * spells out which — WCAG 1.4.1, and the same rule the rest of the redesign keeps:
 * colour does one job and never carries meaning alone.
 *
 * ## Why it is exported
 *
 * `/survey-invitations/:token` shows a landing card before the questions load, and the
 * moment a respondent decides whether to answer honestly is the moment they press
 * "start", not the moment the first question paints. The promise has to be on that card
 * — and it has to be *this* promise, character for character, because two blocks that
 * both claim to describe how a response is stored and disagree by a clause is worse
 * than one of them not existing.
 */
export function AnonymityNotice({ anonymous }: { anonymous: boolean }) {
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

/** The `<h2>` that names the what-happens-now list to assistive technology. */
const WHAT_HAPPENS_HEADING_ID = 'respond-what-happens-now'

/**
 * The confirmation.
 *
 * The design calls this the moment the respondent is most owed something: they have
 * just handed over forty answers, they will never be shown a copy of them, and the
 * page they are looking at is the last one most of them will ever see. So it answers
 * the three questions that are actually outstanding — what happens to the answers,
 * when the survey closes, when results come back — and then says plainly why there
 * is no copy.
 *
 * ## Everything here is already in hand
 *
 * No second request. The close date is `SurveyRespondView.endDate`, the count is the
 * server's own `answeredQuestionCount`, the floor is the platform constant Company
 * Settings shows as a locked control, and the anonymity wording is the flag the form
 * has been rendering all along. A confirmation that had to fetch something could
 * fail after a response was accepted, which is the one failure this page must never
 * have.
 *
 * `suppressedDemographics` is surfaced rather than dropped. A respondent whose
 * department is too small for its answers to stay anonymous has had that field
 * deliberately not recorded, and reporting a suppressed write as a plain success is
 * the same silent substitution the content-i18n rules forbid, wearing a different
 * hat.
 */
function Submitted({
  result,
  endDate,
  submittedAt,
  locale,
  publicEntry,
}: {
  result: SurveySubmissionResult
  /** `SurveyRespondView.endDate`, or null if the view never loaded. */
  endDate: string | null
  /** When the server accepted it, or null on the already-submitted path. */
  submittedAt: number | null
  locale: string
  publicEntry: boolean
}) {
  const { t } = useTranslation('surveyRespond')

  // `alreadySubmitted` means the server matched an existing complete response for
  // this session, so nothing was written just now — "submitted at 09:14" would be a
  // statement about a moment that did not happen. The receipt below is still the
  // server's own count of what is stored, which is true in both cases.
  const justSubmitted = !result.alreadySubmitted && submittedAt !== null
  const closesOn = endDate === null ? null : formatDate(endDate, locale, 'long')

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

      {justSubmitted && (
        <p className="max-w-prose text-base text-fg-secondary">
          {t('submittedSummary', {
            count: result.answeredQuestionCount,
            time: formatTime(submittedAt, locale),
          })}
        </p>
      )}

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

      <section
        aria-labelledby={WHAT_HAPPENS_HEADING_ID}
        className="overflow-hidden rounded-xl border border-line-light"
      >
        <h2
          id={WHAT_HAPPENS_HEADING_ID}
          className="border-b border-line-light bg-surface-icon-box px-card py-2 text-2xs font-semibold uppercase tracking-label text-fg-secondary"
        >
          {t('whatHappensNowTitle')}
        </h2>
        <ul className="grid">
          <WhatHappensRow
            icon={<Lock aria-hidden="true" className="size-icon" />}
            title={t('happensPooledTitle')}
            body={t('happensPooledBody', { floor: ANONYMITY_FLOOR })}
          />
          {/* Dropped rather than guessed at when the payload never loaded — a date
              is the one part of this the page cannot approximate. */}
          {closesOn !== null && (
            <WhatHappensRow
              icon={<Clock aria-hidden="true" className="size-icon" />}
              title={t('happensClosesTitle', { date: closesOn })}
              body={t('happensClosesBody')}
            />
          )}
          <WhatHappensRow
            icon={<FileText aria-hidden="true" className="size-icon" />}
            title={t('happensResultsTitle')}
            body={t('happensResultsBody')}
          />
        </ul>
      </section>

      {/* Only for a respondent who has an account to go back to. On `/survey/:id`
          the visitor may hold nothing but the link they followed, and a Home link
          there is a round trip through `RequireAuth` to a sign-in form nobody asked
          for. */}
      {!publicEntry && (
        <p>
          <Button asChild variant="secondary">
            <Link to="/dashboard">{t('backToHome')}</Link>
          </Button>
        </p>
      )}

      <p className="max-w-prose text-sm text-fg-secondary">{t('noCopyNote')}</p>
    </div>
  )
}

/**
 * One row of the what-happens-now list: an icon that is decoration, a claim, and the
 * sentence that makes the claim checkable.
 *
 * The icon is `text-fg-secondary` rather than the accent. Three accent glyphs down a
 * confirmation reads as three statuses, and none of these is a status — they are the
 * same fact told in three parts.
 */
function WhatHappensRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  /** Already-translated. */
  title: string
  /** Already-translated. */
  body: string
}) {
  return (
    <li className="flex items-start gap-inline border-b border-line-light p-card last:border-b-0">
      <span className="shrink-0 pt-0.5 text-fg-secondary">{icon}</span>
      <span className="grid gap-0.5">
        <span className="text-base font-medium text-fg-primary">{title}</span>
        <span className="text-sm text-fg-secondary">{body}</span>
      </span>
    </li>
  )
}

/**
 * `medium` for a reading, `long` for a sentence.
 *
 * The closing date is a reading in the row above the questions, and `long` renders
 * "11 de septiembre de 2026", which wrapped onto two lines inside the tile at every
 * width measured; `medium` is "11 sept 2026", which is the same fact at the size a
 * reading wants to be. The confirmation says "The survey closes on 11 September
 * 2026" in the run of a sentence, where the abbreviation is the thing that reads
 * wrong.
 *
 * ## `timeZone: 'UTC'`, and it is a correctness fix rather than a preference
 *
 * A survey's `endDate` is the END OF A CALENDAR DAY, and the API stamps it as one:
 * the seeded Q3 closes at `2026-08-05T23:59:59+00:00`. Formatted in the reader's own
 * zone, that instant is **6 August** in Madrid and in Tokyo — so every respondent east
 * of UTC was told a deadline one day later than the one the server enforces, on the
 * screen whose entire job is to say when to answer by.
 *
 * This is the bug `lib/calendarDay.ts` exists to prevent, and it survived the sweep
 * that routed every date through it because that sweep matched `toLocaleDateString`
 * and this reaches for `Intl.DateTimeFormat`. `calendarDay` itself is not used here:
 * it renders one short form ("11 sept") by design, and this needs two styles, one of
 * them a long form that sits inside a sentence. Same rule, different presentation —
 * so the rule is copied rather than the helper.
 */
function formatDate(value: string, locale: string, dateStyle: 'medium' | 'long' = 'medium'): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Intl.DateTimeFormat(locale, { dateStyle, timeZone: 'UTC' }).format(parsed)
}

/** The wall-clock time a response was accepted, e.g. "09:14". */
function formatTime(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(value)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
