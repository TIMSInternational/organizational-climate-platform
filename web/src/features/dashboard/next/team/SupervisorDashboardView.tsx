import { Link } from 'react-router'
import { ArrowRight, ClipboardList, Plus, Target } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import { Button, Chip } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { calendarDay } from '../../../../lib/calendarDay'
import { RailConsolidatedIcon } from '../../../../navigation/railIcons'
import SemaforoChip from '../../../tracking/components/SemaforoChip'
import { InfoBox } from '../../../tracking/next/parts'
import { fullDay } from '../../../tracking/next/derive'
import { planCalendarDay } from '../../../tracking/planDates'
import { percentReading, sentenceName } from '../derive'
import { count, daysNote } from './format'
import type { SupervisorDashboardModel, SupervisorTask, TeamOpenSurvey, TeamPlan } from './model'
import { CoverageBox, HatchedCount, TeamCard, TeamPlanRow } from './parts'

/**
 * The supervisor's Panel de Control — `/dashboard` for the `supervisor` role, drawn as the
 * SupervisorDashboard artboard (10 Sep) and labelled as what it is: a PROPOSAL. The ruling
 * on what a supervisor's screen is for is pending (`docs/decisions/leader-supervisor-scope.md`);
 * the eyebrow says "Propuesta" and the amber note says why, so nobody reads it as settled.
 *
 * Its job, as the artboard states it: coverage and follow-through — how many answered, in
 * counts, and which commitment comes next. The team's climate against the organisation is
 * the leader's panel and is not repeated here.
 *
 * ## What it never prints
 *
 * - **A count under the floor.** "Ya respondieron" is `null` in the model under the floor and is
 *   hatched; "Faltan por responder" is `null` for exactly as long, because the team's size
 *   minus it would give the hidden count back.
 * - **A control the server would refuse.** No export and no reminder: the artboard draws
 *   none, and `POST /surveys/{id}/invitations/reminders` is `CanAdminister`
 *   (`SurveyDistributionEndpoints.LoadAdministrableSurveyAsync`). "Registrar avance" appears
 *   only on a plan `canRecordProgress` allows — which, for this role, `PlanAccessHandler`
 *   never does: the responsable and the involucrados read. Every plan here is one she may
 *   open, because `mis-tareas` lists only plans she executes.
 */
export default function SupervisorDashboardView({ model }: { model: SupervisorDashboardModel }) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  // No "Propuesta" in the eyebrow and no proposal note: that was the canvas's meta-copy
  // about the design's status, and it shipped to the supervisor (review finding 7).
  const eyebrow = [model.departmentName, t('users.supervisor')].join(' · ')

  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={t('dashboard.next.title')} description={t('dashboard.next.supervisor.description')} />

      <div data-slot="team-sections" className="-mt-1 flex flex-col gap-section">
        <CoverageCard model={model} t={t} locale={locale} />

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <PlansCard model={model} canRecord={capabilities.canRecordProgress} t={t} locale={locale} />
          <TasksCard model={model} t={t} locale={locale} />
        </div>
      </div>
    </div>
  )
}

function daysLeftSentence(survey: TeamOpenSurvey, t: TranslateFn): string | null {
  if (survey.daysLeft === null) return null
  if (survey.daysLeft === 0) return t('dashboard.next.supervisor.coverageClosesToday')
  return survey.daysLeft === 1
    ? t('dashboard.next.supervisor.coverageDaysLeftOne')
    : t('dashboard.next.supervisor.coverageDaysLeft', { days: survey.daysLeft })
}

