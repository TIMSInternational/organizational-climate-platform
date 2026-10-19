import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Clock, EyeOff, FileText, Inbox, Target } from 'lucide-react'
import { PageTopBar } from '../../../../components/layout'
import { Button, Chip } from '../../../../components/ui'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import DashboardState from '../../components/DashboardState'
import { AnonymityNotice } from '../../../surveys/components/AnonymityNotice'
import { formatDayMonth } from '../../../surveys/respondEstimate'
import { useRespondentShell } from '../../../../navigation/useRespondentShell'
import { useEmployeeHomeModel } from './useEmployeeHomeModel'
import type { EmployeeHomeModel, HomeOutcome, HomeSurvey } from './model'
import { byCount } from '../../../../i18n/plural'

/**
 * The employee's Home — `/dashboard` for the `employee` role, and for any role
 * `DashboardPage` does not recognise. The canvas's EmployeeDashboard artboard (10 Sep), and
 * its EmployeeDashboardAnswered state when the reader owes nothing (`NothingDueCard`).
 *
 * ## The page's one job
 *
 * "Is there anything I have to do?" — answered first and at full weight: the survey this
 * person owes, with the promise about how their answer is stored beside it, and the others
 * as quieter rows under it. Then the only honest reason the product has to bring someone
 * back between surveys: what came of the last one.
 *
 * ## What it never shows
 *
 * **How many surveys this person has completed.** `completedSurveyCount` is on the payload
 * and is not drawn, anywhere: an anonymous response stores no user id
 * (`SurveyResponseEndpoints.cs` writes `IsAnonymous ? null : ActingUserId`), so against an
 * anonymous survey that number can only ever read 0 — for someone who did answer. If the
 * product cannot say what *they* did, it can say what *came of it*, which is the second card.
 *
 * **A number for a protected department.** The outcome card says how many departments were
 * withheld and why, and never which, and never a count of their answers — the payload
 * carries neither (`EmployeeLastOutcome`).
 *
 * **An anonymity promise it cannot stand behind.** The block beside the task is drawn only
 * for a survey whose own `Settings.Anonymous` is `true`, and it is the respond page's block,
 * `AnonymityNotice`, word for word. A survey that records who answered gets no block and no
 * "Not anonymous" label either: the negative belongs on the respond page, under the
 * explanation, not on a card crossed in two seconds.
 *
 * ## Where it departs from the artboard, and why
 *
 * The section meta keeps the artboard's pattern — the survey on the card, then what else is
 * open — and counts the rest ("una encuesta abierta, y otra más"): the artboard's "y su copia
 * de ensayo" knows the second is a rehearsal copy, which nothing on the payload does. The
 * sentence under the greeting counts too, from the same `pendingSurveyCount`, so the two can
 * never disagree. "Puede guardar y terminar después." is printed only when the
 * lead survey's own `allowPartialResponses` says so. The anonymity block keeps the respond
 * page's copy, which this lane was told to leave unchanged.
 */
export default function EmployeeHomeView({
  notice,
}: {
  /**
   * A standing sentence above the page — `DepartmentAdminDashboardView` passes one when a
   * leader or supervisor has no department and lands here instead of on a team view. Drawn
   * outside `DashboardState`, so it stays true on screen when the load below it fails.
   */
  notice?: ReactNode
} = {}) {
  const { t } = useTranslation()
  const respondent = useRespondentShell()
  const { model, loading, failed, error, reload } = useEmployeeHomeModel()

  return (
    <div>
      <PageTopBar
        // "INGENIERÍA · EMPLEADO": where this person stands, as the artboard's eyebrow
        // says it. `null` while loading, because an eyebrow that appears and then changes
        // is worse than one that arrives with its page.
        eyebrow={model ? eyebrowFor(model, t, respondent) : null}
        // The greeting IS the heading: the one page in the product addressed to a person
        // rather than to an administrator. It greets the hour and not the person — ruled
        // 2026-10-16, the same ruling behind `auth/ownName.ts`: this page tells the reader
        // their company will never see their name beside their answers, so it does not open
        // by printing that name back at them.
        title={model ? t(greetingKey(new Date().getHours())) : t('dashboard.myDashboard')}
        description={model ? homeDescription(model.pendingCount, t) : undefined}
      />

      {notice ? <div className="mb-section">{notice}</div> : null}

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {model && <HomeBody model={model} />}
      </DashboardState>
    </div>
  )
}


