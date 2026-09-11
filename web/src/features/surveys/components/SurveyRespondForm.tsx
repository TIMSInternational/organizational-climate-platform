import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  EyeOff,
  FileText,
  Info,
  Lock,
  ShieldCheck,
} from 'lucide-react'
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
import {
  hydrateAnswers,
  missingRequired,
  orderQuestions,
  toAnswerInputs,
  type AnswerMap,
  type AnswerState,
} from '../respondAnswers'
import { estimatedMinutes, formatDayMonth, isUnderAMinute } from '../respondEstimate'
import { AnonymityNotice } from './AnonymityNotice'
import {
  RESPOND_AUTOSAVE_DELAY_MS,
  RESPOND_SAVE_IDLE,
  clearedQuestionIds,
  answerSignature,
  firstUnansweredQuestion,
  hasProgressToSave,
  respondAutosaveAllowed,
  type RespondSaveState,
} from '../respondAutosave'
import { respondDimensions } from '../respondDimensions'
import { dimensionLabel } from '../dimensionLabel'
import { clearSessionId, ensureSessionId } from '../respondSession'
import {
  SurveyRespondError,
  getSurveyRespondView,
  submitSurveyResponse,
  type SurveyAnswerInput,
  type SurveyRespondView,
  type SurveySubmissionResult,
} from '../api/surveyResponses'
import { questionFieldId } from '../respondFieldIds'
import RespondQuestionField from './RespondQuestionField'