function CoverageCard({ model, t, locale }: { model: SupervisorDashboardModel; t: TranslateFn; locale: string }) {
  const survey = model.openSurvey
  const floor = model.floor
  const meta = survey ? (
    <>
      <span>
        {t('dashboard.next.supervisor.coverageMeta', {
          survey: survey.name ? sentenceName(survey.name) : t('surveys.untitled'),
          date: calendarDay(Date.parse(survey.closesOn), locale),
        })}
      </span>
      {model.otherOpenCount > 0 && (
        <span>
          ·{' '}
          {model.otherOpenCount === 1
            ? t('dashboard.next.supervisor.coverageMoreOne')
            : t('dashboard.next.supervisor.coverageMoreMany', { count: model.otherOpenCount })}
        </span>
      )}
    </>
  ) : undefined

  return (
    <TeamCard id="supervisor-coverage" heading={t('dashboard.next.supervisor.coverageHeading')} meta={meta}>
      {survey === null ? (
        <p className="m-0 text-sm text-fg-tertiary">
          {t('dashboard.next.supervisor.coverageNone', { department: model.departmentName })}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <CoverageBox
              label={t('dashboard.next.supervisor.peopleLabel')}
              sub={t('dashboard.next.supervisor.peopleSub', { department: model.departmentName })}
            >
              <span className="text-kpi-hero leading-none font-semibold tabular-nums">{count(model.activeMemberCount, locale)}</span>
            </CoverageBox>
            <CoverageBox
              label={t('dashboard.next.supervisor.respondedLabel')}
              sub={
                model.responded === null
                  ? t('dashboard.next.supervisor.respondedHiddenSub', { floor })
                  : t('dashboard.next.supervisor.respondedSub')
              }
            >
              {model.responded === null ? (
                <HatchedCount
                  className="py-1.5 text-lg"
                  text={t('dashboard.next.supervisor.respondedHidden', { floor })}
                  label={t('dashboard.next.supervisor.respondedHiddenLabel', { floor })}
                />
              ) : (
                <span data-slot="coverage-responded" className="text-kpi-hero leading-none font-semibold tabular-nums">
                  {count(model.responded, locale)}
                </span>
              )}
            </CoverageBox>
            <CoverageBox
              label={t('dashboard.next.supervisor.remainingLabel')}
              sub={
                model.remaining === null
                  ? t('dashboard.next.supervisor.remainingHiddenSub', { floor })
                  : t('dashboard.next.supervisor.remainingSub', { count: count(model.activeMemberCount, locale) })
              }
            >
              {model.remaining === null ? (
                <HatchedCount
                  className="py-1.5 text-lg"
                  text={t('dashboard.next.supervisor.remainingHidden')}
                  label={t('dashboard.next.supervisor.remainingHiddenLabel', { floor })}
                />
              ) : (
                <span data-slot="coverage-remaining" className="text-kpi-hero leading-none font-semibold tabular-nums">
                  {count(model.remaining, locale)}
                </span>
              )}
            </CoverageBox>
          </div>
          <p className="m-0 max-w-[70ch] text-sm text-fg-tertiary">
            {t('dashboard.next.supervisor.coverageNote')} {daysLeftSentence(survey, t)}
          </p>
        </>
      )}
    </TeamCard>
  )
}

/** The meta of "Los planes que ejecutas": an overdue compromiso first, else the nearest. */
function plansMeta(plans: readonly TeamPlan[], t: TranslateFn): string | undefined {
  if (plans.length === 0) return undefined
  if (plans.some((plan) => plan.overdue)) return t('dashboard.next.supervisor.plansNextOverdue')
  const days = Math.min(...plans.map((plan) => plan.daysToDue))
  if (days === 0) return t('dashboard.next.supervisor.plansNextToday')
  return days === 1 ? t('dashboard.next.supervisor.plansNextOne') : t('dashboard.next.supervisor.plansNext', { days })
}

function PlansCard({
  model,
  canRecord,
  t,
  locale,
}: {
  model: SupervisorDashboardModel
  canRecord: (plan: { nodoExternalId: string }) => boolean
  t: TranslateFn
  locale: string
}) {
  const plans = model.plans
  return (
    <TeamCard
      id="supervisor-plans"
      heading={t('dashboard.next.supervisor.plansHeading')}
      meta={plans.source === 'tracking' ? plansMeta(plans.plans, t) : undefined}
      className="xl:col-span-7"
    >
      {plans.source === 'off' && <p className="m-0 text-sm text-fg-tertiary">{t('dashboard.next.supervisor.plansOff')}</p>}
      {plans.source === 'failed' && (
        <p role="status" className="m-0 text-sm text-fg-tertiary">
          {t('dashboard.next.supervisor.plansFailedNoReason')}
        </p>
      )}
      {plans.source === 'refused' && (
        <p role="status" className="m-0 text-sm text-fg-tertiary">
          {t('dashboard.next.supervisor.plansRefused')}
        </p>
      )}
      {plans.source === 'tracking' && plans.plans.length === 0 && (
        <p className="m-0 text-sm text-fg-tertiary">{t('dashboard.next.supervisor.plansNone')}</p>
      )}
      {plans.source === 'tracking' &&
        plans.plans.map((plan) => (
          <TeamPlanRow
            key={plan.id}
            id={plan.id}
            code={plan.code}
            icon={<RailConsolidatedIcon />}
            que={plan.que}
            chips={
              <>
                <Chip label={plan.code} className="font-mono" />
                <SemaforoChip estado={plan.estado} long />
                {plan.nodoName && (
                  <span className="text-sm text-fg-tertiary">{t('tracking.next.nodoLabel', { nodo: plan.nodoName })}</span>
                )}
              </>
            }
            boxes={
              <>
                <InfoBox
                  label={t('dashboard.next.leader.boxAvance')}
                  value={percentReading(plan.percent, locale)}
                  sub={
                    plan.hasProgress && plan.lastProgressOn
                      ? t('dashboard.next.leader.lastProgress', { date: planCalendarDay(plan.lastProgressOn, locale) })
                      : t('dashboard.next.leader.noProgress')
                  }
                  mono
                />
                <InfoBox
                  label={t('tracking.next.boxCompromiso')}
                  value={fullDay(plan.dueOn, locale)}
                  sub={daysNote(plan.daysToDue, t)}
                  mono
                  alarm={plan.overdue}
                />
                <InfoBox
                  label={t('tracking.next.boxUltimoAvance')}
                  value={plan.hasProgress && plan.lastProgressOn ? fullDay(plan.lastProgressOn, locale) : '—'}
                  sub={
                    plan.hasProgress
                      ? t('tracking.next.percentRecorded', { percent: plan.percent })
                      : t('tracking.next.noneYet')
                  }
                  mono
                />
              </>
            }
            action={
              canRecord(plan) ? (
                <Button asChild variant="primary" size="canvas">
                  <Link to={`/tracking/planes/${plan.id}`}>
                    <Plus aria-hidden="true" />
                    {t('dashboard.next.logProgress')}
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="outline" size="canvas">
                  <Link to={`/tracking/planes/${plan.id}`}>
                    <ArrowRight aria-hidden="true" />
                    {t('dashboard.next.openPlan')}
                  </Link>
                </Button>
              )
            }
          />
        ))}
    </TeamCard>
  )
}