/**
 * The department alone — "Ingeniería". A person with none gets the workspace eyebrow.
 *
 * **The role was dropped 2026-10-18.** This printed "Operaciones y Logística · EMPLEADO"
 * over a respondent's own survey, and ESPH's rehearsal reported it as data about the
 * evaluado being shown back to them. It is the same KIND of thing as the name
 * `auth/ownName.ts` already removed on 10-16 — a classification this platform applies to a
 * person — and that ruling's own words apply unchanged: chrome arguing with its own promise.
 * It also said nothing: there is exactly one role a reader of this page can be.
 *
 * The DEPARTMENT stays, and the distinction is not squeamishness. It is not a label on the
 * person; it is the unit whose results they are promised, and this page's own foot says so —
 * "los resultados de su departamento se publican cuando la encuesta cierra". Removing it here
 * while that sentence stands would leave the page contradicting itself.
 *
 * **That foot is gone as of 2026-10-19**, removed at the client's request along with the
 * empty state's "para <departamento>". So the paragraph above no longer has the sentence it
 * leans on, and the page no longer says the word "departamento" to a respondent anywhere.
 * Kept here because the reversal below is only legible beside the argument it reversed.
 */
function eyebrowFor(model: EmployeeHomeModel, t: TranslateFn, respondent: boolean): string {
  // **The department went for the respondent on 2026-10-18 too, and this is a reversal of the
  // paragraph above.** That paragraph argued the department could stay because it names the
  // unit whose results the reader is promised rather than labelling the person. ESPH's finding
  // 3 does not draw that line: "se ven los datos demograficos como Nombre, Departamento y esa
  // informacion es imprescindible ocultarla del evaluado". Nombre and Departamento are named
  // together, as one ask, by the client whose anonymity promise it is.
  //
  // Conditioned on the shell and not applied outright, because this component is not only the
  // respondent's: `TeamDashboardPage` and `DepartmentAdminDashboardView` both render it for
  // roles who are reading ABOUT a department rather than being labelled with one, and for them
  // the eyebrow is orientation.
  if (respondent) return t('employee.eyebrow')
  return model.departmentName && model.departmentName !== ''
    ? model.departmentName
    : t('employee.eyebrow')
}

/**
 * Which greeting, by the reader's own clock. Noon and six are the boundaries; the catalogue
 * owns the words.
 */
function greetingKey(hour: number): string {
  if (hour < 12) return 'employee.greetingMorning'
  if (hour < 18) return 'employee.greetingAfternoon'
  return 'employee.greetingEvening'
}

/**
 * The sentence under the greeting. "Hay una encuesta abierta para usted" is a count, so it is
 * printed only when one is open; with two open it sat over a section of two, one short.
 */
function homeDescription(pendingCount: number, t: TranslateFn): string {
  if (pendingCount === 0) return t('employee.homeDescriptionNothingDue')
  if (pendingCount === 1) return t('employee.homeDescription')
  return t('employee.next.homeDescriptionMany', { count: pendingCount })
}

/**
 * The section meta in the canvas's pattern — the survey on the card, then what else is open.
 * The canvas says "una encuesta abierta, y su copia de ensayo" because its second survey is
 * its demo's rehearsal copy; nothing on `DashboardPendingSurvey` says a survey is a copy, so
 * the rest is counted: "una encuesta abierta, y otra más", "…, y 2 más". From
 * `pendingSurveyCount`, never from the list, which is a page of it (`SurveyRowLimit` = 5).
 */
function toAnswerMeta(pendingCount: number, t: TranslateFn): string {
  if (pendingCount === 1) return t('employee.next.toAnswerMetaOne')
  if (pendingCount === 2) return t('employee.next.toAnswerMetaAndOneMore')
  return t('employee.next.toAnswerMetaAndMore', { count: pendingCount - 1 })
}

