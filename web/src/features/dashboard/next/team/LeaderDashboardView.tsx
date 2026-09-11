import { Link } from 'react-router'
import { ArrowRight, Plus, Target } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ProtectedCell } from '../../../../components/charts'
import { Button, Chip, LoadingRegion, SkeletonText } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { dimensionLabel } from '../../../surveys/dimensionLabel'
import SemaforoChip from '../../../tracking/components/SemaforoChip'
import { InfoBox, NodoTile } from '../../../tracking/next/parts'
import { fullDay } from '../../../tracking/next/derive'
import { planCalendarDay } from '../../../tracking/planDates'
import DashboardExportMenu from '../DashboardExportMenu'
import { percentReading, reading, signedReading } from '../derive'
import { dimensionMove, dimensionStanding } from './compose'
import { barPercent, count, daysNote } from './format'
import type { LeaderDashboardModel, TeamClosedWave, TeamDimension, TeamOpenSurvey, TeamPlan } from './model'
import { HatchedCount, TeamCard, TeamPlanRow } from './parts'

/** The target rule's hex, as every redesigned chart draws it (`AdminDashboardNextView`). */
const TARGET_RULE = '#b9b6cc'

/** How many open plans the card lists before it points at the board for the rest. */
const PLANS_LISTED = 3

/**
 * The leader's Panel de Control — `/dashboard` for the `leader` role, drawn as the
 * LeaderDashboard artboard (10 Sep): where the team stands (three tiles) → the team against
 * the organisation, dimension by dimension, with the dashed target → the plan that is
 * working on the team beside the open survey's participation.
 *
 * It takes the model as a prop and makes no request: `TeamDashboardPage` hands it
 * `useLeaderDashboardModel()`.
 *
 * ## What it never prints
 *
 * - **A number for a withheld reading.** The model carries `null` for the team's scores and
 *   its respondents when the server withheld them; the cells are hatched and say
 *   "protegido", and the comparison beside them is dropped with them — half a comparison
 *   would give the other half back.
 * - **A sub-floor count.** The open survey's team count is `null` under the floor in the
 *   model, so the row can only draw "menos de 5 respuestas".
 * - **A control the server would refuse.** "Exportar" is the department's file
 *   (`canExport` for a team role, `DashboardEndpoints.cs:124`). "Crear plan" is offered only
 *   where a tracking plan can be created for this team — a node leader on their own nodo,
 *   `Roles.PlanCreator` in the tracking service (`leadsANodo`) — and "Abrir el plan" only on
 *   a plan this reader may open (`canRecordProgress`, `PlanAccessHandler`). `POST
 *   /action-plans` and `/action-plans/{id}` are `Roles.Admin` and never linked from here.
 */
export default function LeaderDashboardView({ model }: { model: LeaderDashboardModel }) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  // The department's own file: `canExport` also admits an admin, whose dashboard is not this.
  const showExport = capabilities.canExport && capabilities.seesTeam
  // A tracking plan for this team: the tracking service must exist, and the reader must lead
  // the team's nodo — `CreateAsync` refuses a leader on any other node.
  const mayCreatePlan = model.trackingOn && capabilities.leadsANodo

  return (
    <div>
      <PageTopBar
        eyebrow={`${model.departmentName} · ${t('users.leader')}`}
        title={t('dashboard.next.title')}
        description={t('dashboard.next.leader.description')}
        actions={showExport ? <DashboardExportMenu subject={model.departmentName} scope="department" /> : undefined}
      />

      {/* `-mt-1`: the top bar leaves 24px under its rule; the artboard opens at 20px. */}
      <div data-slot="team-sections" className="-mt-1 flex flex-col gap-section">
        <section aria-labelledby="team-where" className="flex flex-col gap-2.5">
          <h2 id="team-where" className="m-0 text-2xl">
            {t('dashboard.next.leader.whereHeading')}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <NodoTile label={t('dashboard.next.leader.membersLabel')}>
              <span className="font-mono text-kpi-hero leading-none tabular-nums">{count(model.activeMemberCount, locale)}</span>
              <span className="text-sm text-fg-label">{t('dashboard.next.leader.membersActive')}</span>
              {model.memberCount !== model.activeMemberCount && (
                <span className="text-sm text-fg-label">
                  {t('dashboard.next.leader.membersOfTotal', { total: count(model.memberCount, locale) })}
                </span>
              )}
            </NodoTile>
            <ResponsesTile wave={model.closedWave} t={t} locale={locale} />
            <OpenSurveysTile surveys={model.openSurveys} total={model.openSurveyCount} t={t} locale={locale} />
          </div>
        </section>

        <CompareCard model={model} mayCreatePlan={mayCreatePlan} t={t} locale={locale} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <PlansCard model={model} canOpen={capabilities.canRecordProgress} t={t} locale={locale} />
          <ParticipationCard model={model} t={t} locale={locale} />
        </div>
      </div>
    </div>
  )
}