function taskCopy(task: SupervisorTask, t: TranslateFn): { heading: string; sub: string } {
  switch (task.kind) {
    case 'answer-survey':
      return {
        heading: t('dashboard.next.supervisor.taskAnswer', {
          survey: task.name ? sentenceName(task.name) : t('surveys.untitled'),
        }),
        sub: t('dashboard.next.supervisor.taskAnswerSub'),
      }
    case 'record-progress':
      return {
        heading: task.firstAvance
          ? t('dashboard.next.supervisor.taskRecordFirst', { code: task.code })
          : t('dashboard.next.supervisor.taskRecord', { code: task.code }),
        sub: t('dashboard.next.supervisor.taskRecordSub'),
      }
    case 'follow-plan':
      return {
        heading: t('dashboard.next.supervisor.taskFollow', { code: task.code }),
        sub: t('dashboard.next.supervisor.taskFollowSub'),
      }
  }
}

function TasksCard({ model, t, locale }: { model: SupervisorDashboardModel; t: TranslateFn; locale: string }) {
  const tasks = model.tasks
  return (
    <TeamCard
      id="supervisor-tasks"
      heading={t('dashboard.next.supervisor.tasksHeading')}
      meta={
        tasks.length === 1
          ? t('dashboard.next.supervisor.tasksPendingOne')
          : t('dashboard.next.supervisor.tasksPendingMany', { count: tasks.length })
      }
      className="xl:col-span-5"
    >
      {tasks.length === 0 ? (
        <p className="m-0 text-sm text-fg-tertiary">{t('dashboard.next.supervisor.tasksNone')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {tasks.map((task) => {
            const copy = taskCopy(task, t)
            return (
              <li
                key={`${task.kind}-${task.id}`}
                data-slot="supervisor-task"
                data-kind={task.kind}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line-default py-3 last:border-b-0"
              >
                {/* A glyph for the kind of task, not a checkbox: an empty square read as a
                    control to tick by hand, and no endpoint records a tick (finding 7). */}
                <span
                  aria-hidden="true"
                  className="inline-flex size-7 items-center justify-center rounded-lg bg-surface-fill-subtle text-fg-secondary [&>svg]:size-4"
                >
                  {task.kind === 'answer-survey' ? <ClipboardList /> : <Target />}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  {task.kind === 'answer-survey' ? (
                    // The survey she owes opens where the employee Home's "Empezar a
                    // responder" goes (`EmployeeHomeView`): the task is the way in, not a note.
                    <Link
                      to={`/surveys/${task.id}/respond`}
                      className="text-base font-medium text-accent-blue-ink underline-offset-2 hover:underline"
                    >
                      {copy.heading}
                    </Link>
                  ) : (
                    <span className="text-base text-fg-primary">{copy.heading}</span>
                  )}
                  <span className="text-sm text-fg-tertiary">{copy.sub}</span>
                </div>
                <span className="text-sm whitespace-nowrap text-fg-tertiary tabular-nums">
                  {calendarDay(Date.parse(task.dueOn), locale)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {model.surveysUnread && (
        <p role="status" className="m-0 text-sm text-fg-tertiary">
          {t('dashboard.next.supervisor.tasksSurveysUnread')}
        </p>
      )}
    </TeamCard>
  )
}
