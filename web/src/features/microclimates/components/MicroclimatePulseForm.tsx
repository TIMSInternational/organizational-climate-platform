import { useEffect, useState, type FormEvent } from 'react'
import { EyeOff, Info, Send } from 'lucide-react'
import {
  getMicroclimatePublic,
  submitResponse,
  type PublicMicroclimateDetail,
  type Question,
} from '../api/microclimates'
import { useTranslation } from '../../../i18n'
import { detectLocale } from '../../../i18n/locale'
import { Alert, AlertDescription, AlertTitle, Button, Input } from '../../../components/ui'
import { SegmentedScale } from '../../../components/ui/SegmentedScale'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'
import { estimatedMinutes, formatDayMonth, isUnderAMinute } from '../../surveys/respondEstimate'
import MicroclimateContentNotice from './MicroclimateContentNotice'

/**
 * The scale a likert or rating question is answered on when it configures no
 * options of its own — the same 1–5 run `MicroclimateEndpoints.cs` validates a
 * submitted answer against (`int.TryParse(answer, …) && rating is >= 1 and <= 5`).
 * Named here so the control and the server's contract cannot drift apart silently.
 */
const SCALE_MIN = 1
const SCALE_MAX = 5

/** The `<legend>` that names one question's group of controls. */
function questionLegendId(questionId: string): string {
  return `microclimate-question-${questionId}`
}