function HomeBody({ model }: { model: EmployeeHomeModel }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col">
      {/* No top margin: `PageTopBar` already ends with the 24px section gap under its
          hairline, which is the canvas's space between the greeting and this heading. */}
      <section aria-labelledby="home-to-answer" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {/* The canvas draws two states of this one section: "Para responder" over the
              task, and "Ya respondió" over the answered card. The third heading is the
              honest floor between them — see `nothingDueHeading` below. */}
          <h2 id="home-to-answer" className="m-0">
            {model.lead
              ? t('employee.next.toAnswerHeading')
              : model.hasAnsweredIdentified
                ? t('employee.next.answeredHeading')
                : t('employee.next.nothingDueHeading')}
          </h2>
          <span data-slot="home-to-answer-meta" className="text-sm text-fg-secondary">
            {model.pendingCount > 0 ? toAnswerMeta(model.pendingCount, t) : t('employee.next.nothingDueMeta')}
          </span>
        </div>

        {model.lead ? (
          <>
            <LeadCard survey={model.lead} allowsSaveForLater={model.leadAllowsSaveForLater} />
            {model.others.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {model.others.map((survey) => (
                  <AlsoOpenRow key={survey.id} survey={survey} />
                ))}
              </ul>
            ) : null}
            {/* Only when the page is genuinely showing less than it was told about. */}
            {model.beyondList ? (
              <Button asChild variant="link" className="w-fit">
                <Link to="/surveys/my">{t('navigation.mySurveys')}</Link>
              </Button>
            ) : null}
          </>
        ) : (
          <NothingDueCard model={model} />
        )}
      </section>

      {/* Absent, not empty, when nothing has closed: the endpoint's `null`. */}
      {model.outcome ? <OutcomeCard outcome={model.outcome} /> : null}

    </div>
  )
}

/**
 * The countdown sentence beside the "Abierta" chip — "Cierra en 30 días · el 10 de
 * octubre". Nothing at all for an unparseable date: a countdown is a claim.
 */
function closesSentence(survey: HomeSurvey, t: TranslateFn, locale: string): string | null {
  if (survey.daysLeft === null) return null
  const countdown =
    survey.daysLeft === 0
      ? t('employee.taskClosesToday')
      : survey.daysLeft === 1
        ? t('employee.taskClosesInOneDay')
        : t('employee.taskClosesInDays', { days: survey.daysLeft })
  return [countdown, t('employee.next.closesOnDate', { date: formatDayMonth(survey.closesAt, locale) })].join(' · ')
}

/**
 * The task: the survey this page leads with, drawn as the canvas's card with the accent
 * border — the only thing on the page anybody has to act on.
 */
