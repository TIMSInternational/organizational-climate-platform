import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ArrowRight, Clock, FileText, Plus, Send, Waves } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { ANONYMITY_FLOOR, ClimateMap, KpiTile } from '../../../components/charts'
import { Button, Chip, LoadingRegion, SkeletonText } from '../../../components/ui'
import { useViewerCapabilities, type ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow, SectionHeading } from '../components/dashboardGrammar'
import { MAP_DEAD_BAND_AT, MAP_EXTREME_AT, printedReading } from './compose'
import type { AdminDashboardModel, AttentionItem, DimensionSeries, RegionKey, RegionStatuses, Wave } from './model'
import {
  closedWaveCount,
  daysBetween,
  isBelowTarget,
  latestAverage,
  lowestCell,
  nextWaveCode,
  percent,
  percentReading,
  previousAverage,
  protectedRows,
  reading,
  risesInARow,
  signedReading,
} from './derive'
import TrendSparkline from './TrendSparkline'
import CycleTimeline, { type CycleStep } from './CycleTimeline'
import DashboardExportMenu from './DashboardExportMenu'

/** The target rule's hex, as the sparklines draw it, for the legend's swatch. */
const TARGET_RULE = '#b9b6cc'

/**
 * The body of the redesigned Panel de Control, drawn as the Dashboard artboard (10 Sep):
 * header → where the organisation stands (four tiles) → what moved (six small
 * multiples) beside the map by group → what needs attention beside the cycle.
 *
 * It takes the model as a prop and makes no request: `DashboardPage` hands it
 * `useAdminDashboardModel()`, which composes it from the existing clients region by
 * region (`compose.ts`). `regions` says which of them fell back to the sample; each
 * section names its own in a sentence, beside the chip in the top bar. The
 * same rules as `CompanyAdminDashboardView` hold — every reading is
 * `font-mono tabular-nums`, prose stays sans; a withheld row is drawn hatched,
 * never dropped, and never prints a number (`ClimateMap` with `threshold` at the
 * floor); and no colour carries a change alone — every move carries its sign.
 *
 * `companyId` is the SuperAdmin's chosen tenant, for the export; a CompanyAdmin's
 * scope is the claim's and it stays `undefined`.
 */
