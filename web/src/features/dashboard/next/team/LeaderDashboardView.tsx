import { Link } from 'react-router'
import { ArrowRight, Plus, Target } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import { BandChip, ClimateRangeBar, bandName, type ClimateRangeRow } from '../../../../components/charts'
import { Button, Chip, LoadingRegion, ProtectedState, SkeletonText } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { calendarDay } from '../../../../lib/calendarDay'
import { dimensionLabel } from '../../../surveys/dimensionLabel'
import SemaforoChip from '../../../tracking/components/SemaforoChip'
import { InfoBox, NodoTile } from '../../../tracking/next/parts'
import { fullDay } from '../../../tracking/next/derive'
import { planCalendarDay } from '../../../tracking/planDates'
import DashboardExportMenu from '../DashboardExportMenu'
import { percentReading, reading, signedReading } from '../derive'
import { TEAM_DECIMALS, dimensionBand, dimensionMove } from './compose'
import { count, daysNote } from './format'
import type { LeaderDashboardModel, TeamClosedWave, TeamOpenSurvey, TeamPlan } from './model'
import { HatchedCount, TeamCard, TeamPlanRow } from './parts'

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
 * - **A sub-floor count.** The open survey's team count is `null` under the floor — on the
 *   wire (`DashboardEndpoints.DepartmentCountFloor`) and again in the model — so the row can
 *   only draw "menos de {floor} respuestas", and the file behind "Exportar" holds it to the same
 *   floor (`DashboardExport.TeamCountFloor`). The whole company's count under the list is held
 *   to it too: beside a hatched team count, "toda la empresa: 3" would say the team has at
 *   most 3.
 * - **The organisation's side where the server withholds it.** The org. bar and the move
 *   come from the same read's `climate.organization`, the whole company's reading of the same
 *   survey. When fewer than the floor answered outside the team the server sends none — the
 *   two readings side by side would give theirs away — and the legend says the organisation
 *   is not compared, with no number.
 * - **A control the server would refuse.** "Exportar" is the department's file
 *   (`canExport` for a team role, `DashboardEndpoints.cs:124`). "Crear plan" is offered only
 *   where a tracking plan can be created for this team — a node leader on their own nodo,
 *   `Roles.PlanCreator` in the tracking service (`leadsANodo`) — and lands on the tracking
 *   module's create form (`/tracking/planes`); "Abrir el plan" only on
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
      <PageHeader
        eyebrow={`${model.departmentName} · ${t('users.leader')}`}
        // Named as the rail's "Mi equipo" and the TeamHome board's "Su equipo" name it: the
        // admin's "Panel de control" did not say this page is one team's.
        title={t('dashboard.next.leader.title')}
        description={t('dashboard.next.leader.description')}
        actions={showExport ? <DashboardExportMenu subject={model.departmentName} scope="department" /> : undefined}
      />

      {/* `-mt-1`: the top bar leaves 24px under its rule; the artboard opens at 20px. */}
      <div data-slot="team-sections" className="-mt-1 flex flex-col gap-section">
        <section aria-labelledby="team-where" className="flex flex-col gap-2.5">
          <h2 id="team-where" className="m-0 text-2xl font-semibold">
            {t('dashboard.next.leader.whereHeading')}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <NodoTile label={t('dashboard.next.leader.membersLabel')}>
              <span className="text-kpi-hero leading-none font-semibold tabular-nums">{count(model.activeMemberCount, locale)}</span>
              <span className="text-sm text-fg-tertiary">{t('dashboard.next.leader.membersActive')}</span>
              {model.memberCount !== model.activeMemberCount && (
                <span className="text-sm text-fg-tertiary">
                  {t('dashboard.next.leader.membersOfTotal', { total: count(model.memberCount, locale) })}
                </span>
              )}
            </NodoTile>
            <ResponsesTile wave={model.closedWave} t={t} locale={locale} />
            <OpenSurveysTile surveys={model.openSurveys} total={model.openSurveyCount} t={t} locale={locale} />
          </div>
        </section>

        <CompareCard model={model} mayCreatePlan={mayCreatePlan} t={t} locale={locale} />

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
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
        <span className="text-kpi-hero leading-none font-semibold tabular-nums">—</span>
        <span className="text-sm text-fg-tertiary">{t('dashboard.next.leader.responsesNone')}</span>
      </NodoTile>
    )
  }
  // `null` when the payload's end date is still ahead of the reader (`compose.teamClosedWave`):
  // the tile then says nothing about when the survey closed rather than something untrue.
  const date = wave.closedOn ? calendarDay(Date.parse(wave.closedOn), locale) : null
  return (
    <NodoTile label={t('dashboard.next.leader.responsesLabel', { wave: wave.code })}>
      {wave.respondents === null ? (
        <>
          <HatchedCount
            text={t('dashboard.next.leader.responsesWithheld', { floor: wave.floor })}
            label={t('dashboard.next.leader.responsesWithheldLabel', { floor: wave.floor })}
          />
          {date !== null && <span className="text-sm text-fg-tertiary">{t('dashboard.next.leader.closedOn', { date })}</span>}
        </>
      ) : (
        <>
          <span className="text-kpi-hero leading-none font-semibold tabular-nums">{count(wave.respondents, locale)}</span>
          <span className="text-sm text-fg-tertiary">
            {date !== null
              ? t('dashboard.next.leader.responsesUnit', { date })
              : t('dashboard.next.leader.responsesUnitNoDate')}
          </span>
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
      <span className="text-kpi-hero leading-none font-semibold tabular-nums">{count(total, locale)}</span>
      <span className="text-sm text-fg-tertiary">{openUnit(surveys, total, t, locale)}</span>
    </NodoTile>
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
  const surveyName = wave?.name ?? t('surveys.untitled')
  const meta = wave ? (
    <>
      <span>{surveyName}</span>
      {wave.respondents !== null && (
        <span>· {t('dashboard.next.leader.compareResponses', { count: count(wave.respondents, locale) })}</span>
      )}
    </>
  ) : undefined
  // The organisation's side is drawn only where the team's own reading is: half a
  // comparison would give the other half back. And not at all when the server withheld it.
  const orgShown = wave !== null && !wave.withheld && model.organizationRespondents !== null
  const rows: ClimateRangeRow[] = (wave?.dimensions ?? []).map((dimension) => {
    const label = dimensionLabel(dimension.key, t)
    const team = dimension.team
    const org = orgShown && team !== null ? dimension.organization : null
    const move = org === null ? null : dimensionMove({ ...dimension, organization: org }, model.bands.scale)
    return {
      key: dimension.key,
      label,
      mean: team,
      protected: team === null,
      comparison: org === null ? undefined : { label: t('dashboard.next.leader.orgName'), mean: org },
      // "Organización 3,8 · +0,2 frente a la org." — the move is the difference of the two
      // readings AS PRINTED (`dimensionMove`), at the decimal the bar prints.
      caption:
        org === null || move === null
          ? undefined
          : t('dashboard.next.leader.compareCaption', {
              org: reading(org, locale, TEAM_DECIMALS, model.bands.scale),
              move:
                move === 0
                  ? reading(0, locale, TEAM_DECIMALS, model.bands.scale)
                  : signedReading(move, locale, TEAM_DECIMALS, model.bands.scale),
            }),
    }
  })
  // Plans are offered for a reading outside the strength area, as before; the bar itself
  // stays quiet, so they are listed under it.
  const planWorthy = mayCreatePlan && wave !== null && !wave.surveyWithheld
    ? wave.dimensions.flatMap((dimension) => {
        const band = dimensionBand(dimension, model.bands)
        return band !== null && band !== 'strength' ? [{ key: dimension.key, band }] : []
      })
    : []

  return (
    <TeamCard id="team-compare" heading={t('dashboard.next.leader.compareHeading')} meta={meta}>
      {wave === null ? (
        <p className="m-0 text-sm text-fg-tertiary">{t('dashboard.next.leader.noClosedSurvey')}</p>
      ) : wave.surveyWithheld ? (
        <ProtectedState floor={wave.floor} />
      ) : (
        <>
          <p className="-mt-2 mb-0 text-sm text-fg-tertiary">
            {orgShown ? t('dashboard.next.leader.compareSub') : t('dashboard.next.leader.compareSubTeamOnly')}
          </p>
          <div data-slot="team-dimensions">
            <ClimateRangeBar rows={rows} bands={model.bands} floor={wave.floor} decimals={TEAM_DECIMALS} />
          </div>
        </>
      )}
      {wave !== null && (wave.withheld || wave.surveyWithheld) && (
        <p className="m-0 text-sm text-fg-tertiary">
          {wave.surveyWithheld
            ? t('dashboard.next.leader.surveyWithheld', { survey: surveyName, floor: wave.floor })
            : t('dashboard.next.leader.teamWithheld', { survey: surveyName, floor: wave.floor })}
        </p>
      )}
      {wave !== null && !wave.surveyWithheld && (
        <div data-slot="team-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-fg-tertiary">
          <span>
            {t('dashboard.next.leader.legendTeam', {
              department: model.departmentName,
              count: count(model.memberCount, locale),
            })}
          </span>
          {!wave.withheld &&
            (model.organizationRespondents !== null ? (
              <span>{t('dashboard.next.leader.legendOrg', { count: count(model.organizationRespondents, locale) })}</span>
            ) : (
              // The server withheld the organisation's side: fewer than the floor answered
              // outside the team. Said in words, with no number and no tick on the bars.
              <span data-slot="team-legend-org-withheld">
                {t('dashboard.next.leader.legendOrgWithheld', { floor: wave.floor })}
              </span>
            ))}
          {mayCreatePlan && !wave.withheld && (
            <span>{t('resultBands.leader.planRule', { band: bandName('strength', model.bands, t) })}</span>
          )}
        </div>
      )}
      {planWorthy.length > 0 && (
        <ul data-slot="team-plan-offers" className="m-0 flex list-none flex-col border-t border-line-default p-0">
          {planWorthy.map(({ key, band }) => {
            const name = dimensionLabel(key, t)
            return (
              <li
                key={key}
                data-slot="team-plan-offer"
                data-dimension={key}
                data-band={band}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-default py-2.5 last:border-b-0"
              >
                <span className="min-w-0 grow text-base text-fg-primary">{name}</span>
                <BandChip band={band} bands={model.bands} />
                <Button asChild variant="outline" size="canvas">
                  <Link to="/tracking/planes" aria-label={t('dashboard.next.leader.createPlanFor', { dimension: name })}>
                    <Plus aria-hidden="true" />
                    {t('dashboard.next.leader.createPlan')}
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </TeamCard>
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
        <p role="status" className="m-0 text-sm text-fg-tertiary">
          {t('dashboard.next.leader.plansFailedNoReason')}
        </p>
      )}
      {plans.source === 'refused' && (
        <p role="status" className="m-0 text-sm text-fg-tertiary">
          {t('dashboard.next.leader.plansRefused')}
        </p>
      )}
      {plans.source === 'counts' && <p className="m-0 text-sm text-fg-tertiary">{t('dashboard.next.leader.plansCountsOnly')}</p>}
      {plans.source === 'tracking' && plans.plans.length === 0 && (
        <p className="m-0 text-sm text-fg-tertiary">
          {t('resultBands.leader.plansNoneOpen', { band: bandName('strength', model.bands, t) })}
        </p>
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
          <span className="text-sm text-fg-tertiary">
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
            // A dash, like the box beside it, when this reader cannot name the person: a
            // leader has no directory (`TrackingPickerEndpoints.cs:19-21`). The sentence goes
            // under it, where the artboard sets the box's second line.
            value={plan.responsable.name ?? '—'}
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
        <p className="m-0 text-sm text-fg-tertiary">{t('dashboard.next.leader.participationNone')}</p>
      ) : (
        <>
          <p className="m-0 max-w-[70ch] text-sm text-fg-tertiary">
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
                  <span className="text-sm text-fg-tertiary">{closesLine(survey, t, locale)}</span>
                </div>
                {survey.responses === null ? (
                  <HatchedCount
                    text={t('dashboard.next.leader.participationUnderFloor', { floor: model.floor })}
                    label={t('dashboard.next.leader.participationUnderFloorLabel', { floor: model.floor })}
                  />
                ) : (
                  <span className="text-sm tabular-nums">
                    {t('dashboard.next.leader.participationCount', {
                      count: count(survey.responses, locale),
                      members: count(model.activeMemberCount, locale),
                    })}
                  </span>
                )}
                <span className="col-start-2 justify-self-end sm:col-start-3">
                  <Chip tone="live" label={t('dashboard.next.leader.surveyActive')} />
                </span>
              </li>
            ))}
          </ul>
          {first.company !== null && (
            <p data-slot="team-company-line" className="m-0 pt-1 text-sm text-fg-tertiary">
              {companyLine(first.company, model.floor, t, locale)}
            </p>
          )}
        </>
      )}
    </TeamCard>
  )
}

/**
 * "Toda la empresa: 3 de 24 respuestas." — the artboard's line under the list, for the survey
 * the card is headed by. The count is held to the floor like the team's, in words: under it,
 * "menos de {floor}". No "Recordar al equipo" beside it: `POST /surveys/{id}/invitations/reminders`
 * is `CanAdminister` (`SurveyDistributionEndpoints.cs:131`, `:1121`), and a button that 403s
 * is worse than none.
 */
function companyLine(
  company: { responses: number | null; target: number | null },
  floor: number,
  t: TranslateFn,
  locale: string,
): string {
  if (company.responses === null) {
    return company.target === null
      ? t('dashboard.next.leader.companyUnderFloorNoTarget', { floor })
      : t('dashboard.next.leader.companyUnderFloor', { floor, target: count(company.target, locale) })
  }
  return company.target === null
    ? t('dashboard.next.leader.companyCountNoTarget', { count: count(company.responses, locale) })
    : t('dashboard.next.leader.companyCount', {
        count: count(company.responses, locale),
        target: count(company.target, locale),
      })
}