function LeadCard({ survey, allowsSaveForLater }: { survey: HomeSurvey; allowsSaveForLater: boolean | null }) {
  const { t, locale } = useTranslation()
  const closes = closesSentence(survey, t, locale)

  return (
    <div
      data-slot="home-lead"
      className={cn(
        // 16px sides on a phone, the canvas's 20px from `sm`: the 8px given back is what lets
        // the three readings sit on one line at 390px.
        'grid gap-6 rounded-xl border border-accent-blue bg-surface-card px-4 pb-5 pt-4.5 shadow-sm sm:px-5',
        // The promise takes the right-hand column only when there is one to make; a
        // survey that records who answered gets the full width and no block.
        survey.anonymous && 'lg:grid-cols-[minmax(0,1fr)_320px]',
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Chip tone="good" label={t('employee.next.openChip')} icon={<Check aria-hidden="true" />} />
          {closes ? <span className="text-sm text-fg-secondary">{closes}</span> : null}
        </div>
        <h3 className="m-0 font-store-serif text-2xl font-normal">{survey.name ?? t('surveys.untitled')}</h3>

        {/* Three readings, in mono, as the canvas sets them. `dl` because each is a
            labelled value rather than a row of a table. Equal thirds wherever a third holds
            its reading — the canvas's 1440 — and never a tile narrower than its reading: a
            tile that cannot have its third keeps its reading's width and the others share
            the rest, and one that does not fit at all moves to the next line. Fixed thirds
            broke "unos 4 min" as "unos 4 / min" at 390px and in the 1024 two-column card. */}
        <dl className="m-0 flex max-w-120 flex-wrap gap-2 sm:gap-2.5">
          <Reading label={t('employee.taskQuestions')} value={survey.questionCount.toLocaleString(locale)} />
          <Reading label={t('employee.taskAbout')} value={t('employee.taskMinutes', { minutes: survey.minutes })} />
          <Reading label={t('employee.taskCloses')} value={calendarDay(Date.parse(survey.closesAt), locale)} />
        </dl>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          {/* `/surveys/:id/respond` is authorized per user by the respond endpoint itself:
              every role that can be sent a survey can open it, so nothing gates this. */}
          <Button asChild variant="primary" size="canvas">
            <Link to={`/surveys/${survey.id}/respond`}>
              <ArrowRight aria-hidden="true" />
              {t('employee.startAnswering')}
            </Link>
          </Button>
          {allowsSaveForLater === true ? (
            <span className="text-sm text-fg-secondary">{t('employee.next.canSaveLater')}</span>
          ) : null}
        </div>
      </div>

      {survey.anonymous ? <AnonymityNotice anonymous /> : null}
    </div>
  )
}

/**
 * **The answered state** — the EmployeeDashboardAnswered artboard (10 Sep), drawn when the
 * reader owes nothing.
 *
 * ## What the artboard asks for that no endpoint can serve
 *
 * The artboard's card names the survey the reader answered, the day they answered it, and
 * the day it closes, and marks the response date "dato nuevo" — because it is. A survey
 * that records who answered leaves `SurveyQueries.AssignedTo`'s result set the moment it is
 * answered (`!responses.Any(r => … && r.IsComplete)`), so it is in neither
 * `GET /dashboard/employee`'s `pendingSurveys` nor `GET /surveys/my`; the only thing either
 * payload carries about it is `completedSurveyCount`, a tally with no survey and no date
 * attached. The artboard's own note says so: "Hoy Inicio solo recibe cuántas encuestas
 * respondió la persona, no cuáles ni cuándo".
 *
 * So the card names no survey, prints no response date, and carries none of the three
 * readings. Drawing that row against a survey this page cannot identify would be a receipt
 * for an answer it cannot see.
 *
 * ## What it does say, and on what evidence
 *
 * - **"Ya respondió", and the tick, only on `hasAnsweredIdentified`.** A completed response
 *   the server recorded against this user row. At zero the heading falls back to "Nada
 *   pendiente" and the chip is not drawn, because zero is also what an anonymous survey
 *   leaves behind — silence, never "you did not answer".
 * - **The three steps are guidance, not readings.** Each is true of every reader: the next
 *   survey arrives under "Para responder"; results are published to the department as
 *   averages with the floor applied; an anonymous survey leaves no receipt, which is why
 *   this page can never be sure about one. Only the second takes data — the department's
 *   name and the floor — and each falls back to a sentence that states neither rather than
 *   assuming one.
 */
function NothingDueCard({ model }: { model: EmployeeHomeModel }) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="home-nothing-due"
      // The lead card's geometry with the canvas's green hairline
      // (`--admin-accent-border-green` IS `rgba(18,148,91,.2)`), and its two columns at the
      // same breakpoint, so the answered state and the task state are one card in two moods.
      className={cn(
        'grid gap-6 rounded-xl border border-accent-green-ring bg-surface-card px-4 pb-5 pt-4.5 shadow-sm sm:px-5',
        // The artboard's own split (`minmax(0,1fr) 440px`), a little narrower: at 440 the
        // steps' lines are short enough that the column runs well past the left one, and the
        // card is as tall as whichever side is taller.
        'lg:grid-cols-[minmax(0,1fr)_400px]',
      )}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {model.hasAnsweredIdentified ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <Chip tone="good" label={t('employee.next.answeredChip')} icon={<Check aria-hidden="true" />} />
          </div>
        ) : null}
        <h3 className="m-0 font-store-serif text-2xl font-normal">{t('employee.next.nothingDueTitle')}</h3>
        <p className="mb-0 max-w-measure text-base text-fg-secondary">
          {/* Never the department. This used to read "no hay ninguna encuesta abierta para
              <departamento>", which was wrong twice over and ESPH's rehearsal caught it on
              2026-10-19.

              It was FALSE: `pendingSurveyCount` is per-person -- `SurveyQueries.AssignedTo`
              ends `!responses.Any(r => r.SurveyId == s.Id && r.UserId == userId &&
              r.IsComplete)` -- so it drops to zero the moment THIS reader answers, while the
              survey stays open to everyone else in their department. Every ESPH respondent
              would have been told their department had nothing open, from the minute they
              finished until the survey closed.

              And it printed the department at the evaluado, which finding 3 had already
              ruled against -- the same sweep that took it off the eyebrow above stopped
              short of this sentence. The generic line is the one the count can actually
              support: it speaks about the reader, which is all this number knows. */}
          {t('dashboard.noPendingSurveysDescription')}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {/* The artboard's "Ver el recibo en Mis Encuestas", without the receipt: the
              destination is real and holds the same list, so it keeps the way out. */}
          <Button asChild variant="outline" size="canvas">
            <Link to="/surveys/my">
              <Inbox aria-hidden="true" />
              {t('navigation.mySurveys')}
            </Link>
          </Button>
          <span className="text-sm text-fg-secondary">{t('employee.next.nothingDueAnswersNote')}</span>
        </div>
      </div>

      <WhatHappensNow model={model} />
    </div>
  )
}