function ResponsesTile({ wave, t, locale }: { wave: TeamClosedWave | null; t: TranslateFn; locale: string }) {
  if (wave === null) {
    return (
      <NodoTile label={t('dashboard.next.leader.responsesLabelNoWave')}>
        <span className="font-mono text-kpi-hero leading-none tabular-nums">—</span>
        <span className="text-sm text-fg-label">{t('dashboard.next.leader.responsesNone')}</span>
      </NodoTile>
    )
  }
  const date = wave.closedOn ? calendarDay(Date.parse(wave.closedOn), locale) : '—'
  return (
    <NodoTile label={t('dashboard.next.leader.responsesLabel', { wave: wave.code })}>
      {wave.respondents === null ? (
        <>
          <HatchedCount
            text={t('dashboard.next.leader.responsesWithheld', { floor: wave.floor })}
            label={t('dashboard.next.leader.responsesWithheldLabel', { floor: wave.floor })}
          />
          <span className="text-sm text-fg-label">{t('dashboard.next.leader.closedOn', { date })}</span>
        </>
      ) : (
        <>
          <span className="font-mono text-kpi-hero leading-none tabular-nums">{count(wave.respondents, locale)}</span>
          <span className="text-sm text-fg-label">{t('dashboard.next.leader.responsesUnit', { date })}</span>
        </>
      )}
    </NodoTile>
  )
}

/** "ambas cierran el 10 oct" only when every open survey is listed and all close that day. */
function openUnit(surveys: readonly TeamOpenSurvey[], total: number, t: TranslateFn, locale: string): string {
  const first = surveys[0]
  if (total === 0 || first === undefined) return t('dashboard.next.leader.openNone')
  const day = (iso: string) => calendarDay(Date.parse(iso), locale)
  const date = day(first.closesOn)
  if (total === 1) return t('dashboard.next.leader.openOneCloses', { date })
  const sameDay = surveys.length === total && surveys.every((survey) => day(survey.closesOn) === date)
  if (!sameDay) return t('dashboard.next.leader.openFirstCloses', { date })
  return total === 2 ? t('dashboard.next.leader.openBothClose', { date }) : t('dashboard.next.leader.openAllClose', { date })
}

function OpenSurveysTile({
  surveys,
  total,
  t,
  locale,
}: {
  surveys: readonly TeamOpenSurvey[]
  total: number
  t: TranslateFn
  locale: string
}) {
  return (
    <NodoTile label={t('dashboard.next.leader.openLabel')}>
      <span className="font-mono text-kpi-hero leading-none tabular-nums">{count(total, locale)}</span>
      <span className="text-sm text-fg-label">{openUnit(surveys, total, t, locale)}</span>
    </NodoTile>
  )
}

/** The dashed target mark the canvas draws beside "meta 3,7". */
function TargetMark() {
  return (
    <svg aria-hidden="true" width="18" height="2" viewBox="0 0 18 2" className="shrink-0">
      <line x1="0" x2="18" y1="1" y2="1" stroke={TARGET_RULE} strokeDasharray="3 2" />
    </svg>
  )
}