function QuestionInput({
  question,
  legendId,
  value,
  onChange,
}: {
  question: Question
  /** Id of the `<legend>` holding the question, for controls that need naming. */
  legendId: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()

  switch (question.type) {
    // An emoji scale is answered on the values ITS AUTHOR configured, so unlike
    // likert/rating there is no 1-5 fallback to draw when the set is missing --
    // `MicroclimateEndpoints` refuses to create such a question and rejects any answer
    // to one that reached the database another way, so drawing a scale here would be
    // offering a control whose every answer is a 400.
    case 'emoji_rating':
      if (!question.emojiOptions || question.emojiOptions.length === 0) {
        return (
          <p role="alert" className="text-sm text-fg-secondary">
            {t('microclimates.questionHasNoOptions')}
          </p>
        )
      }
      return <EmojiScale question={question} value={value} onChange={onChange} />
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
    // likert and rating render identically -- a 1-5 scale unless the question
    // configures its own option set. They stay distinct types because they mean
    // different things (agreement vs quality), not because they look different.
    case 'likert':
    case 'rating':
      // An AUTHORED option set is not a numeric scale: its values are words
      // (`strongly_agree`), and `SegmentedScale` draws the points of an inclusive
      // integer run and emits `String(point)`. Those questions keep the choice list
      // they already had -- and the server validates them against their own option
      // values rather than against 1-5, so the two branches match the two branches
      // `MicroclimateEndpoints.cs` validates with.
      if (question.options && question.options.length > 0) {
        return (
          <ChoiceList
            choices={question.options.map((option) => ({
              value: option.value,
              label: option.label ?? option.value,
            }))}
            question={question}
            value={value}
            onChange={onChange}
          />
        )
      }
      return (
        <SegmentedScale
          min={SCALE_MIN}
          max={SCALE_MAX}
          // Nothing in the payload names the ends of an unlabelled 1-5 scale -- a
          // microclimate question carries no anchor words, only a `text` -- so the
          // generic pair is used rather than inventing an anchor the author never
          // wrote. An authored scale states its own ends, and takes the branch above.
          minLabel={t('charts.levelLow')}
          maxLabel={t('charts.levelHigh')}
          // '' means unanswered, which is not a point on the scale.
          value={value === '' ? null : value}
          onChange={onChange}
          // The group's name, exactly as `ChoiceList` names its radiogroup.
          label={question.text ?? undefined}
          required={question.required}
        />
      )
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
      // The canvas's open answer (RespondMicroclimatePhone, 10 Sep): one 44px line, and
      // under it what happens to the words. A pulse's open question asks for a word or
      // two ("En una palabra, ¿qué ayudaría más?"), and the line is the control saying so.
      //
      // `aria-labelledby` because a `<legend>` names the FIELDSET, not the control
      // inside it -- so this box had no accessible name at all before. Same fix
      // `surveys/RespondQuestionField.tsx` already carries for its comment box. The
      // note is its description, so it is read with the box rather than after it.
      return (
        <div className="flex flex-col gap-2">
          <Input
            aria-labelledby={legendId}
            aria-describedby={`${legendId}-words`}
            required={question.required}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            // "Una palabra", as the canvas draws it: the live page reads these answers as
            // word counts (`LiveOpenAnswers`), so the line asks for words, not a paragraph.
            placeholder={t('microclimates.next.wordPlaceholder')}
            className="h-11 text-lg"
          />
          {/* What the live page does with what is typed here, stated as what it does:
            `LiveOpenAnswers` draws a word panel — counts, never the text — and withholds
            it until `MINIMUM_RESPONDENTS` people have answered. The floor is the
            constant, never a typed 5. */}
          <span id={`${legendId}-words`} className="text-xs text-fg-secondary">
            {t('microclimates.next.wordNote', { floor: MINIMUM_RESPONDENTS })}
          </span>
        </div>
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
 * The emoji scale of an `emoji_rating` question (#198).
 *
 * ## The glyph is not the name
 *
 * Every face is drawn `aria-hidden`, and the control's accessible name comes from the
 * authored `label` beside it. This is the entire reason the backend stores an emoji
 * scale in its own table instead of reusing the plain option rows: an emoji-only radio
 * is announced by whatever the reader's own emoji dictionary calls the character, in
 * whatever language that dictionary happens to be in — so a Spanish respondent could
 * hear an English phrase, and a respondent on a reader without that character in its
 * table could hear nothing at all. The server refuses to store a face without a label,
 * so `label` is present on anything authored through the product; `?? String(value)`
 * is the type-level acknowledgement of a row that predates that rule, not a fallback
 * anyone is meant to see.
 *
 * ## The label is visible, not screen-reader-only
 *
 * `sr-only` would have kept the drawing pure emoji and still passed an automated a11y
 * check. It is not used, because this product's stated audience includes people with
 * low digital literacy and a bare face is ambiguous to a sighted respondent too — 🙂
 * as "fine" or as "not bad"? The word under each face is the answer to that, for
 * everybody.
 *
 * ## What is submitted
 *
 * `String(option.value)`, never the glyph and never the label — the same rule
 * `ChoiceList` follows for the stable option value (#195), and what the server
 * validates against.
 */
function EmojiScale({
  question,
  value,
  onChange,
}: {
  question: Question
  value: string
  onChange: (value: string) => void
}) {
  const options = question.emojiOptions ?? []

  return (
    <div
      role="radiogroup"
      aria-label={question.text ?? undefined}
      className="flex flex-wrap gap-x-section gap-y-1"
    >
      {options.map((option) => {
        const submitted = String(option.value)
        const inputId = `${question.id}-emoji-${option.order}`
        return (
          <span key={option.order} className="flex items-center gap-inline">
            <input
              type="radio"
              id={inputId}
              name={question.id}
              value={submitted}
              checked={value === submitted}
              required={question.required}
              onChange={(e) => onChange(e.target.value)}
            />
            <label
              htmlFor={inputId}
              className="mb-0 flex min-h-control-lg flex-col items-center justify-center text-base font-normal text-fg-primary"
            >
              {/* Decoration. The name is the line below it. */}
              <span aria-hidden="true" className="text-2xl leading-none">
                {option.emoji}
              </span>
              <span className="text-sm">{option.label ?? String(option.value)}</span>
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
 * Answering a live microclimate session, without an account — everything inside the
 * respond shell, and none of the shell itself.
 *
 * ## Why this is a component and not the page it used to be
 *
 * Two routes render this now: `/microclimates/:id/respond`, which addresses a session by
 * its GUID, and `/microclimate-invitations/:token` (#130), which addresses one invitee's
 * personal link and puts a landing card in front of the questions. Both own a
 * `RespondShell` of their own — the invitation route needs one that is up before the
 * microclimate has resolved, so it can render a dead-link message inside the same frame —
 * and two nested shells would draw two lockups and two skip links.
 *
 * So the split is at the shell boundary: the frame belongs to the route, the questions
 * belong here. That is exactly the shape the survey side already has, where
 * `SurveyRespondForm` is a shell-free component both `/surveys/:id/respond` and
 * `/survey-invitations/:token` mount.
 *
 * Nothing about the drawing changed in the move. The markup below is the markup
 * `MicroclimateRespondPage` had, and `respondContrast.test.ts` sweeps this file by path
 * so the ban on the two AA-failing utilities followed it here rather than being left
 * behind on a file that no longer contains any classes.
 *
 * ## The pulse, drawn the way the canvas draws it (RespondMicroclimatePhone, 10 Sep)
 *
 * **One narrow centred column and nothing else**: the anonymity promise first, the
 * eyebrow ("SESIÓN EN VIVO · 2 PREGUNTAS") over the session's name, one card per
 * question with the segmented scale or a one-line word answer, a single full-width
 * Send, and the session's readings at the foot. It is a screen usually opened from a
 * link in a meeting and answered in seconds, which is a different act from working
 * through a twelve-question climate survey.
 *
 * What was here until now was a three-column `lg:grid-cols-3` layout with a
 * `lg:sticky` right-hand rail carrying the anonymity promise and an answered-count
 * tile. **That rail was not a design decision — it was a test's.**
 * `components/layout/respondSticky.test.tsx` asserted a sticky panel on this route,
 * so the page kept one after the redesign had already cut the rail from the two
 * survey respond routes. The drawing has no rail and no bar, so this page has neither
 * — and since the canvas pages the survey routes one question at a time, neither do
 * they; that test file now asserts nothing is pinned on any of the three.
 *
 * Three consequences worth stating plainly:
 *
 * - **The answered-count tile is gone.** It was the rail's instrument, and the pulse
 *   draws no progress at all. A session with more than one question still numbers
 *   them (`1/2`, and the sentence beside it), which is the position information the
 *   tile was standing in for.
 * - **The anonymity note is the first block of the column**, where the canvas puts it
 *   on all three respond screens: read before the first answer, not after the Send.
 *   It no longer needs to stick to stay in view.
 * - **`RespondCaption` is not used here**, though the two survey routes use it. Its
 *   `<h1>` is `text-2xl` — the same size this design gives the *question* — so on a
 *   screen whose whole job is to ask one thing, the session's name would compete with
 *   the ask. The eyebrow and the heading are inlined below at the design's weighting:
 *   context small, question large.
 *
 * The 1–5 scale is `ui/SegmentedScale` rather than a row of native radios: a native
 * radio is ~13px against the 24px WCAG 2.2 target minimum, on the screen that is
 * most often answered on a phone. **What that costs, stated plainly:** a button
 * group has no native `required`, so the browser no longer blocks submitting an
 * unanswered required scale question — it is `aria-required` and the word in the
 * legend now. The server never enforced it either (`MicroclimateEndpoints.cs`
 * validates the answers it is *sent*, not the ones it is not), so nothing that was
 * guaranteed has been lost; but a client-side check is the honest next step, and it
 * needs copy this catalogue does not have yet.
 *
 * ## Why the anonymity statement is on this page at all — and where it is not literally true
 *
 * `PublicMicroclimateDetail` carries no `anonymousResponses` flag, so this page
 * cannot report the session's configuration and does not try to. What it states
 * instead describes the request: no name and no account travels with the answers.
 * That holds only while no session is stored. `submitResponse` in
 * `api/microclimates.ts` posts with `Content-Type` alone when there is no token, and
 * attaches the stored bearer whenever there is one — deliberately: a session with
 * `anonymousResponses: false` answers 401 without it (the comment on `submitResponse`;
 * pinned by `microclimates.test.ts`, "attaches an Authorization header so an identified
 * session can be answered", and by `MicroclimateInvitationPage.test.tsx`, "withholds the
 * bearer from the invitation routes and sends it with the answers"). So for an employee
 * who opens `/microclimates/:id/respond` signed in, or an invitee who signed in before
 * answering, the account's token DOES travel with the answers. On an anonymous session
 * the server does not consult it (`SubmitResponseAsync` reads the caller only when
 * `AnonymousResponses` is false) and stores no answer per respondent at all — the
 * submission is folded into the session's aggregate (`MicroclimateEndpoints.cs`, the
 * comment on the dropped `GET /{id}/responses`) — so what is STORED stays
 * unattributable; what is SENT is not what the sentence says. The copy is main's and
 * this build kept it (the lane was told "anonymity copy and behaviour unchanged"):
 * saying what is stored instead, or sending no token on an anonymous session, is an
 * open ruling.
 *
 * The per-person token of `/microclimate-invitations/:token` is a separate credential
 * and is never attached to the submission: it travels on the ladder calls only, which
 * for an anonymous session the server refuses to record past `opened`
 * (`MicroclimateInvitationStatuses.AnonymityCeiling`). The invitation page's landing
 * card carries the fuller statement — what is recorded about the person, before they
 * start.
 *
 * ## Submitting is unchanged, and there is no receipt to build
 *
 * `POST /microclimates/{id}/responses` returns an empty 201 and individual responses
 * are not persisted against a respondent, so there is nothing to show back. The
 * confirmation stays the `role="status"` alert it already was — the design's `done`
 * screen belongs to the survey flow, which has a submission to describe.
 */
export default function MicroclimatePulseForm({
  microclimateId,
  onSubmitted,
  closesAt,
}: {
  /** The session to load and answer. Undefined while a route parameter is missing. */
  microclimateId: string | undefined
  /**
   * When the session stops taking answers, for the foot's "Abierta hasta el …".
   *
   * A prop rather than a field read here because the payload this form loads,
   * `PublicMicroclimateDetail`, carries no end time — `GET /microclimates/{id}` answers a
   * respondent with the reduced view. `/microclimate-invitations/:token` has one on its
   * token (`MicroclimateInvitationTokenDetail.endTime`) and passes it; the GUID route has
   * none, and its foot states nothing rather than a guessed close.
   */
  closesAt?: string
  /**
   * Called once, after the server has accepted the answers.
   *
   * The invitation route uses it to record `completed` on the invitation ladder. It is
   * deliberately fire-and-forget from this component's side: whether an administrator's
   * counter moved is not a precondition for a respondent finishing, and nothing here
   * waits on it or reports its failure.
   */
  onSubmitted?: () => void
}) {
  const { t } = useTranslation()
  const id = microclimateId
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<PublicMicroclimateDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<PageError | null>(null)

  // Kept apart from `error`, and the separation is the respondent's answers.
  //
  // A failed LOAD has nothing to render -- there are no questions -- so it replaces the
  // screen. A failed SUBMIT has everything to render: the questions are on screen and
  // answered, and the one thing that person needs is the button again. Folding the two into
  // one state unmounted the form on a 500, destroyed the answers they had just typed, and
  // announced it under "this session could not be loaded" -- a sentence about a fetch that
  // succeeded. `respondSubmitFailedTitle` has been sitting in both catalogues unused; this
  // is the case it was written for.
  const [submitError, setSubmitError] = useState<PageError | null>(null)
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
    setSubmitError(null)
    setSubmitting(true)
    try {
      // Send the locale actually rendered, not the browser's current preference:
      // they are the same here, but the server records what the respondent saw.
      await submitResponse(baseUrl, id, answers, microclimate?.resolvedLocale ?? locale)
      // Both of these are strictly AFTER the await, and both have to be.
      //
      // `onSubmitted` is what records `completed` on the invitation ladder, and on a
      // non-anonymous session that rung is irreversible: the token answers 409
      // `already_completed` from then on, and only an admin reinstating the invitation can
      // undo it. Reporting it for a submission the server refused would close somebody's
      // invitation over answers that were never stored.
      setSubmitted(true)
      onSubmitted?.()
    } catch (err) {
      setSubmitError(toPageError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const questions = microclimate?.questions ?? []
  const total = questions.length

  return (
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
        /* The whole screen, in the canvas's order (RespondMicroclimatePhone, 10 Sep):
         the promise first, then the kind of thing and its name, one card per
         question, a single full-width Send, and the session's two readings at the
         foot. No grid, no rail, no bar — every part of the pulse is in reading order
         down this one column, which is also why nothing on this page has to stick to
         stay in view. `flex-1` so the foot sits at the bottom of a short page. */
        <div data-slot="pulse-column" className="flex flex-1 flex-col gap-4">
          <AnonymityNote />

          {/* The eyebrow names the kind of thing and how much is being asked —
            "SESIÓN EN VIVO · 2 PREGUNTAS" — and the session's own name is the page's
            `<h1>`, in the serif at 22px as the artboard sets it: context above the
            cards, the question inside them. */}
          <header className="flex flex-col gap-1">
            <span className="text-2xs font-bold uppercase tracking-eyebrow text-fg-secondary">
              {total === 1
                ? t('microclimates.next.eyebrowOne')
                : t('microclimates.next.eyebrow', { count: total })}
            </span>
            <h1 className="m-0 text-reading">
              {microclimate.title ?? t('microclimates.respondUntitled')}
            </h1>
          </header>

          <MicroclimateContentNotice
            language={microclimate.language}
            resolvedLocale={microclimate.resolvedLocale}
            fallbackFields={microclimate.fallbackFields}
          />

          {/* Above the questions, not instead of them. Everything this person needs to try
            again — their answers and the button — is still on screen, which is the whole
            reason a failed submit is not the same state as a failed load. */}
          {submitError ? (
            <Alert variant="warning" role="alert">
              <Info aria-hidden="true" />
              <AlertTitle>{t('microclimates.respondSubmitFailedTitle')}</AlertTitle>
              <AlertDescription>{submitError.message ?? t('errors.generic')}</AlertDescription>
            </Alert>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {questions.map((question, index) => {
              const legendId = questionLegendId(question.id)
              return (
                <fieldset
                  key={question.id}
                  // The canvas's question card: the card surface with the hairline,
                  // 8px corners, 16px in, the faint lift every `.card` carries.
                  // `min-w-0` because this is a flex item of the column, and its
                  // automatic minimum size is its MIN-CONTENT width -- a long
                  // unbroken option label would otherwise widen the card, the
                  // column and the document, and send the Send button off the
                  // side of a phone. `respondSticky.test.tsx` measures it.
                  className="min-w-0 rounded-xl border border-line-default bg-surface-card p-panel shadow-sm transition-colors focus-within:border-accent-blue-ring"
                >
                  {/* `float-left w-full` closes the card's frame: a `<legend>`
                    in its default flow is cut out of the fieldset's own
                    border, so the question straddles the top edge and the
                    card reads as a form group rather than as a panel. The
                    block below clears the float. */}
                  <legend id={legendId} className="float-left m-0 w-full p-0">
                    {/* The canvas's meta row: the `1/2` chip, then the word saying
                      whether an answer is needed. */}
                    <span className="flex flex-wrap items-center gap-2">
                      {/* Nothing numbers a session that asks ONE question: "1/1"
                        and "Question 1 of 1" are two ways of saying there is no
                        position to keep track of. Both come back the moment there
                        is a second question to be somewhere in. */}
                      {total > 1 && (
                        <>
                          {/* The position as a reading: mono, tabular, and hidden
                            from assistive tech because the sentence beside it is
                            what "3/8" is supposed to say out loud. */}
                          <span
                            aria-hidden="true"
                            data-slot="question-index"
                            className="inline-flex h-5.5 items-center rounded-lg border border-line-default bg-surface-icon-box px-2 font-mono text-xs font-medium tabular-nums text-fg-secondary"
                          >
                            {`${index + 1}/${total}`}
                          </span>
                          <span className="sr-only">
                            {t('microclimates.respondQuestionPosition', {
                              position: index + 1,
                              total,
                            })}
                          </span>
                        </>
                      )}
                      {/* The WORD carries whether an answer is required, never a
                        colour -- WCAG 1.4.1. Beside the chip, as the artboard draws
                        "1/2 obligatoria" and "2/2 opcional". */}
                      <span data-slot="question-requirement" className="text-xs font-normal text-fg-secondary">
                        {question.required
                          ? t('microclimates.next.required')
                          : t('microclimates.next.optional')}
                      </span>
                    </span>
                    {/* The one thing being asked, the largest sans type on the card.
                      This is the whole page for most respondents. */}
                    <span data-slot="question-text" className="mt-3.5 block text-question font-normal text-fg-primary">
                      {question.text}
                    </span>
                  </legend>
                  <div className="clear-both pt-3.5">
                    <QuestionInput
                      question={question}
                      legendId={legendId}
                      value={answers[question.id] ?? ''}
                      onChange={(value) => setAnswers({ ...answers, [question.id]: value })}
                    />
                  </div>
                </fieldset>
              )
            })}

            {/* One action, the full width of the column and 44px tall, with the send
              glyph after the word. The design draws a single Send and no second
              control: there is no draft to save on a session whose responses are not
              persisted against a respondent. */}
            <Button type="submit" variant="primary" disabled={submitting} className="h-11 w-full">
              {submitting ? t('common.submitting') : t('common.submit')}
              <Send aria-hidden="true" />
            </Button>
          </form>

          {/* The foot, as the canvas prints it: until when the session takes answers,
            and how long it takes. The close is drawn only when this route was handed
            one — `PublicMicroclimateDetail` carries no end time, so on the GUID route
            there is nothing to state; the invitation route passes its token's
            `endTime`. The estimate is the question count's, never a typed figure. */}
          <footer
            data-slot="pulse-footer"
            className="mt-auto flex flex-wrap justify-between gap-2 text-xs text-fg-secondary"
          >
            <span>
              {closesAt ? t('microclimates.next.openUntil', { date: formatDayMonth(closesAt, locale) }) : null}
            </span>
            <span>
              {isUnderAMinute(total)
                ? t('microclimates.next.underAMinute')
                : t('microclimates.next.aboutMinutes', { minutes: estimatedMinutes(total) })}
            </span>
          </footer>
        </div>
      )}
    </Surface>
  )
}

/**
 * What this page does with the answers, stated as narrowly as it can be verified.
 *
 * The canvas's block (RespondMicroclimatePhone, 10 Sep), first on the page: the soft
 * green box with the eye-off glyph, the state word as an uppercase label and one
 * paragraph. The copy is unchanged — the label is `respondAnonymityChip`, which is the
 * word the artboard prints, and the body is `respondAnonymityBody`. The title stays as
 * the block's heading for assistive technology and is visually hidden, because the
 * canvas draws no third line and the label already says it in a word.
 *
 * Green plus the word: the label spells out the state, so the colour is never the
 * only thing carrying it. The label is `text-chip-good-ink`, not the artboard's
 * `#0f7f4e`: `features/surveys/respondContrast.test.ts` measures the artboard's ink at
 * 4.31:1 on this fill over the page ground, under AA, and measures this one over it in
 * both palettes — the same ink `surveys/AnonymityNotice` uses.
 */
function AnonymityNote() {
  const { t } = useTranslation()

  return (
    <section
      data-slot="anonymity-notice"
      className="flex gap-2.5 rounded-xl border border-accent-green-ring bg-accent-green-soft px-3.5 py-3"
    >
      <EyeOff aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-green-ink" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="sr-only">{t('microclimates.respondAnonymityTitle')}</h2>
        <span className="text-2xs font-bold uppercase tracking-label text-chip-good-ink">
          {t('microclimates.respondAnonymityChip')}
        </span>
        <p className="m-0 text-sm text-fg-secondary">{t('microclimates.respondAnonymityBody')}</p>
      </div>
    </section>
  )
}

/**
 * The column every state renders in.
 *
 * No panel of its own any more: the canvas draws the pulse as cards straight on the
 * ground (RespondMicroclimatePhone), and a bordered panel around them read as a card
 * holding cards. `flex-1` still fills the column `RespondShell`'s `<main>` gives it, so
 * the footer can sit at the bottom of a short page rather than under the last card.
 */
function Surface({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col gap-4">{children}</div>
}