/**
 * The artboard's right-hand column: what is true of a reader who owes nothing — two things
 * always, and the no-receipt explanation only where there is no receipt to explain.
 */
function WhatHappensNow({ model }: { model: EmployeeHomeModel }) {
  const { t } = useTranslation()
  // The server's own floor, from the last outcome it sent — never the constant 5 assumed
  // here. With no outcome the sentence states the rule without a number instead.
  const floor = model.outcome?.floor ?? null

  return (
    // The rule is the column divider at the width the card actually has two columns, and
    // nothing above it: on a phone the steps sit under the text, not beside a stray line.
    <div className="flex min-w-0 flex-col lg:border-l lg:border-line-light lg:pl-6">
      <span className="pb-0.5 text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
        {t('employee.next.whatHappensNow')}
      </span>
      <ul className="m-0 flex list-none flex-col p-0">
        <NextStep
          icon={<Clock className="size-icon" />}
          title={t('employee.next.nextSurveyTitle')}
          body={t('employee.next.nextSurveyBody')}
        />
        <NextStep
          icon={<FileText className="size-icon" />}
          // One title, whatever department the reader is in. It used to name the
          // department and promise the results would reach it; ruled 2026-10-13 that
          // they do not — they are processed and analysed here and handed to the
          // people the organisation designates. `resultsGoToTitleAnyDepartment` is
          // left in both catalogues rather than removed, so nothing that still asks
          // for it breaks, but nothing asks for it now.
          title={t('employee.next.resultsGoToTitle')}
          body={
            floor === null
              ? t('employee.next.resultsGoToBodyNoFloor')
              : t('employee.next.resultsGoToBody', { floor })
          }
        />
        {/* Only where there is no record to contradict it.
            `anonymousNoReceiptBody` says "la plataforma no sabe si usted la respondió" —
            it explains an ABSENT receipt. `hasAnsweredIdentified` is the platform holding
            a completed response against this user row (`completedCount` counts
            `r.UserId == me.Id`, and an anonymous survey writes no user id), so when it is
            true the sentence is false, and it was printed on the same card as the
            "✓ Respondida" chip that proves it. All three ESPH surveys are
            `anonymous: false`, so all 642 respondents would have read it.

            `false` is silence, not "you did not answer" — the step stays there, because
            an unexplained absence of a receipt is the thing it exists to explain. */}
        {model.hasAnsweredIdentified ? null : (
          <NextStep
            icon={<EyeOff className="size-icon" />}
            title={t('employee.next.anonymousNoReceiptTitle')}
            body={t('employee.next.anonymousNoReceiptBody')}
          />
        )}
      </ul>
    </div>
  )
}