export default function AdminDashboardNextView({
  model,
  regions,
  companyId,
}: {
  model: AdminDashboardModel
  regions?: RegionStatuses
  companyId?: string
}) {
  const { t, locale } = useTranslation()
  // Every action below shows only when the server would answer it with something other
  // than 403 — see `auth/viewerCapabilities.ts` for the rule each one mirrors.
  const capabilities = useViewerCapabilities()
  // `/dashboard/company-admin/export` is the whole company's file: an admin with a
  // company. `canExport` alone also admits a leader, whose export is the department's
  // (`DashboardEndpoints.cs:124`) and whose dashboard is not this one.
  const showExport = capabilities.canExport && capabilities.seesWholeCompany
  const { target } = model
  const latest = latestAverage(model)
  const previous = previousAverage(model)
  const move = latest !== null && previous !== null ? latest - previous : null
  const rises = risesInARow(model)
  const withheld = protectedRows(model, ANONYMITY_FLOOR)
  const completion = percent(model.participation.completed, model.participation.responses)
  const open = model.openSurvey
  const openProgress = open ? percent(open.responses, open.audience) : null
  const waveCodes = model.waves.filter((wave) => wave.status === 'closed').map((wave) => wave.code)
  const dimensionName = (key: string) =>
    model.dimensions.find((dimension) => dimension.key === key)?.name ?? key
  // Highest latest reading first, as the canvas orders them: what is under the target
  // gathers at the end of the grid. Ties keep the server's column order.
  const ordered = [...model.dimensions].sort(
    (a, b) => (b.values[b.values.length - 1] ?? -Infinity) - (a.values[a.values.length - 1] ?? -Infinity),
  )
  // One range for all six sparklines, so their slopes are on one scale.
  const every = model.dimensions.flatMap((dimension) => dimension.values)
  const domain: readonly [number, number] = [Math.min(...every, target) - 0.25, Math.max(...every, target) + 0.25]
  const steps = cycleSteps(model.waves, t, locale)

  return (
    <div>
      <PageTopBar
        eyebrow={model.companyName}
        title={t('dashboard.next.title')}
        description={t('dashboard.next.description')}
        // The one honest marker on a screen fed by a sample: nobody may read these
        // numbers as measurements while `isSample` holds.
        badge={model.isSample ? { text: t('dashboard.next.sampleChip'), variant: 'warning' } : undefined}
        actions={
          showExport || capabilities.canLaunchMicroclimate || capabilities.canAuthorSurveys ? (
            <>
              {showExport && <DashboardExportMenu subject={model.companyName} companyId={companyId} />}
              {capabilities.canLaunchMicroclimate && (
                <Button asChild variant="outline">
                  <Link to="/microclimates/new">
                    <Waves aria-hidden="true" />
                    {t('dashboard.next.launchMicroclimate')}
                  </Link>
                </Button>
              )}
              {capabilities.canAuthorSurveys && (
                <Button asChild variant="primary">
                  <Link to="/surveys/new">
                    <Plus aria-hidden="true" />
                    {t('dashboard.next.newSurvey')}
                  </Link>
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-section">
        <section aria-labelledby="next-where">
          <SectionHeading>
            <span id="next-where">{t('dashboard.next.whereHeading')}</span>
          </SectionHeading>
          <RegionNotice regions={regions} region="company" t={t} />
          <KpiRow>
            <KpiTile
              label={t('dashboard.next.climateLabel', { wave: model.latestClosedWave.code })}
              value={latest}
              format={{ kind: 'number', decimals: 2 }}
              unit={t('dashboard.next.climateSub', { target: reading(target, locale) })}
              locale={locale}
              sub={
                move !== null && model.previousWave ? (
                  // The sign is in the reading, so the colour is a second channel.
                  <span data-slot="climate-move" className={move >= 0 ? 'text-accent-green-ink' : 'text-accent-red-ink'}>
                    <span className="font-mono tabular-nums">{signedReading(move, locale, 2)}</span>{' '}
                    {t('dashboard.next.climateVs', { wave: model.previousWave.code })}
                    {rises >= 2 && <> · {t('dashboard.next.risesInARow', { count: rises })}</>}
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              label={t('dashboard.next.participationLabel', { wave: model.latestClosedWave.code })}
              value={model.participation.responses}
              unit={t('dashboard.next.participationSub', {
                percent: completion === null ? '—' : percentReading(completion, locale),
              })}
              locale={locale}
              sub={
                withheld.length > 0 ? (
                  <span className="flex flex-col">
                    {withheld.map((row) => (
                      <span key={row.departmentId}>
                        {t('dashboard.next.participationProtected', { group: row.name, floor: ANONYMITY_FLOOR })}
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              label={t('dashboard.next.openSurveyLabel', { wave: open?.code ?? '—' })}
              value={open ? open.responses : null}
              unit={
                open
                  ? t('dashboard.next.openSurveySub', {
                      audience: open.audience,
                      date: calendarDay(Date.parse(open.closesAt), locale),
                    })
                  : undefined
              }
              locale={locale}
              sub={
                open ? (
                  <span
                    role="progressbar"
                    aria-label={t('dashboard.next.openSurveyProgress', {
                      responses: open.responses,
                      audience: open.audience,
                    })}
                    aria-valuemin={0}
                    aria-valuemax={open.audience}
                    aria-valuenow={open.responses}
                    className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-icon-box"
                  >
                    <span
                      className="block h-full rounded-full bg-accent-blue"
                      style={{ width: `${Math.max(openProgress ?? 0, 2)}%` }}
                    />
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              label={t('dashboard.next.plansLabel')}
              value={model.plans.open}
              unit={t('dashboard.next.plansOpen')}
              locale={locale}
              sub={
                model.plans.overdue > 0 ? (
                  <span className="flex items-center gap-1.5 text-accent-red-ink">
                    <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>
                      <span className="font-mono tabular-nums">{model.plans.overdue}</span>{' '}
                      {t(
                        model.plans.overdue === 1 ? 'dashboard.next.plansOverdueOne' : 'dashboard.next.plansOverdueMany',
                        { nodo: model.plans.overdueNodo ?? '—' },
                      )}
                    </span>
                  </span>
                ) : undefined
              }
            />
          </KpiRow>
        </section>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <section
            aria-labelledby="next-moved"
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-xs xl:col-span-7"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="next-moved" className="m-0 text-2xl">
                {t('dashboard.next.movedHeading')}
              </h2>
              <span className="inline-flex items-center gap-2 text-sm text-fg-label">
                <svg aria-hidden="true" width="18" height="2" viewBox="0 0 18 2" className="shrink-0">
                  <line x1="0" x2="18" y1="1" y2="1" stroke={TARGET_RULE} strokeDasharray="3 2" />
                </svg>
                {t('dashboard.next.movedLegend', {
                  target: reading(target, locale),
                  count: closedWaveCount(model),
                })}
              </span>
            </div>
            <RegionNotice regions={regions} region="trends" t={t} />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {ordered.map((dimension) => (
                <SparkCard
                  key={dimension.key}
                  dimension={dimension}
                  target={target}
                  labels={waveCodes}
                  domain={domain}
                  t={t}
                  locale={locale}
                />
              ))}
            </div>
          </section>

          <section
            aria-labelledby="next-by-group"
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-xs xl:col-span-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="next-by-group" className="m-0 text-2xl">
                {t('dashboard.next.byGroupHeading', { wave: model.latestClosedWave.code })}
              </h2>
              {/* `GET /surveys/{id}/results` is `CanAdminister` (`SurveyResultsEndpoints.cs:199`):
                  an admin with a company, for any survey of the scoped tenant. */}
              {capabilities.seesWholeCompany && (
                <Link
                  to={`/surveys/${model.latestClosedWave.id}/results`}
                  className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
                >
                  {t('dashboard.next.openResults')}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              )}
            </div>
            <RegionNotice regions={regions} region="map" t={t} />
            <div className="overflow-x-auto">
              <ClimateMap
                // Short column heads, full name on hover and for AT: measured at 1440, six
                // full names made the grid wider than its panel and clipped two columns.
                dimensions={model.map.dimensionKeys.map((key) => ({
                  key,
                  label: shortLabel(dimensionName(key)),
                  fullLabel: dimensionName(key),
                }))}
                rows={model.map.rows.map((row) => ({
                  id: row.departmentId,
                  label: row.name,
                  responses: row.responses,
                  // The reading each cell PRINTS, so its tint and its "above / below"
                  // agree with the number on it (`MAP_DEAD_BAND_AT`).
                  scores: row.scores.map(printedReading),
                }))}
                target={target}
                deadBandAt={MAP_DEAD_BAND_AT}
                extremeAt={MAP_EXTREME_AT}
                decimals={1}
                // The floor, and never lower: a row under it is hatched and prints nothing.
                threshold={ANONYMITY_FLOOR}
              />
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <section aria-labelledby="next-attention" className="flex min-w-0 flex-col gap-2.5 xl:col-span-7">
            <h2 id="next-attention" className="m-0 text-2xl">
              {t('dashboard.next.attentionHeading')}
            </h2>
            <RegionNotice regions={regions} region="actionPlans" t={t} />
            <RegionNotice regions={regions} region="tracking" t={t} />
            <ul
              data-slot="attention-list"
              className="m-0 list-none divide-y divide-line-light rounded-lg border border-line-default bg-surface-card p-0 shadow-xs"
            >
              {model.attention.map((item, index) => (
                <AttentionRow
                  key={index}
                  item={item}
                  model={model}
                  t={t}
                  locale={locale}
                  capabilities={capabilities}
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="next-cycle" className="flex min-w-0 flex-col gap-2.5 xl:col-span-5">
            <h2 id="next-cycle" className="m-0 text-2xl">
              {t('dashboard.next.cycleHeading')}
            </h2>
            <RegionNotice regions={regions} region="surveys" t={t} />
            <div className="flex flex-col gap-3.5 rounded-lg border border-line-default bg-surface-card px-5 pt-4.5 pb-4 shadow-xs">
              <CycleTimeline steps={steps} label={t('dashboard.next.cycleLabel')} />
              <p className="m-0 flex items-center gap-2.5 rounded-md bg-surface-outer px-3 py-2.5 text-sm text-fg-secondary">
                <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                <span>{t('dashboard.next.cycleNote')}</span>
              </p>
            </div>
            <RegionNotice regions={regions} region="microclimates" t={t} />
            {model.liveMicroclimate && (
              <div
                data-slot="live-microclimate"
                className="flex items-center justify-between gap-3 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold text-fg-primary">
                    {t('dashboard.next.liveTitle', { name: model.liveMicroclimate.name })}
                  </span>
                  <span className="text-sm text-fg-label">
                    <span className="font-mono tabular-nums">{model.liveMicroclimate.responses}</span>{' '}
                    {t('dashboard.next.liveSub', {
                      date: calendarDay(Date.parse(model.liveMicroclimate.closesAt), locale),
                      floor: ANONYMITY_FLOOR,
                    })}
                  </span>
                </div>
                {/* The live page loads `GET /microclimates/{id}/live-results`, which is
                    `CanAccessCompany` (`MicroclimateEndpoints.cs:1420`): the same admin-with-a-company. */}
                {capabilities.seesWholeCompany && (
                  <Link
                    to={`/microclimates/${model.liveMicroclimate.id}/live`}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-fg-secondary hover:text-fg-primary"
                  >
                    {t('dashboard.next.viewSession')}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/** One dimension's card in "Qué se movió": its name, its latest reading and move, its sparkline. */
function SparkCard({
  dimension,
  target,
  labels,
  domain,
  t,
  locale,
}: {
  dimension: DimensionSeries
  target: number
  labels: readonly string[]
  domain: readonly [number, number]
  t: TranslateFn
  locale: string
}) {
  const value = dimension.values[dimension.values.length - 1]
  const before = dimension.values[dimension.values.length - 2]
  if (value === undefined) return null
  const below = isBelowTarget(value, target)
  return (
    <div
      data-slot="trend-card"
      data-dimension={dimension.key}
      data-below-target={below ? 'true' : 'false'}
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line-light px-3.5 pt-3 pb-2.5"
    >
      <div className="truncate text-sm text-fg-secondary">{dimension.name}</div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-2xl leading-none tabular-nums text-fg-primary">{reading(value, locale)}</span>
        {before !== undefined && (
          <span
            className={cn(
              'font-mono text-sm tabular-nums',
              value >= before ? 'text-accent-green-ink' : 'text-accent-red-ink',
            )}
          >
            {signedReading(value - before, locale)}
          </span>
        )}
        {below && <Chip tone="critical" label={t('dashboard.next.belowTarget')} className="h-4.5 px-1.5 text-2xs" />}
      </div>
      <TrendSparkline
        values={dimension.values}
        target={target}
        labels={labels}
        domain={domain}
        label={t('dashboard.next.sparklineLabel', {
          dimension: dimension.name,
          values: dimension.values.map((v) => reading(v, locale)).join(' → '),
          target: reading(target, locale),
        })}
      />
    </div>
  )
}

/** The first letters of a column head; the full name rides on `fullLabel`. */
function shortLabel(name: string): string {
  return name.length > 6 ? `${name.slice(0, 5)}…` : name
}

/**
 * The rail: one step per wave, its code and its date, the full sentence for AT — and,
 * when nothing is planned after the open wave, the next slot of a quarterly cycle as a
 * hollow "por planificar" step (`nextWaveCode`), which names a slot and claims no survey.
 */
function cycleSteps(waves: readonly Wave[], t: TranslateFn, locale: string): CycleStep[] {
  const steps = waves.map((wave): CycleStep => {
    if (wave.status === 'closed' && wave.closedAt) {
      const date = calendarDay(Date.parse(wave.closedAt), locale)
      return { id: wave.id, code: wave.code, detail: date, srDetail: t('dashboard.next.waveClosed', { date }), status: 'closed' }
    }
    if (wave.status === 'open' && wave.closesAt) {
      const date = calendarDay(Date.parse(wave.closesAt), locale)
      return {
        id: wave.id,
        code: t('dashboard.next.waveOpenShort', { code: wave.code }),
        detail: date,
        srDetail: t('dashboard.next.waveCloses', { date }),
        status: 'open',
      }
    }
    return { id: wave.id, code: wave.code, detail: t('dashboard.next.wavePlanned'), status: wave.status }
  })
  const last = waves[waves.length - 1]
  if (last && !waves.some((wave) => wave.status === 'planned')) {
    const code = nextWaveCode(last.code, last.closesAt ?? last.closedAt)
    if (code) steps.push({ id: 'next-wave', code, detail: t('dashboard.next.wavePlanned'), status: 'planned' })
  }
  return steps
}

/** "20 de agosto": a due date in the reader's own words, as the canvas writes it. */
function longDay(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'long' })
}

/**
 * The substitution marker `MonoReadings` uses, for the same reason: no sentence in
 * either catalogue contains it, so a placeholder can be swapped for an element
 * after the catalogue has ordered the sentence.
 */
const MARK = '␟'

type RichParam = string | number | { strong: string } | { mono: string }

/**
 * A translated sentence with some of its parameters set as elements: `{ strong }`
 * for the entity the line is about, `{ mono }` for a reading. The catalogue orders
 * the sentence; the markers are swapped back afterwards.
 */
function RichLine({
  t,
  messageKey,
  params,
}: {
  t: TranslateFn
  messageKey: string
  params: Record<string, RichParam>
}) {
  const pieces: ReactNode[] = []
  const marked: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'object') {
      marked[name] = `${MARK}${pieces.length}${MARK}`
      pieces.push(
        'strong' in value ? (
          <strong className="font-semibold text-fg-primary">{value.strong}</strong>
        ) : (
          <span className="font-mono tabular-nums">{value.mono}</span>
        ),
      )
    } else {
      marked[name] = value
    }
  }
  return (
    <span>
      {t(messageKey, marked)
        .split(MARK)
        .map((piece, index) =>
          index % 2 === 1 ? <span key={index}>{pieces[Number(piece)]}</span> : piece,
        )}
    </span>
  )
}

function AttentionRow({
  item,
  model,
  t,
  locale,
  capabilities,
}: {
  item: AttentionItem
  model: AdminDashboardModel
  t: TranslateFn
  locale: string
  capabilities: ViewerCapabilities
}) {
  const progressOf = (progress: number) =>
    progress === 0 ? t('dashboard.next.noProgress') : percentReading(progress, locale)

  if (item.kind === 'lowest-cell') {
    const cell = lowestCell(model, ANONYMITY_FLOOR)
    if (!cell) return null
    const dimension = model.dimensions.find((d) => d.key === cell.dimensionKey)?.name ?? cell.dimensionKey
    return (
      <AttentionItemRow
        icon={<AlertCircle aria-hidden="true" className="size-4" />}
        tone="critical"
        headline={
          <RichLine
            t={t}
            messageKey="dashboard.next.lowestCellHeadline"
            params={{
              department: { strong: cell.row.name },
              dimension: dimension.toLocaleLowerCase(locale),
              score: { mono: reading(cell.score, locale) },
            }}
          />
        }
        detail={
          item.plan
            ? t('dashboard.next.lowestCellPlanSub', {
                plan: item.plan.name,
                progress: progressOf(item.plan.progress),
              })
            : t('dashboard.next.lowestCellNoPlanSub')
        }
        // Reading an action plan is `CanAccessCompany` (`ActionPlanEndpoints.cs:276-279`):
        // the whole-company viewer, and nobody else. Creating one is `canCreateActionPlan`.
        action={
          item.plan
            ? capabilities.seesWholeCompany
              ? { label: t('dashboard.next.openPlan'), href: `/action-plans/${item.plan.id}` }
              : undefined
            : capabilities.canCreateActionPlan
              ? { label: t('dashboard.next.createPlan'), href: '/action-plans' }
              : undefined
        }
      />
    )
  }

  if (item.kind === 'overdue-plan') {
    return (
      <AttentionItemRow
        icon={<Clock aria-hidden="true" className="size-4" />}
        tone="critical"
        headline={
          <RichLine
            t={t}
            messageKey="dashboard.next.overduePlanHeadline"
            params={{ nodo: { strong: item.nodo }, plan: item.plan.name }}
          />
        }
        detail={t('dashboard.next.overduePlanSub', {
          date: item.plan.dueAt ? longDay(item.plan.dueAt, locale) : '—',
          owner: item.plan.owner ?? '—',
          // The tracking plan's own `porcentajeAvance`, printed as the percentage it is.
          progress: percentReading(item.plan.progress, locale),
        })}
        // `avance` is the node leader's or an admin's (`PlanAccessHandler`); a plan the
        // model knows no node for is offered to admins only, never widened.
        action={
          capabilities.canRecordProgress({ nodoExternalId: item.plan.nodoExternalId ?? '' })
            ? { label: t('dashboard.next.logProgress'), href: `/tracking/planes/${item.plan.id}` }
            : undefined
        }
      />
    )
  }

  const survey = model.openSurvey
  if (!survey || survey.id !== item.surveyId) return null
  const previousRate = percent(model.participation.completed, model.participation.responses)
  return (
    <AttentionItemRow
      icon={<Send aria-hidden="true" className="size-4" />}
      tone="warning"
      headline={
        <RichLine
          t={t}
          messageKey="dashboard.next.lowParticipationHeadline"
          params={{
            survey: { strong: survey.name },
            responses: { mono: survey.responses.toLocaleString(locale) },
            audience: { mono: survey.audience.toLocaleString(locale) },
            days: { mono: daysBetween(model.asOf, survey.closesAt).toLocaleString(locale) },
          }}
        />
      }
      detail={t(
        item.remindersSent === null
          ? 'dashboard.next.lowParticipationSubUnknown'
          : item.remindersSent === 0
            ? 'dashboard.next.lowParticipationSubNoReminder'
            : 'dashboard.next.lowParticipationSubReminders',
        {
          wave: model.latestClosedWave.code,
          percent: previousRate === null ? '—' : percentReading(previousRate, locale),
          count: item.remindersSent ?? 0,
        },
      )}
      // A reminder is a distribution write on the survey, gated like authoring it.
      action={
        capabilities.canAuthorSurveys
          ? { label: t('dashboard.next.sendReminder'), href: `/surveys/${survey.id}/distribution` }
          : undefined
      }
    />
  )
}

function AttentionItemRow({
  icon,
  tone,
  headline,
  detail,
  action,
}: {
  icon: ReactNode
  tone: 'critical' | 'warning'
  headline: ReactNode
  detail: string
  /** Absent when the viewer may not take it: the row still informs, it just offers nothing. */
  action?: { label: string; href: string }
}) {
  return (
    <li data-slot="attention-item" className="flex items-center gap-3 px-4 py-3.5">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md',
          tone === 'critical'
            ? 'bg-accent-red-soft text-accent-red'
            : 'bg-accent-amber-soft text-accent-amber-ink',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-base text-fg-primary">{headline}</div>
        <div className="text-sm text-fg-label">{detail}</div>
      </div>
      {action && (
        <Button asChild variant="outline" className="shrink-0">
          <Link to={action.href}>{action.label}</Link>
        </Button>
      )}
    </li>
  )
}

const REGION_NAME_KEYS: Record<RegionKey, string> = {
  company: 'dashboard.next.regionCompany',
  surveys: 'dashboard.next.regionSurveys',
  trends: 'dashboard.next.regionTrends',
  map: 'dashboard.next.regionMap',
  actionPlans: 'dashboard.next.regionActionPlans',
  tracking: 'dashboard.next.regionTracking',
  microclimates: 'dashboard.next.regionMicroclimates',
}

/**
 * The honest sentence a section carries when its region is the sample: which region,
 * and the server's own reason when it gave one. Drawn nowhere otherwise — a live
 * region says nothing, and neither does a deployment with no tracking service.
 */
function RegionNotice({
  regions,
  region,
  t,
}: {
  regions: RegionStatuses | undefined
  region: RegionKey
  t: TranslateFn
}) {
  const state = regions?.[region]
  if (!state || state.status !== 'fallback') return null
  const name = t(REGION_NAME_KEYS[region])
  return (
    <p
      data-slot="region-fallback"
      data-region={region}
      role="status"
      className="m-0 mb-inline rounded-md bg-accent-amber-soft px-3 py-2 text-xs text-accent-amber-ink"
    >
      {state.reason === 'empty'
        ? t('dashboard.next.fallbackEmpty', { region: name })
        : t('dashboard.next.fallbackRegion', {
            region: name,
            error: state.error ?? t('dashboard.next.fallbackNoReason'),
          })}
    </p>
  )
}

const SECTION_REGIONS: readonly { id: string; headingKey: string; region: RegionKey }[] = [
  { id: 'next-where', headingKey: 'dashboard.next.whereHeading', region: 'company' },
  { id: 'next-moved', headingKey: 'dashboard.next.movedHeading', region: 'trends' },
  { id: 'next-attention', headingKey: 'dashboard.next.attentionHeading', region: 'actionPlans' },
  { id: 'next-cycle', headingKey: 'dashboard.next.cycleHeading', region: 'surveys' },
]

/**
 * The page while its regions load: the same top bar and section headings, each section
 * a skeleton announced by name, so the wait reads as the page arriving and not as an
 * empty one. Rendered by `DashboardPage` until `useAdminDashboardModel` has a model.
 */
export function AdminDashboardNextSkeleton() {
  const { t } = useTranslation()
  return (
    <div>
      <PageTopBar title={t('dashboard.next.title')} description={t('dashboard.next.description')} />
      <div className="flex flex-col gap-section">
        {SECTION_REGIONS.map((section) => (
          <section key={section.id} aria-labelledby={section.id}>
            <SectionHeading>
              <span id={section.id}>{t(section.headingKey)}</span>
            </SectionHeading>
            <LoadingRegion
              loading
              label={t('dashboard.next.loadingRegion', { region: t(REGION_NAME_KEYS[section.region]) })}
            >
              <SkeletonText lines={3} />
            </LoadingRegion>
          </section>
        ))}
      </div>
    </div>
  )
}