function CompareCard({
  model,
  mayCreatePlan,
  t,
  locale,
}: {
  model: LeaderDashboardModel
  mayCreatePlan: boolean
  t: TranslateFn
  locale: string
}) {
  const wave = model.closedWave
  const target = reading(model.target, locale)
  const surveyName = wave?.name ?? t('surveys.untitled')
  const meta = wave ? (
    <>
      <span>{surveyName}</span>
      {wave.respondents !== null && (
        <span>· {t('dashboard.next.leader.compareResponses', { count: count(wave.respondents, locale) })}</span>
      )}
      <span className="inline-flex items-center gap-1.5">
        · <TargetMark /> {t('dashboard.next.leader.target', { target })}
      </span>
    </>
  ) : undefined

  return (
    <TeamCard id="team-compare" heading={t('dashboard.next.leader.compareHeading')} meta={meta}>
      {wave === null ? (
        <p className="m-0 text-sm text-fg-label">{t('dashboard.next.leader.noClosedSurvey')}</p>
      ) : wave.surveyWithheld ? (
        <ProtectedCell
          responses={0}
          threshold={wave.floor}
          description={surveyName}
          showWord={false}
          suppressedClassName="h-8.5 w-full"
        >
          {null}
        </ProtectedCell>
      ) : (
        <div
          data-slot="team-dimensions"
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          {wave.dimensions.map((dimension) => (
            <DimensionCard
              key={dimension.key}
              dimension={dimension}
              wave={wave}
              department={model.departmentName}
              target={model.target}
              mayCreatePlan={mayCreatePlan}
              t={t}
              locale={locale}
            />
          ))}
        </div>
      )}
      {wave !== null && (wave.withheld || wave.surveyWithheld) && (
        <p className="m-0 text-sm text-fg-label">
          {wave.surveyWithheld
            ? t('dashboard.next.leader.surveyWithheld', { survey: surveyName, floor: wave.floor })
            : t('dashboard.next.leader.teamWithheld', { survey: surveyName, floor: wave.floor })}
        </p>
      )}
      {wave !== null && !wave.surveyWithheld && (
        <div data-slot="team-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-label">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-3.5 rounded bg-accent-blue" />
            {t('dashboard.next.leader.legendTeam', {
              department: model.departmentName,
              count: count(model.memberCount, locale),
            })}
          </span>
          {!wave.withheld && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-3.5 rounded bg-chart-div-mid" />
              {model.organizationRespondents === null
                ? t('dashboard.next.leader.legendOrgNoCount')
                : t('dashboard.next.leader.legendOrg', { count: count(model.organizationRespondents, locale) })}
              {/* The one sample-fed region of the page, marked where it is: the org side. */}
              {model.organizationIsSample && (
                <Chip data-slot="sample-chip" tone="warning" label={t('dashboard.next.sampleChip')} />
              )}
            </span>
          )}
          {mayCreatePlan && !wave.withheld && <span>{t('dashboard.next.leader.planRule')}</span>}
        </div>
      )}
    </TeamCard>
  )
}

