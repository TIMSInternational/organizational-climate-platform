import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Inbox, Target } from 'lucide-react'
import { PageTopBar } from '../../../../components/layout'
import { Button, Chip, EmptyState } from '../../../../components/ui'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { useCompanyScope } from '../../../../company-context'
import DashboardState from '../../components/DashboardState'
import { AnonymityNotice } from '../../../surveys/components/AnonymityNotice'
import { formatDayMonth } from '../../../surveys/respondEstimate'
import { useEmployeeHomeModel } from './useEmployeeHomeModel'
import type { EmployeeHomeModel, HomeOutcome, HomeSurvey } from './model'

/**
 * The employee's Home — `/dashboard` for the `employee` role, and for any role
 * `DashboardPage` does not recognise. The canvas's EmployeeDashboard artboard (10 Sep).
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
 * The section meta says how many surveys are open ("2 encuestas abiertas"); the artboard's
 * "una encuesta abierta, y su copia de ensayo" knows the second is a rehearsal copy, which
 * nothing on the payload does. "Puede guardar y terminar después." is printed only when the
 * lead survey's own `allowPartialResponses` says so. The anonymity block keeps the respond
 * page's copy, which this lane was told to leave unchanged.
 */
export default function EmployeeHomeView() {
  const { t } = useTranslation()
  const { role } = useCompanyScope()
  const { model, loading, failed, error, reload } = useEmployeeHomeModel()

  return (
    <div>
      <PageTopBar
        // "INGENIERÍA · EMPLEADO": where this person stands, as the artboard's eyebrow
        // says it. `null` while loading, because an eyebrow that appears and then changes
        // is worse than one that arrives with its page.
        eyebrow={model ? eyebrowFor(model, role, t) : null}
        // The greeting IS the heading: the one page in the product addressed to a person
        // rather than to an administrator.
        title={model ? t(greetingKey(new Date().getHours()), { name: model.personName }) : t('dashboard.myDashboard')}
        description={
          model
            ? model.pendingCount > 0
              ? t('employee.homeDescription')
              : t('employee.homeDescriptionNothingDue')
            : undefined
        }
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {model && <HomeBody model={model} />}
      </DashboardState>
    </div>
  )
}

const ROLE_LABEL_KEY: Readonly<Record<string, string>> = {
  employee: 'users.employee',
  leader: 'users.leader',
  supervisor: 'users.supervisor',
}

/**
 * The department and the role, joined — "Ingeniería · Empleado". A role this page does not
 * know (it is the dispatch's default) contributes no word rather than a guessed one, and a
 * person with neither gets the workspace eyebrow.
 */
function eyebrowFor(model: EmployeeHomeModel, role: string | undefined, t: TranslateFn): string {
  const roleKey = role === undefined ? undefined : ROLE_LABEL_KEY[role]
  const parts = [model.departmentName, roleKey ? t(roleKey) : null].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  )
  return parts.length > 0 ? parts.join(' · ') : t('employee.eyebrow')
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

function HomeBody({ model }: { model: EmployeeHomeModel }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col">
      {/* No top margin: `PageTopBar` already ends with the 24px section gap under its
          hairline, which is the canvas's space between the greeting and this heading. */}
      <section aria-labelledby="home-to-answer" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="home-to-answer" className="m-0">
            {t('employee.next.toAnswerHeading')}
          </h2>
          {model.pendingCount > 0 ? (
            <span className="text-sm text-fg-secondary">
              {model.pendingCount === 1
                ? t('employee.next.toAnswerMetaOne')
                : t('employee.next.toAnswerMetaMany', { count: model.pendingCount })}
            </span>
          ) : null}
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
          <EmptyState
            title={t('dashboard.noPendingSurveys')}
            // Department-aware where there is a department to name: "no survey is open to
            // Ingeniería" is a fact about this reader.
            description={
              model.departmentName
                ? t('employee.emptyBodyInDepartment', { department: model.departmentName })
                : t('dashboard.noPendingSurveysDescription')
            }
          />
        )}
      </section>

      {/* Absent, not empty, when nothing has closed: the endpoint's `null`. */}
      {model.outcome ? <OutcomeCard outcome={model.outcome} /> : null}

      <p className="mb-0 mt-5 max-w-measure text-sm text-fg-secondary">{t('employee.next.resultsNote')}</p>
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
        'grid gap-6 rounded-xl border border-accent-blue bg-surface-card px-5 pb-5 pt-4.5 shadow-sm',
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
            labelled value rather than a row of a table. */}
        <dl className="m-0 grid max-w-120 grid-cols-3 gap-2.5">
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

/** One labelled reading on the task card — the canvas's ground-coloured tile. */
function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-outer px-3 py-2.5">
      <dt className="text-2xs font-bold uppercase tracking-label text-fg-secondary">{label}</dt>
      <dd className="m-0 truncate font-mono text-lg tabular-nums text-fg-primary">{value}</dd>
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
    <li
      data-slot="home-also-open"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-light px-3.5 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-2.5">
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
              : t('employee.surveyMeta', { questions: survey.questionCount, minutes: survey.minutes, date })}
          </span>
        </div>
      </div>
      <Link
        to={`/surveys/${survey.id}/respond`}
        className="inline-flex shrink-0 items-center gap-1.5 text-base font-medium text-fg-primary no-underline hover:underline"
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
    t('employee.cameOfItClosedBody', {
      responses: outcome.responseCount,
      departments: outcome.departmentCount,
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