// Re-exported because `/survey-invitations/:token`'s landing card has always imported the
// promise from here; it moved to its own module so the employee's Home can draw the very
// same block beside the survey it is about.
export { AnonymityNotice }

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
 * `error` is sticky until a save actually succeeds, and these two transitions are
 * where that is enforced (#369).
 *
 * The failure mode being designed against is not "the save failed"; it is "the save
 * has been failing for ten minutes and the page looks fine". A respondent who believes
 * their answers are being kept stops taking care not to lose them. So neither
 * scheduling a retry nor starting one is allowed to take the warning down — only the
 * write landing does. Written as module-level reducers rather than inline closures so
 * the rule is stated once and cannot drift between the three callers.
 */
function markPending(previous: RespondSaveState): RespondSaveState {
  return previous.status === 'idle' || previous.status === 'saved'
    ? { ...previous, status: 'pending' }
    : previous
}

function markSaving(previous: RespondSaveState): RespondSaveState {
  return previous.status === 'error' ? previous : { ...previous, status: 'saving', message: null }
}

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
 * **`AutoSave` was the exception, and #369 closed it.** The setting existed on
 * `SurveySettingsDto` and `SurveyRespondView` did not carry it, so this page could not
 * know whether the author had asked for background saving and offered the button to
 * every survey instead. The payload now carries it, and `respondAutosaveAllowed` gates
 * on it alongside `AllowPartialResponses`.
 *
 * ## Keeping progress without being asked (#369)
 *
 * The product is committed in writing to letting a respondent stop part-way and come
 * back. Two things stood between it and that promise, and both are here:
 *
 * 1. **Progress was written only when the button was pressed.** A debounce now posts a
 *    partial save `RESPOND_AUTOSAVE_DELAY_MS` after an answer changes, and a second
 *    save fires when the page is hidden or closed so the debounce window itself cannot
 *    lose anything. Nothing is written before the first answer exists, because an empty
 *    partial save creates a real `responses` row — a write per visitor who merely
 *    opened the link, and on an identified survey a record that a named employee opened
 *    a survey they never answered.
 * 2. **Resuming brought the answers back and left the respondent at the top.** Focus
 *    now moves to the first question they have not answered, using the same
 *    `questionFieldId` machinery a failed submit already used, and says so through the
 *    live region.
 *
 * **A background save is never silent.** The save state is printed in the bar the
 * respondent finishes from, and a failure is a `role="alert"` panel that stays until a
 * save succeeds — an autosave that has quietly stopped is worse than none at all,
 * because the button at least reported `busy === 'saving'`.
 *
 * **It widens nothing about anonymity.** An autosave posts the identical body the
 * button posts — the answers, the session id, `isComplete: false` and the language the
 * respondent read — so the guarantee in #116 is untouched: an anonymous response still
 * stores no user id, no IP and no user agent, and demographics are captured only on
 * completion.
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
  // Whether anything the respondent has typed is anywhere but this screen (#369).
  // Starts `idle` rather than `saved`: nothing has been answered, so there is nothing
  // to reassure anybody about, and "saved" on a form nobody has touched is a claim
  // about a write that never happened.
  const [saveState, setSaveState] = useState<RespondSaveState>(RESPOND_SAVE_IDLE)
  /**
   * Bumped every time a save lands, for no reason except to make the debounce below
   * reconsider.
   *
   * `serverAnswered` only learns what the server holds at the moment a save RESOLVES, and
   * it is a ref, so it changes nothing on screen. An answer taken back while the first
   * save was still on the wire was therefore compared against a set that was still empty,
   * named nothing for deletion, and the effect never ran again to notice — the erasure
   * was dropped on the floor. This is the edge that makes the effect re-derive it.
   */
  const [savesLanded, setSavesLanded] = useState(0)
  /**
   * The question on screen, as an index into `questions`.
   *
   * The canvas asks one question at a time (RespondSurveyPhone, 10 Sep; the triage's
   * "one question at a time on small screens"), with Anterior and Siguiente under the
   * card. Only the presentation is paged: the answer map, the autosave, the resume and
   * the one POST that completes the response are the same ones the single long form
   * had, over the whole survey, whatever page is showing.
   */
  const [page, setPage] = useState(0)
  /**
   * The question whose fieldset takes focus once it is the one on screen.
   *
   * State rather than a direct `focus()` because a page turn has to render the new
   * question before there is anything to focus — the fieldset of the next question does
   * not exist while the current one is drawn.
   */
  const [focusTarget, setFocusTarget] = useState<string | null>(null)

  // The session id is minted before the first read, because it is both the resume
  // key on the way in and the idempotency key on the way out. Deriving it later
  // would mean the GET could not find a response the POST would then duplicate.
  const sessionId = useMemo(() => ensureSessionId(surveyId), [surveyId])

  // Answers are hydrated from the server exactly once. The read is re-issued when the
  // respondent switches language — the question TEXT has to come back translated —
  // and re-hydrating there would throw away everything they had typed since.
  const hydrated = useRef(false)
  const startedAt = useRef(Date.now())
  // Set when a resumed response is hydrated, cleared by the effect that acts on it.
  // A ref rather than state because acting on it must not itself cause a render, and
  // because it has to survive the render in which the questions first paint.
  const resuming = useRef(false)

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
            // Exactly the `question_responses` rows the server holds, which is what
            // makes a later erasure expressible: a question that leaves this set is one
            // the respondent has taken back, as opposed to one they never answered.
            serverAnswered.current = new Set(
              view.inProgress.answers.map((answer) => answer.questionId),
            )
            startedAt.current = Date.parse(view.inProgress.startTime) || Date.now()
            // A completed response renders the terminal notice, not a form: there is
            // no question to put anybody on and nothing left to save.
            resuming.current = !view.inProgress.isComplete
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

  // ---------------------------------------------------------------------------
  // Saving (#369)
  // ---------------------------------------------------------------------------

  /**
   * Everything a save needs, read at the moment it fires rather than closed over.
   *
   * The autosave runs from a timer and from two page-lifecycle listeners, none of
   * which is re-created per keystroke — a closure over `answers` would post whatever
   * the form held when the listener was attached, which on the hide path is precisely
   * the stale state the feature exists to stop losing. Written during render so it is
   * never a frame behind.
   */
  const latest = useRef({ view, questions, answers })
  latest.current = { view, questions, answers }

  /** Mirrors `busy` for the timer, which must not fight a save the respondent asked for. */
  const busyRef = useRef(busy)
  busyRef.current = busy

  /** The answer set the server is known to hold, as `answerSignature`. */
  const savedSignature = useRef<string | null>(null)
  /**
   * The question ids the server is known to hold an answer for.
   *
   * Kept alongside `savedSignature` because the signature can only say THAT the answer
   * set changed, never that a particular answer was withdrawn — and a withdrawal is the
   * one change that has to be named on the wire for the server to act on it.
   */
  const serverAnswered = useRef<Set<string>>(new Set())
  /** True once a complete submission has been accepted: nothing partial may follow it. */
  const finished = useRef(false)
  /** False after unmount, so a late resolution does not set state on a dead component. */
  const mounted = useRef(true)
  /** The background save has been announced once. Every later one is silent — see below. */
  const announcedAutosave = useRef(false)

  /**
   * Serialises every POST this page makes.
   *
   * `FindExistingResponseAsync` is a check-then-insert with a documented race: two
   * submissions on the same key that overlap can both find nothing and both insert.
   * Before autosave the page could not produce overlapping posts, because the only two
   * buttons that made one were disabled while it was in flight. A timer can, so the
   * requests are queued rather than fired at will — one tab can no longer be the client
   * that opens that window.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(work, work)
    chain.current = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }, [])

  /**
   * What the server holds after a save lands: what it already had, minus what this
   * submission deleted, plus what it wrote.
   *
   * Not simply the ids in `inputs`. A question type this page cannot render is never in
   * `inputs` and is never cleared either, so the server keeps its row — and forgetting
   * that here would make the next save ask to delete it.
   */
  const recordServerAnswers = useCallback(
    (inputs: readonly SurveyAnswerInput[], cleared: readonly string[]): void => {
      const next = new Set(serverAnswered.current)
      for (const questionId of cleared) next.delete(questionId)
      for (const input of inputs) next.add(input.questionId)
      serverAnswered.current = next
    },
    [],
  )

  /**
   * Writes progress without the respondent asking, and without touching `busy`.
   *
   * `busy` disables every control on the page, which is right for a save somebody
   * pressed and wrong for one that fires on a timer: it would take the keyboard out of
   * a half-typed comment. So a background save reports itself through `saveState`
   * alone, and stands down whenever a foreground save or a submit owns the wire.
   *
   * @param options.keepalive set on the hide path only. See `submitSurveyResponse`.
   */
  const autosave = useCallback(
    async (options: { keepalive?: boolean } = {}): Promise<void> => {
      const current = latest.current
      const currentView = current.view
      if (!respondAutosaveAllowed(currentView) || currentView === null) return
      if (finished.current) return
      if (busyRef.current !== 'idle') return

      const inputs = toAnswerInputs(current.questions, current.answers)
      const cleared = clearedQuestionIds(serverAnswered.current, current.questions, current.answers)
      if (!hasProgressToSave(inputs, cleared)) return

      const signature = answerSignature(inputs)
      // `cleared` is checked too: an erasure that empties the form leaves a signature
      // identical to the one a never-touched form would produce, and skipping on the
      // signature alone would drop the very submission that carries the deletion.
      if (signature === savedSignature.current && cleared.length === 0) return

      setSaveState(markSaving)
      try {
        await enqueue(() =>
          submitSurveyResponse(
            baseUrl,
            currentView.id,
            {
              // Byte for byte what the button posts. Nothing here is a new field, a new
              // identifier or a demographic — the anonymity guarantee in #116 is a
              // property of this payload, and autosave must not widen it.
              answers: inputs,
              // Named, never inferred from absence — see `clearedQuestionIds`. This is
              // what carries an erasure to the server.
              ...(cleared.length > 0 ? { clearedQuestionIds: cleared } : {}),
              sessionId,
              isComplete: false,
              language: currentView.resolvedLocale,
            },
            options,
          ),
        )
        savedSignature.current = signature
        recordServerAnswers(inputs, cleared)
        if (!mounted.current) return
        setSavesLanded((landed) => landed + 1)
        // An erasure that landed leaves nothing answered and nothing stored, and the bar
        // goes back to saying nothing at all. "Guardado a las 09:14" over an empty form
        // is the same claim about work that does not exist that `idle` exists to avoid —
        // and before the clear was sent it was worse than odd, because the server still
        // held the answer the respondent had just taken back.
        setSaveState(
          inputs.length === 0
            ? RESPOND_SAVE_IDLE
            : { status: 'saved', savedAt: Date.now(), message: null },
        )
        // Announced ONCE. A screen-reader user has to learn that this page keeps their
        // work by itself, and then never hear about it again: on a fifty-question
        // instrument, a polite region that says "saved" every fifteen seconds talks
        // over the questions it is meant to protect.
        if (!announcedAutosave.current) {
          announcedAutosave.current = true
          announce(t('progressAutosaved'))
        }
      } catch (error: unknown) {
        if (!mounted.current) return
        const message =
          error instanceof Error && error.message ? error.message : tRoot('errors.generic')
        // `savedAt` survives: "not being saved since 09:14" is a more useful thing to
        // read than "not being saved", and the alert below prints both.
        setSaveState((previous) => ({ status: 'error', savedAt: previous.savedAt, message }))
      }
    },
    [announce, baseUrl, enqueue, recordServerAnswers, sessionId, t, tRoot],
  )

  async function send(isComplete: boolean): Promise<void> {
    if (!view) return
    setSubmitError(null)
    setBusy(isComplete ? 'submitting' : 'saving')
    if (!isComplete) setSaveState(markSaving)
    try {
      const inputs = toAnswerInputs(questions, answers)
      // The button erases as much as the timer does. A respondent who clears an answer
      // and presses Save Progress has asked for the erasure at least as plainly as one
      // who waited for the debounce.
      const cleared = clearedQuestionIds(serverAnswered.current, questions, answers)
      const submission = await enqueue(() =>
        submitSurveyResponse(baseUrl, view.id, {
          answers: inputs,
          ...(cleared.length > 0 ? { clearedQuestionIds: cleared } : {}),
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
        }),
      )

      savedSignature.current = answerSignature(inputs)
      recordServerAnswers(inputs, cleared)
      setSavesLanded((landed) => landed + 1)

      if (isComplete) {
        // Terminal, and checked by the autosave and by the unmount flush: a partial
        // write after a complete one is at best refused as idempotent and at worst a
        // page that keeps talking to the server after the respondent is done.
        finished.current = true
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
        setSaveState(
          inputs.length === 0
            ? RESPOND_SAVE_IDLE
            : { status: 'saved', savedAt: Date.now(), message: null },
        )
        announce(t('progressSaved'))
      }
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : tRoot('errors.generic')
      // A pressed save that failed is the same fact as an autosave that failed, and it
      // belongs in the one place the respondent looks to tell saved from unsaved —
      // not under "your answers could not be SUBMITTED", which is about a different
      // action and leaves two alerts on the page saying one thing.
      if (isComplete) {
        setSubmitError(message)
      } else {
        setSaveState((previous) => ({ status: 'error', savedAt: previous.savedAt, message }))
      }
      announce(message)
    } finally {
      setBusy('idle')
    }
  }

  /**
   * Where a resumed respondent is put.
   *
   * The form is deliberately one page rather than a wizard, so "where they stopped" can
   * only mean focus. It moves to the first question they have not answered — the same
   * `questionFieldId` machinery a failed submit uses, which is already focusable
   * (`tabIndex={-1}` on the fieldset) and already scrolls itself into view.
   *
   * Runs on the render after hydration, because the fieldsets have to exist to be
   * focused. It also seeds `savedSignature` with what came back: the server already
   * holds exactly these answers, and re-posting them on arrival would be a write per
   * resume that says nothing.
   *
   * **It is declared BEFORE the debounce below, and that ordering is load-bearing.**
   * Effects run in declaration order within a commit, and both of these first run on
   * the same one — the render in which the payload lands. With the debounce first, it
   * compared a hydrated answer set against an unseeded `savedSignature`, found them
   * different and printed "not saved yet" on a page the respondent had only just opened
   * and never touched. Caught by rendering it, not by the suite: every assertion about
   * the resumed form still passed, because the sentence is correct copy in the wrong
   * state. Seeding here first makes the debounce's own signature check settle it.
   */
  useEffect(() => {
    if (!resuming.current || state.status !== 'ready') return
    resuming.current = false

    savedSignature.current = answerSignature(toAnswerInputs(questions, answers))

    const target = firstUnansweredQuestion(questions, answers)
    if (target === null) {
      // Everything is answered and the only thing left is to submit. Moving focus to
      // the bottom of a finished form would push the submit button out of view on a
      // phone, so the respondent is told and left where they are.
      announce(t('resumedAllAnswered'))
      return
    }

    // One question per page, so "where they stopped" is a page as well as a focus: the
    // page turns to it, and the focus follows once that question has rendered.
    setPage(questions.indexOf(target))
    setFocusTarget(target.id)
    announce(
      t('resumedAtQuestion', {
        position: questions.indexOf(target) + 1,
        total: questions.length,
      }),
    )
  }, [announce, answers, questions, state.status, t])

  /**
   * The debounce. Re-armed by any change to the answers, and by the payload arriving.
   *
   * It reports `pending` before it arms, so the gap between answering and saving is
   * visible rather than being a period in which the page silently claims nothing. The
   * signature check is what stops a re-render, a language switch, a resume, or an edit
   * that cancels itself out from costing a write.
   */
  useEffect(() => {
    if (!respondAutosaveAllowed(view) || finished.current) return

    const inputs = toAnswerInputs(questions, answers)
    const cleared = clearedQuestionIds(serverAnswered.current, questions, answers)
    if (!hasProgressToSave(inputs, cleared)) {
      // Nothing on the screen and nothing on the server. Reached by the respondent
      // taking back everything they had answered, once the erasure has landed — and
      // this is the line that stops the bar reading "Guardado a las 09:14" underneath a
      // form that is now empty and a server that now holds nothing. It also settles the
      // shorter version of the same lie: answering and immediately erasing inside the
      // debounce window used to leave "not saved yet" on screen permanently, describing
      // a write that was never going to happen.
      setSaveState(RESPOND_SAVE_IDLE)
      return
    }
    if (answerSignature(inputs) === savedSignature.current && cleared.length === 0) return

    setSaveState(markPending)

    const handle = window.setTimeout(() => void autosave(), RESPOND_AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(handle)
    // `savesLanded` is a dependency and not a value: see its declaration. Without it an
    // erasure made while a save was in flight is never reconsidered.
  }, [answers, autosave, questions, savesLanded, view])

  /**
   * The save that beats the debounce window, on the three ways out of a page.
   *
   * `pagehide` fires on every navigation away, including the one into the back/forward
   * cache; `visibilitychange` to `hidden` is the one that fires when a phone locks or
   * the respondent switches apps, which is the interruption this issue is actually
   * about and the one `beforeunload` has never covered on mobile. Neither is used to
   * *block* the exit: `beforeunload`'s confirmation dialog is hostile, and a respondent
   * who wants to leave should be able to, which is the whole point of saving instead of
   * asking.
   *
   * `keepalive` is what makes the request outlive the document that started it.
   */
  useEffect(() => {
    if (!respondAutosaveAllowed(view)) return

    const flush = () => void autosave({ keepalive: true })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [autosave, view])

  /**
   * The last attempt, on the way out of the component.
   *
   * Covers the in-app navigations `pagehide` never sees — a respondent who clicks Home
   * mid-survey. Fire and forget: there is nothing left to tell, and `mounted` stops the
   * resolution from setting state on a component that no longer exists.
   */
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      void autosave({ keepalive: true })
    }
  }, [autosave])

  /**
   * Focus follows a page turn, once the new question has rendered.
   *
   * A page turn replaces the fieldset the focus was in, and focus left on a removed node
   * falls to `<body>` — a keyboard or screen-reader respondent would be put back at the
   * top of the document after every "Siguiente". So the target is named when the page is
   * turned and focused here, on the commit in which it is the question on screen.
   */
  const currentId = questions[Math.min(page, Math.max(questions.length - 1, 0))]?.id ?? null
  useEffect(() => {
    if (focusTarget === null || focusTarget !== currentId) return
    setFocusTarget(null)
    document.getElementById(questionFieldId(focusTarget))?.focus()
  }, [currentId, focusTarget])

  /** Turns to a question and puts the respondent on it. */
  function turnTo(index: number): void {
    const target = questions[index]
    if (target === undefined) return
    setPage(index)
    setFocusTarget(target.id)
  }

  /**
   * Siguiente. A required question stops the respondent here rather than at the end.
   *
   * The same rule as the submit (`missingRequired`, over this one question), and the same
   * inline error — found now, on the question they are looking at, instead of after the
   * last page sends them back to it.
   */
  function goNext(index: number): void {
    const current = questions[index]
    if (current === undefined) return
    const missing = missingRequired([current], answers)
    if (missing.length > 0) {
      setInvalidIds((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]))
      document.getElementById(questionFieldId(current.id))?.focus()
      return
    }
    turnTo(index + 1)
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    if (!view) return

    // Enter in a text answer submits the form from any page. Before the last one that
    // means "next", never "send": a respondent on question 2 has not asked to finish.
    const index = Math.min(page, Math.max(questions.length - 1, 0))
    if (index < questions.length - 1) {
      goNext(index)
      return
    }

    const missing = missingRequired(questions, answers)
    if (missing.length > 0) {
      setInvalidIds(missing)
      announce(t('missingRequired', { count: missing.length }))
      // Turn to the first unanswered question rather than a summary: the respondent
      // has to reach the question anyway, and on a 40-question survey a summary leaves
      // them paging for it. `turnTo` focuses it once it is on screen.
      turnTo(questions.findIndex((question) => question.id === missing[0]))
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
  const index = Math.min(page, Math.max(total - 1, 0))
  const current = questions[index]
  const position = total === 0 ? 0 : index + 1
  const isLast = index >= total - 1
  const deadline =
    view.timeLimitMinutes === null ? null : startedAt.current + view.timeLimitMinutes * 60_000
  const remainingMs = deadline === null ? null : deadline - now
  // The heading of the section this question is asked under, when the form prints
  // sections at all — `respondDimensions`' decision, exactly as the headings were before
  // the page was split: a randomised survey, or one with no categories, prints none.
  const dimensionKey =
    current && dimensions.sectioned
      ? dimensions.sections.find((section) => section.questions.some((q) => q.id === current.id))?.key
      : undefined
  const currentDimension = dimensionKey === undefined ? null : dimensionLabel(dimensionKey, tRoot)

  return (
    <RespondSurface>
      {/* The promise, first and full width, once. The canvas opens the page on it
          (RespondSurveyPhone, 10 Sep), and one question at a time is exactly why it has
          to be here rather than beside a question: it is read before the first answer
          and stays at the head of every page after it. */}
      <AnonymityNotice anonymous={view.anonymous} />

      <ContentLanguageNotice
        requested={locale}
        resolvedLocale={view.resolvedLocale}
        fallbackCount={view.fallbackFields.length}
      />

      {/* The canvas's progress: the survey's own name as the eyebrow — the page's
          `<h1>`, set in the eyebrow face because what matters on this screen is the
          question, not its container — where the respondent is, and a 6px bar. The
          count and the bar are `ShowProgress`'s, as they always were; the `2/6` chip on
          the card says the position either way. */}
      <header data-slot="respond-progress" className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="m-0 min-w-0 font-sans text-2xs font-bold uppercase leading-snug tracking-eyebrow text-fg-secondary">
            {view.title ?? t('untitledSurvey')}
          </h1>
          {view.showProgress && total > 0 ? (
            <span
              data-slot="respond-position"
              className="shrink-0 font-mono text-xs tabular-nums text-fg-secondary"
            >
              {t('next.position', { position, total })}
            </span>
          ) : null}
        </div>
        {view.showProgress && total > 0 ? (
          <Progress
            value={Math.round((position / total) * 100)}
            aria-label={t('questionPosition', { position, total })}
          />
        ) : null}
      </header>

      {/* The author's description, on the first page only: it introduces the survey,
          and repeated over every question it would push the question down the phone. */}
      {index === 0 && view.description ? (
        <p className="m-0 max-w-prose text-base text-fg-secondary">{view.description}</p>
      ) : null}

      {remainingMs !== null && remainingMs > 0 ? (
        <p className="m-0 text-sm text-fg-secondary">
          {t('timeLimitHelp', { minutes: view.timeLimitMinutes ?? 0 })}
        </p>
      ) : null}

      {/* `noValidate`: the browser's own required-field bubbles are untranslated,
          land on a radio rather than on the question, and cannot be announced.
          `missingRequired` does the same job with copy from the catalogue and moves
          focus onto the question itself. */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {/* The expired countdown stays with the question: it is an alert about what
            the respondent is doing right now, and `role="alert"` beside the form is
            where it will be read. */}
        {remainingMs !== null && remainingMs <= 0 && (
          <Alert variant="warning" role="alert">
            <Info aria-hidden="true" />
            <AlertTitle>{t('timeLimitExpired')}</AlertTitle>
            <AlertDescription>{t('timeLimitExpiredHelp')}</AlertDescription>
          </Alert>
        )}

        {current ? (
          <RespondQuestionField
            key={current.id}
            question={current}
            // The place in READING order, so the numbering is the order the questions
            // are actually asked in — which is not `question.order` once randomised.
            position={position}
            total={total}
            dimension={currentDimension}
            answer={answers[current.id]}
            invalid={invalidIds.includes(current.id)}
            disabled={busy !== 'idle'}
            onChange={(next) => updateAnswer(current.id, next)}
            onAnnounce={announce}
          />
        ) : null}

        {submitError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('submitFailed')}</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        {/* A save that is not happening is an alert; a save that is happening is a
            line of text (#369). It sits directly over the two buttons the respondent
            presses on every page, which is the one place that is on screen on every
            page — a background save fails while somebody is on question 3 of 50, and
            an alert anywhere else would be read by nobody. It stays until a save
            succeeds. */}
        {saveState.status === 'error' && (
          <Alert variant="destructive" role="alert" data-slot="respond-save-failed">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>{t('saveFailedTitle')}</AlertTitle>
            <AlertDescription>
              <span>
                {saveState.savedAt === null
                  ? t('saveFailedBody')
                  : t('saveFailedSince', { time: formatTime(saveState.savedAt, locale) })}
              </span>
              {/* The server's own message names what it objected to, and "this survey
                  has reached its response limit" is something a respondent can act on
                  in a way that "not saved" is not. Additional to our sentence, never
                  instead of it. */}
              {saveState.message !== null && (
                <span className="mt-inline block text-fg-secondary">{saveState.message}</span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* The canvas's pair, 44px tall: Anterior outlined on the left, the way on in
            red on the right and twice as wide. On the last question the way on is the
            submit — the one POST that completes the response, unchanged. Anterior is
            drawn on the first question too, disabled, so the primary action does not
            jump sideways between the first page and the second. */}
        <div data-slot="respond-nav" className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1"
            disabled={index === 0 || busy !== 'idle'}
            onClick={() => turnTo(index - 1)}
          >
            <ArrowLeft aria-hidden="true" />
            {t('next.previous')}
          </Button>
          {isLast ? (
            <Button type="submit" variant="primary" className="h-11 flex-2" disabled={busy !== 'idle'}>
              {busy === 'submitting' ? tRoot('common.submitting') : t('submitResponse')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="h-11 flex-2"
              disabled={busy !== 'idle'}
              onClick={() => goNext(index)}
            >
              {t('next.next')}
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>

        {/* "Guardar y terminar después" as the canvas draws it — an underlined line under
            the pair — and only where the survey allows partial responses. The save state
            rides under it: it is the answer to the question this link asks, "is my work
            anywhere but this screen", on every page of the survey. */}
        {view.allowPartialResponses && (
          <div data-slot="respond-save" className="flex flex-col items-center gap-1">
            <Button
              type="button"
              variant="link"
              disabled={busy !== 'idle'}
              onClick={() => void send(false)}
              className="p-2 text-base font-normal text-fg-secondary underline"
            >
              {busy === 'saving' ? t('savingProgress') : t('saveAndFinishLater')}
            </Button>
            <SaveState state={saveState} locale={locale} />
          </div>
        )}
      </form>

      {/* The foot, as the canvas prints it: when the survey closes, and how long it
          takes — or, for a survey that sets a limit, how long is left of it. At the
          bottom of the column on a short page, under the form on a long one. */}
      <footer
        data-slot="respond-footer"
        className="mt-auto flex flex-wrap justify-between gap-2 text-xs text-fg-secondary"
      >
        <span>{t('next.closesOn', { date: formatDayMonth(view.endDate, locale) })}</span>
        {remainingMs !== null && remainingMs > 0 ? (
          <span data-slot="respond-time-left" className="font-mono tabular-nums">
            {t('timeLimitRemaining', { time: formatDuration(remainingMs) })}
          </span>
        ) : (
          <span>
            {isUnderAMinute(total)
              ? t('next.underAMinute')
              : t('next.aboutMinutes', { minutes: estimatedMinutes(total) })}
          </span>
        )}
      </footer>

      <LiveRegion>{announcement}</LiveRegion>
    </RespondSurface>
  )
}

/**
 * The column every state of the page renders in.
 *
 * No panel of its own since the canvas redesign (RespondSurveyPhone and
 * RespondConfirmationPhone, 10 Sep): the cards sit straight on the ground, and a bordered
 * panel around them read as a card holding cards. Every state this component can be in
 * renders inside it — the form, the four
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
    <div data-slot="respond-surface" className="flex flex-1 flex-col gap-4">
      {children}
    </div>
  )
}

/**
 * Whether the respondent's work is anywhere but this screen (#369).
 *
 * ## It is not a live region, and that is deliberate
 *
 * `SurveyDraftIndicator` — the same idea for the survey WIZARD — puts its healthy line
 * in a `LiveRegion`, and an admin typing a survey benefits from that. A respondent does
 * not: this state changes on every answer, so on a fifty-question instrument a polite
 * region would interrupt with "unsaved / saving / saved" between every question and
 * talk over the questions themselves.
 *
 * Nothing is lost by making it plain text. The failure — the state that actually
 * changes what a respondent should do — is a `role="alert"` panel in the form above,
 * which announces itself; the first successful background save is announced once
 * through the page's own live region; and this line is reachable at any time by a
 * screen-reader user who goes looking for it, which is what the other three states are
 * worth.
 *
 * `error` prints nothing here. The alert above says it at full weight, and a muted
 * "not saved" beside the buttons would be the second, quieter copy of a warning.
 */
function SaveState({ state, locale }: { state: RespondSaveState; locale: string }) {
  const { t } = useTranslation('surveyRespond')

  // Nothing has been answered, so there is nothing to reassure anybody about. This is
  // the same restraint the draft indicator learned: "not saved yet" on a form nobody
  // has touched reads as a warning about work that does not exist.
  if (state.status === 'idle' || state.status === 'off' || state.status === 'error') return null

  const text =
    state.status === 'saving'
      ? t('savingProgress')
      : state.status === 'pending'
        ? t('saveStatePending')
        : state.savedAt === null
          ? t('saveStateSaved')
          : t('saveStateSavedAt', { time: formatTime(state.savedAt, locale) })

  return (
    <span
      data-slot="respond-save-state"
      className="flex items-center gap-inline text-sm text-fg-secondary"
    >
      {state.status === 'saved' && (
        <Check aria-hidden="true" className="size-icon text-accent-green" />
      )}
      <span>{text}</span>
    </span>
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
    <div className="flex flex-col gap-4">
      {/* The canvas's thank-you (RespondConfirmationPhone, 10 Sep) is the product's own
          success alert — the soft green block with the shield — so it stays that. */}
      <Alert variant="success" role="status">
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>
          {result.alreadySubmitted ? t('alreadyCompletedTitle') : t('thankYouTitle')}
        </AlertTitle>
        <AlertDescription>
          {result.alreadySubmitted ? t('alreadyCompletedBody') : t('thankYouBody')}
        </AlertDescription>
      </Alert>

      {/* The receipt row, as the canvas draws it: the tile, and beside it when and how.
          A respondent who has just handed over forty answers with no copy of them gets
          one reading back — how many of the questions were recorded, the server's own
          count rather than the form's, what was stored rather than what was typed. The
          count is the tile's, so the sentence beside it says only the rest. */}
      <div data-slot="respond-receipt" className="flex items-center gap-3.5">
        <div className="flex shrink-0 flex-col gap-0.5 rounded-lg bg-surface-icon-box px-3.5 py-2.5">
          <span className="text-2xs font-bold uppercase tracking-label text-fg-secondary">
            {t('receiptReading')}
          </span>
          <span className="font-mono text-reading leading-tight tabular-nums text-fg-primary">
            {result.answeredQuestionCount}{' '}
            <span className="text-sm font-normal text-fg-secondary">
              {t('next.receiptOf', { total: result.questionCount })}
            </span>
          </span>
        </div>
        {justSubmitted && (
          // "Se guardaron sin nada que lo identifique" is a sentence about how THIS
          // response was stored, so it is said only when the server says the response is
          // anonymous (`SurveySubmissionResult.isAnonymous`). On a survey that records who
          // answered, the time is the whole of what is true.
          <p className="m-0 min-w-0 flex-1 text-base text-fg-secondary">
            {result.isAnonymous
              ? t('next.submittedAtAnonymous', { time: formatTime(submittedAt, locale) })
              : t('next.submittedAt', { time: formatTime(submittedAt, locale) })}
          </p>
        )}
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

      {/* The canvas's card: the eyebrow over a hairline, then the three claims, each
          separated by a lighter hairline. The heading is an `<h2>` for the outline and
          drawn in the eyebrow face, as the artboard sets it, not in the page serif. */}
      <section
        aria-labelledby={WHAT_HAPPENS_HEADING_ID}
        data-slot="respond-what-happens"
        className="flex flex-col rounded-xl border border-line-default bg-surface-card px-4 py-1 shadow-sm"
      >
        <h2
          id={WHAT_HAPPENS_HEADING_ID}
          className="m-0 border-b border-line-light pb-1 pt-3 font-sans text-2xs font-bold uppercase leading-snug tracking-eyebrow text-fg-secondary"
        >
          {t('whatHappensNowTitle')}
        </h2>
        <ul className="m-0 flex list-none flex-col p-0">
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
        // The canvas's way back: an outlined button the width of the column, 44px, the
        // arrow before the word.
        <Button asChild variant="outline" className="h-11 w-full">
          <Link to="/dashboard">
            <ArrowRight aria-hidden="true" />
            {t('backToHome')}
          </Link>
        </Button>
      )}

      <p className="m-0 text-sm text-fg-secondary">{t('noCopyNote')}</p>
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
    <li className="flex items-start gap-2.5 border-b border-line-light py-3 last:border-b-0">
      <span aria-hidden="true" className="shrink-0 pt-px text-fg-secondary">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
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

/**
 * A wall-clock time, e.g. "09:14" — when a response was accepted, and when progress
 * was last successfully saved.
 */
function formatTime(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(value)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