/** One step of that column — the canvas's glyph box, the claim and the line under it. */
function NextStep({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-line-light py-3.5 last:border-b-0 last:pb-0">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        <span className="text-sm text-fg-secondary">{body}</span>
      </div>
    </li>
  )
}

/**
 * A reading's last word held to the one before it — "4 min", "10 oct" — so a tile too narrow
 * for the whole reading breaks before the number, never between the number and its unit.
 */
function bindLastWord(value: string): string {
  return value.replace(/ (?=\S+$)/, '\u00a0')
}

/** One labelled reading on the task card — the canvas's ground-coloured tile. */
function Reading({ label, value }: { label: string; value: string }) {
  return (
    // `flex-1` from a zero basis is the equal thirds; `min-w-max` is the floor — with
    // `min-w-0` instead, a tile shrank below its reading and "10 oct" broke as "10 oc / t".
    <div className="flex min-w-max flex-1 flex-col gap-0.5 rounded-lg bg-surface-outer px-2.5 py-2.5 sm:px-3">
      <dt className="text-2xs font-bold uppercase tracking-label text-fg-secondary">{label}</dt>
      {/* Never truncated: an ellipsised "unos 4…" is a different reading from "unos 4 min". */}
      <dd className="m-0 break-words font-mono text-lg tabular-nums text-fg-primary">{bindLastWord(value)}</dd>
    </div>
  )
}

/**
 * A survey behind the first one — "También abierta: …", quieter than the task.
 *
 * Its one-line summary is `employee.surveyMeta`, which My Surveys also renders: the two
 * screens describe the same row of the same list, and two spellings of "6 preguntas · unos
 * 4 minutos · cierra el 10 oct" is how they drift apart.
 */
function AlsoOpenRow({ survey }: { survey: HomeSurvey }) {
  const { t, locale } = useTranslation()
  const date = calendarDay(Date.parse(survey.closesAt), locale)

  return (
    // The way in sits beside its text while the text keeps 180px (`basis-45`), and drops under
    // it — still at the right (`ml-auto`) — below that. Measured on the fixture's row: beside
    // at 390px and wider, the canvas's phone, where round 2 kept "Responder" off a line of its
    // own; under at 375px and narrower. With no wrap at all, 320px squeezed the title and its
    // line into a 117px column 207px tall, a word or two a line (fix round 3). A zero basis
    // (`flex-1`) would never wrap, and no basis at all would wrap a long title at 390 too.
    <li
      data-slot="home-also-open"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-light px-3.5 py-2.5"
    >
      <div className="flex min-w-0 grow basis-45 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary"
        >
          <Inbox className="size-icon" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-base text-fg-primary">
            {t('employee.next.alsoOpen')} <b className="font-semibold">{survey.name ?? t('surveys.untitled')}</b>
          </span>
          <span className="text-sm text-fg-secondary">
            {survey.questionCount === 1
              ? t('employee.surveyMetaOneQuestion', { date })
              : t(byCount(survey.questionCount, 'employee.surveyMetaOne', 'employee.surveyMeta'), { questions: survey.questionCount, minutes: survey.minutes, date })}
          </span>
        </div>
      </div>
      <Link
        to={`/surveys/${survey.id}/respond`}
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-base font-medium text-fg-primary no-underline hover:underline"
      >
        {t('dashboard.respondNow')}
        <ArrowRight aria-hidden="true" className="size-3.5 text-fg-secondary" />
      </Link>
    </li>
  )
}

/**
 * "Qué pasó con la anterior": the last survey that closed and what the company opened
 * since — counts and dates, never a score, never a protected group's name or size.
 */