function DimensionCard({
  dimension,
  wave,
  department,
  target,
  mayCreatePlan,
  t,
  locale,
}: {
  dimension: TeamDimension
  wave: TeamClosedWave
  department: string
  target: number
  mayCreatePlan: boolean
  t: TranslateFn
  locale: string
}) {
  const name = dimensionLabel(dimension.key, t)
  const standing = dimensionStanding(dimension, target)
  const move = dimensionMove(dimension)
  const below = standing === 'below'
  const targetText = reading(target, locale)

  return (
    <div
      data-slot="team-dimension"
      data-dimension={dimension.key}
      data-standing={standing ?? 'withheld'}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-md border px-3.5 py-3',
        below ? 'border-accent-red-ring bg-accent-red-soft' : 'border-line-light bg-surface-card',
      )}
    >
      <span className="truncate text-sm text-fg-secondary" title={name}>
        {name}
      </span>
      {dimension.team === null ? (
        <ProtectedCell
          responses={0}
          threshold={wave.floor}
          description={`${department}, ${name}`}
          mark="word"
          suppressedClassName="h-8.5 w-full"
        >
          {null}
        </ProtectedCell>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span data-slot="team-reading" className="font-mono text-3xl leading-none text-fg-primary tabular-nums">
              {reading(dimension.team, locale)}
            </span>
            <span className="text-xs text-fg-label">{t('dashboard.next.leader.teamWord')}</span>
          </div>
          {move !== null && (
            <span className="text-xs whitespace-nowrap text-fg-label">
              <span
                data-slot="team-move"
                className={cn('font-mono text-sm tabular-nums', move >= 0 ? 'text-accent-green-ink' : 'text-accent-red-ink')}
              >
                {signedReading(move, locale)}
              </span>{' '}
              {t('dashboard.next.leader.vsOrg')}
            </span>
          )}
          <div aria-hidden="true" className="mt-0.5 flex flex-col gap-1">
            <CompareBar who={t('dashboard.next.leader.teamWord')} value={dimension.team} tone="team" target={target} locale={locale} />
            {dimension.organization !== null && (
              <CompareBar
                who={t('dashboard.next.leader.orgWord')}
                value={dimension.organization}
                tone="org"
                target={target}
                locale={locale}
              />
            )}
          </div>
          <div className="mt-auto pt-0.5">
            {below ? (
              <div className="flex flex-col gap-2">
                <span>
                  <Chip tone="critical" label={t('dashboard.next.leader.standingBelow', { target: targetText })} />
                </span>
                {mayCreatePlan && (
                  <Button asChild variant="primary" size="canvas" className="w-full">
                    <Link
                      to="/tracking/planes"
                      aria-label={t('dashboard.next.leader.createPlanFor', { dimension: name })}
                    >
                      <Plus aria-hidden="true" />
                      {t('dashboard.next.leader.createPlan')}
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex h-5.5 items-center text-sm text-fg-label">
                {standing === 'on'
                  ? t('dashboard.next.leader.standingOn', { target: targetText })
                  : t('dashboard.next.leader.standingAbove', { target: targetText })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** One bar of a dimension card: who, the 8px track with the dashed target, the reading. */
function CompareBar({
  who,
  value,
  tone,
  target,
  locale,
}: {
  who: string
  value: number
  tone: 'team' | 'org'
  target: number
  locale: string
}) {
  return (
    <div className="grid grid-cols-[38px_minmax(0,1fr)_26px] items-center gap-1.5">
      <span className="text-2xs text-fg-label">{who}</span>
      <div className="relative h-2 rounded bg-surface-icon-box">
        <div
          className={cn('h-full rounded', tone === 'team' ? 'bg-accent-blue' : 'bg-chart-div-mid')}
          style={{ width: `${barPercent(value)}%` }}
        />
        <span
          className="absolute -top-[3px] h-3.5 border-l border-dashed"
          style={{ left: `${barPercent(target)}%`, borderColor: TARGET_RULE }}
        />
      </div>
      <span className="text-right font-mono text-2xs text-fg-label tabular-nums">{reading(value, locale)}</span>
    </div>
  )
}

function plansMeta(open: number, overdue: number, t: TranslateFn): string {
  const openText = open === 1 ? t('dashboard.next.leader.plansOpenOne') : t('dashboard.next.leader.plansOpenMany', { count: open })
  const overdueText =
    overdue === 1 ? t('dashboard.next.leader.plansOverdueOne') : t('dashboard.next.leader.plansOverdueMany', { count: overdue })
  return `${openText} · ${overdueText}`
}

function PlansCard({
  model,
  canOpen,
  t,
  locale,
}: {
  model: LeaderDashboardModel
  canOpen: (plan: { nodoExternalId: string }) => boolean
  t: TranslateFn
  locale: string
}) {
  const plans = model.plans
  const counted = plans.source === 'tracking' || plans.source === 'counts'
  const heading = counted && plans.open !== 1 ? t('dashboard.next.leader.planHeadingMany') : t('dashboard.next.leader.planHeadingOne')

  return (
    <TeamCard
      id="team-plans"
      heading={heading}
      meta={counted ? plansMeta(plans.open, plans.overdue, t) : undefined}
      className="xl:col-span-7"
    >
      {plans.source === 'loading' && (
        <LoadingRegion loading label={t('dashboard.next.leader.plansLoading')}>
          <SkeletonText lines={3} />
        </LoadingRegion>
      )}
      {plans.source === 'failed' && (
        <p role="status" className="m-0 text-sm text-fg-label">
          {plans.error
            ? t('dashboard.next.leader.plansFailed', { error: plans.error })
            : t('dashboard.next.leader.plansFailedNoReason')}
        </p>
      )}
      {plans.source === 'counts' && <p className="m-0 text-sm text-fg-label">{t('dashboard.next.leader.plansCountsOnly')}</p>}
      {plans.source === 'tracking' && plans.plans.length === 0 && (
        <p className="m-0 text-sm text-fg-label">{t('dashboard.next.leader.plansNoneOpen')}</p>
      )}
      {plans.source === 'tracking' &&
        plans.plans.slice(0, PLANS_LISTED).map((plan) => (
          <LeaderPlanRow key={plan.id} plan={plan} canOpen={canOpen(plan)} t={t} locale={locale} />
        ))}
      {plans.source === 'tracking' && plans.plans.length > PLANS_LISTED && (
        <Link to="/tracking/tablero" className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary">
          {t('dashboard.next.leader.plansMore', { count: plans.plans.length })}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      )}
    </TeamCard>
  )
}

function LeaderPlanRow({ plan, canOpen, t, locale }: { plan: TeamPlan; canOpen: boolean; t: TranslateFn; locale: string }) {
  const since = planCalendarDay(plan.createdOn, locale)
  return (
    <TeamPlanRow
      id={plan.id}
      code={plan.code}
      icon={<Target />}
      que={plan.que}
      chips={
        <>
          <SemaforoChip estado={plan.estado} long />
          <span className="text-sm text-fg-label">
            {plan.nodoName
              ? t('dashboard.next.leader.planOpenedSince', { nodo: plan.nodoName, date: since })
              : t('dashboard.next.leader.planOpenedSinceNoNodo', { date: since })}
          </span>
        </>
      }
      boxes={
        <>
          <InfoBox
            label={t('dashboard.next.leader.boxAvance')}
            value={plan.hasProgress ? percentReading(plan.percent, locale) : '—'}
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
            label={t('tracking.next.boxResponsable')}
            value={plan.responsable.name ?? t('tracking.next.personaUnnamed')}
            sub={plan.responsable.isViewer ? t('dashboard.next.leader.responsableIsYou') : t('tracking.next.personaUnnamedSub')}
          />
        </>
      }
      action={
        canOpen ? (
          <Button asChild variant="outline" size="canvas">
            <Link to={`/tracking/planes/${plan.id}`}>
              <ArrowRight aria-hidden="true" />
              {t('dashboard.next.openPlan')}
            </Link>
          </Button>
        ) : undefined
      }
    />
  )
}

function closesLine(survey: TeamOpenSurvey, t: TranslateFn, locale: string): string {
  const date = calendarDay(Date.parse(survey.closesOn), locale)
  if (survey.daysLeft === null) return t('dashboard.next.leader.openOneCloses', { date })
  if (survey.daysLeft === 0) return t('dashboard.next.leader.participationClosesToday')
  return survey.daysLeft === 1
    ? t('dashboard.next.leader.participationClosesOne', { date })
    : t('dashboard.next.leader.participationCloses', { date, days: survey.daysLeft })
}

function ParticipationCard({ model, t, locale }: { model: LeaderDashboardModel; t: TranslateFn; locale: string }) {
  const first = model.openSurveys[0]
  return (
    <TeamCard
      id="team-participation"
      heading={
        first
          ? t('dashboard.next.leader.participationHeading', { wave: first.code })
          : t('dashboard.next.leader.participationHeadingNone')
      }
      meta={t('dashboard.next.leader.participationMeta', {
        department: model.departmentName,
        count: count(model.activeMemberCount, locale),
      })}
      className="xl:col-span-5"
    >
      {first === undefined ? (
        <p className="m-0 text-sm text-fg-label">{t('dashboard.next.leader.participationNone')}</p>
      ) : (
        <>
          <p className="m-0 max-w-[70ch] text-sm text-fg-label">
            {t('dashboard.next.leader.participationNote', { floor: model.floor })}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {model.openSurveys.map((survey) => (
              <li
                key={survey.id}
                data-slot="team-open-survey"
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line-light py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <div className="flex min-w-0 flex-col">
                  {/* The whole title: the artboard lists "Encuesta de Clima Q4 (abierta)" and
                      its "(Copia)" in full, because in a list the parenthetical is what tells
                      two rows apart. `sentenceName` is for a title inside a sentence. */}
                  <span className="text-base text-fg-primary">{survey.name ?? t('surveys.untitled')}</span>
                  <span className="text-sm text-fg-label">{closesLine(survey, t, locale)}</span>
                </div>
                {survey.responses === null ? (
                  <HatchedCount
                    text={t('dashboard.next.leader.participationUnderFloor', { floor: model.floor })}
                    label={t('dashboard.next.leader.participationUnderFloorLabel', { floor: model.floor })}
                  />
                ) : (
                  <span className="font-mono text-sm tabular-nums">
                    {t('dashboard.next.leader.participationCount', {
                      count: count(survey.responses, locale),
                      members: count(model.activeMemberCount, locale),
                    })}
                  </span>
                )}
                <span className="col-start-2 justify-self-end sm:col-start-3">
                  <Chip tone="good" label={t('dashboard.next.leader.surveyActive')} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </TeamCard>
  )
}