function OutcomeCard({ outcome }: { outcome: HomeOutcome }) {
  const { t, locale } = useTranslation()
  const survey = outcome.surveyName ?? t('surveys.untitled')

  const closedBody = [
    // Each count agrees with its own noun ("1 respuesta en 0 departamentos"), so the two
    // are rendered apart and the sentence only joins them.
    t('employee.cameOfItClosedBodyCounted', {
      responses: t(byCount(outcome.responseCount, 'employee.cameOfItResponsesOne', 'employee.cameOfItResponsesMany'), {
        count: outcome.responseCount,
      }),
      departments: t(byCount(outcome.departmentCount, 'employee.cameOfItDepartmentsOne', 'employee.cameOfItDepartmentsMany'), {
        count: outcome.departmentCount,
      }),
    }),
    // Appended to the same sentence rather than given a line of its own: a protected
    // department that looked like its own item would be a place a reader goes looking
    // for a name. The catalogue string takes a count and the floor, and no department.
    outcome.protectedDepartmentCount === 0
      ? null
      : outcome.protectedDepartmentCount === 1
        ? t('employee.cameOfItProtectedOne', { floor: outcome.floor })
        : t('employee.cameOfItProtectedMany', { count: outcome.protectedDepartmentCount, floor: outcome.floor }),
  ]
    .filter((part): part is string => part !== null)
    .join(' ')

  const plansTitle =
    outcome.openPlanCount === 0
      ? t('employee.cameOfItPlansNone')
      : outcome.openPlanCount === 1
        ? t('employee.cameOfItPlansTitleOne')
        : t('employee.cameOfItPlansTitle', { count: outcome.openPlanCount })

  // `Intl.ListFormat`: the conjunction is the reader's language's business — Spanish writes
  // "Personas, Operaciones e Ingeniería", with the "e" before an "I".
  const departments =
    outcome.planDepartments.length > 0
      ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(outcome.planDepartments)
      : null
  const plansBody = [
    departments === null ? null : t('employee.cameOfItPlansBody', { departments }),
    // The plans listed and the tally are one population — outstanding plans opened since
    // (`DashboardQueries.OpenPlansOpenedSince`) — so "all of them are still open" is what
    // the count says, not a second claim. Dropped at zero, where there is nothing to be open.
    outcome.openPlanCount === 0
      ? null
      : outcome.openPlanCount === 1
        ? t('employee.next.plansStillOpenOne')
        : t('employee.next.plansStillOpen', { count: outcome.openPlanCount }),
  ]
    .filter((part): part is string => part !== null)
    .join(' ')

  return (
    <section
      aria-labelledby="home-outcome"
      data-slot="home-outcome"
      className="mt-6 flex flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 pb-4.5 pt-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="home-outcome" className="m-0">
          {t('employee.cameOfItHeading')}
        </h2>
        <span className="text-sm text-fg-secondary">{t('employee.next.previousMeta', { survey })}</span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        <OutcomeRow
          icon={<Check className="size-icon" />}
          tone="good"
          title={t('employee.cameOfItClosedTitle', { survey })}
          body={closedBody}
          aside={
            <time dateTime={outcome.closedOn}>{calendarDay(Date.parse(outcome.closedOn), locale)}</time>
          }
        />
        <OutcomeRow
          icon={<Target className="size-icon" />}
          tone="neutral"
          title={plansTitle}
          body={plansBody === '' ? null : plansBody}
          aside={
            outcome.firstPlanOpenedOn === null ? null : (
              <time dateTime={outcome.firstPlanOpenedOn}>
                {calendarDay(Date.parse(outcome.firstPlanOpenedOn), locale)}
              </time>
            )
          }
        />
      </ul>
    </section>
  )
}

/**
 * One row of the outcome card: the tinted glyph box, the claim and its qualification, and
 * the date on the right in mono. Hairline-separated, as the canvas draws the list.
 */
function OutcomeRow({
  icon,
  tone,
  title,
  body,
  aside,
}: {
  icon: ReactNode
  tone: 'good' | 'neutral'
  title: string
  body: string | null
  aside: ReactNode
}) {
  return (
    <li className="flex items-start gap-3 border-b border-line-light py-3.5 last:border-b-0">
      <span
        aria-hidden="true"
        className={
          tone === 'good'
            ? 'grid size-7 shrink-0 place-items-center rounded-lg bg-accent-green-soft text-accent-green-ink'
            : 'grid size-7 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary'
        }
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        {body ? <span className="max-w-measure text-sm text-fg-secondary">{body}</span> : null}
      </div>
      {aside ? (
        <span className="shrink-0 whitespace-nowrap font-mono text-sm tabular-nums text-fg-secondary">{aside}</span>
      ) : null}
    </li>
  )
}
