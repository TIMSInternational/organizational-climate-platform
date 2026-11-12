import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ArrowRight, Clock, FileText, Info, Plus, Send, Waves } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
import {
  ANONYMITY_FLOOR,
  SINGLE_SEGMENT_FLOOR,
  BandChip,
  ClimateMap,
  ClimateRangeBar,
  KpiTile,
  bandOf,
  boundaryText,
  scaleUnitText,
  scoreText,
  isSuppressed,
  type ClimateRangeRow,
  type ResultBands,
} from '../../../components/charts'
import { Button, Chip, LoadingRegion, Note, SkeletonText } from '../../../components/ui'
import { useViewerCapabilities, type ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay, instantDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow } from '../components/dashboardGrammar'
import { Eyebrow, PopulationGrid } from '../../../components/signal/SignalPrimitives'
import type { AdminDashboardModel, AttentionItem, DimensionSeries, FailureCause, RegionKey, RegionStatuses, Wave } from './model'
import {
  closedWaveCount,
  daysBetween,
  latestAverage,
  lowestCell,
  nameHead,
  nextWaveCode,
  percent,
  percentReading,
  previousAverage,
  printedMove,
  protectedRows,
  reading,
  risesInARow,
  sentenceName,
  signedReading,
} from './derive'
import TrendSparkline from './TrendSparkline'
import CycleTimeline, { type CycleStep } from './CycleTimeline'
import DashboardExportMenu from './DashboardExportMenu'
import { actionPlansOffered } from '../../action-plans/offered'

/** The target rule's hex, as the sparklines draw it, for the legend's swatch. */
/** The band-boundary rule's ink, as the sparklines draw it, for the legend's swatch. */
const BOUNDARY_RULE = 'var(--admin-line-control)'

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
 * set in tabular figures of the sans face, prose too; a withheld row is drawn hatched,
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
  const { bands } = model
  const floor = model.minimumGroupSize ?? SINGLE_SEGMENT_FLOOR
  const latest = latestAverage(model)
  const previous = previousAverage(model)
  // The move between the two averages AS the tile prints them, at two decimals.
  const move = latest !== null && previous !== null ? printedMove(latest, previous, 2, model.bands.scale) : null
  const rises = risesInARow(model)
  const withheld = protectedRows(model, floor)
  // The two halves come from different regions (trends and surveys), so a completion
  // needs both; with either absent the tile prints a dash rather than a rate.
  const completion =
    model.participation.completed !== null && model.participation.responses !== null
      ? percent(model.participation.completed, model.participation.responses)
      : null
  const open = model.openSurvey
  const openProgress = open && open.audience !== null ? percent(open.responses, open.audience) : null
  const waveCodes = model.waves.filter((wave) => wave.status === 'closed').map((wave) => wave.code)
  const dimensionName = (key: string) =>
    model.dimensions.find((dimension) => dimension.key === key)?.name ?? key
  // Highest latest reading first, as the canvas orders them: the critical area gathers
  // at the end of the grid. Ties keep the server's column order.
  const ordered = [...model.dimensions].sort(
    (a, b) => (b.values[b.values.length - 1] ?? -Infinity) - (a.values[a.values.length - 1] ?? -Infinity),
  )
  // One range for all six sparklines, so their slopes are on one scale — wide enough to
  // hold both band boundaries, which every card draws.
  const every = model.dimensions.flatMap((dimension) => dimension.values)
  const domain: readonly [number, number] = [
    Math.min(...every, bands.opportunityMin) - 0.25,
    Math.max(...every, bands.strengthMin) + 0.25,
  ]
  const steps = cycleSteps(model.waves, t, locale)
  const wave = model.latestClosedWave
  const rangeRows = climateRangeRows(model, ordered, floor)
  // "Nothing needs your attention" only when every region an item comes from was read: with
  // one missing, an empty list is not the claim that nothing is wrong.
  const attentionComplete = (['actionPlans', 'tracking', 'surveys', 'map'] as const).every(
    (region) => regions?.[region]?.status !== 'fallback',
  )

  return (
    <div>
      <PageHeader
        eyebrow={[model.companyName, wave ? t('dashboard.next.eyebrowWave', { wave: wave.code }) : null].filter(Boolean).join(' · ') || undefined}
        title={t('dashboard.next.title')}
        description={t('dashboard.next.description')}
        // The one honest marker on a screen missing a section: nobody may read this page
        // as the whole picture while `isPartial` holds. It does NOT say the numbers are
        // invented — every number still on the page is this tenant's own measurement.
        // Grey, not amber: amber is the Oportunidad area and nothing else (ruling 11 Nov).
        titleAccessory={model.isPartial ? <Chip tone="neutral" icon={<Info aria-hidden="true" />} label={t('dashboard.next.unavailableChip')} /> : undefined}
        actions={
          showExport || capabilities.canLaunchMicroclimate ? (
            <>
              {/* The export is the server's own file and works whatever this page read; with
                  no company name it is named `dashboard-<day>` rather than after a tenant
                  nobody confirmed (`dashboardExportFileName`). */}
              {showExport && <DashboardExportMenu subject={model.companyName ?? ''} companyId={companyId} />}
              {capabilities.canLaunchMicroclimate && (
                <Button asChild variant="outline">
                  <Link to="/microclimates/new">
                    <Waves aria-hidden="true" />
                    {t('dashboard.next.launchMicroclimate')}
                  </Link>
                </Button>
              )}
            </>
          ) : undefined
        }
        primaryAction={
          capabilities.canAuthorSurveys ? (
            <Button asChild variant="primary">
              <Link to="/surveys/new">
                <Plus aria-hidden="true" />
                {t('dashboard.next.newSurvey')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* `-mt-1`: the header leaves the 24px section gap under its rule, and the board
          opens its first section at 20px. */}
      <div data-slot="dashboard-sections" className="-mt-1 flex flex-col gap-section">
        <section aria-labelledby="next-where" className="flex flex-col gap-3.5">
          <SectionHead id="next-where" heading={t('dashboard.next.whereHeading')} />
          <RegionNotice regions={regions} region="company" t={t} />
          <KpiRow>
            <KpiTile
              size="hero"
              label={wave ? t('dashboard.next.climateLabel', { wave: wave.code }) : t('dashboard.next.climateLabelNoWave')}
              value={latest}
              format={{ kind: 'number', decimals: 2 }}
              valueText={latest === null ? undefined : scoreText(latest, bands.scale, locale, 2)}
              unit={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {scaleUnitText(bands.scale, t)}
                  {/* Printed at two decimals, so judged at two. */}
                  {latest !== null && <BandChip band={bandOf(latest, bands, 2)} bands={bands} />}
                </span>
              }
              locale={locale}
              sub={
                move !== null && model.previousWave ? (
                  // The sign carries the direction. No green or red: those are result areas.
                  <span data-slot="climate-move" className="text-fg-secondary">
                    <span className="tabular-nums">{signedReading(move, locale, 2, bands.scale)}</span>{' '}
                    {t('dashboard.next.climateVs', { wave: model.previousWave.code })}
                    {rises >= 2 && <> · {risesPhrase(rises, t)}</>}
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              size="hero"
              label={wave ? t('dashboard.next.participationLabel', { wave: wave.code }) : t('dashboard.next.participationLabelNoWave')}
              value={model.participation.responses}
              unit={
                completion === null
                  ? t('dashboard.next.participationSubNoRate')
                  : t('dashboard.next.participationSub', { percent: percentReading(completion, locale) })
              }
              locale={locale}
              sub={
                withheld.length > 0 ? (
                  <span className="flex flex-col">
                    {withheld.map((row) => (
                      <span key={row.departmentId}>
                        {t('dashboard.next.participationProtected', { group: row.name, floor })}
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              size="hero"
              label={open ? t('dashboard.next.openSurveyLabel', { wave: open.code }) : t('dashboard.next.openSurveyLabelNone')}
              value={open ? open.responses : null}
              unit={
                open
                  ? open.audience === null
                    ? // A link-only survey has no audience to be "of": "15 de —" read as a
                      // missing number (EAGLE, 2026-10-12). Say what is counted instead.
                      t('dashboard.next.openSurveySubNoAudience', { date: calendarDay(Date.parse(open.closesAt), locale) })
                    : t('dashboard.next.openSurveySub', {
                        audience: open.audience.toLocaleString(locale),
                        date: calendarDay(Date.parse(open.closesAt), locale),
                      })
                  : undefined
              }
              locale={locale}
              sub={
                open && open.audience !== null ? (
                  <span
                    role="progressbar"
                    aria-label={t('dashboard.next.openSurveyProgress', {
                      responses: open.responses,
                      audience: open.audience,
                    })}
                    aria-valuemin={0}
                    aria-valuemax={open.audience}
                    aria-valuenow={open.responses}
                    className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-fill"
                  >
                    <span
                      className="block h-full rounded-full bg-accent-blue-fill"
                      style={{ width: `${Math.max(openProgress ?? 0, 2)}%` }}
                    />
                  </span>
                ) : undefined
              }
            />
            <KpiTile
              size="hero"
              label={t('dashboard.next.plansLabel')}
              value={model.plans?.open ?? null}
              unit={t('dashboard.next.plansOpen')}
              locale={locale}
              sub={
                model.plans && model.plans.overdue > 0 ? (
                  // Neutral ink with a clock and the word: overdue is a date, not a result area.
                  <span className="flex items-center gap-1.5 text-fg-secondary">
                    <Clock aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>
                      <span className="tabular-nums">{model.plans.overdue}</span>{' '}
                      {model.plans.overdueNodo
                        ? t(
                            model.plans.overdue === 1 ? 'dashboard.next.plansOverdueOne' : 'dashboard.next.plansOverdueMany',
                            { nodo: model.plans.overdueNodo },
                          )
                        : t(model.plans.overdue === 1 ? 'dashboard.next.plansOverdueOneBare' : 'dashboard.next.plansOverdueManyBare')}
                    </span>
                  </span>
                ) : undefined
              }
            />
          </KpiRow>
        </section>

        {/* One column, not seven-and-five. The map was drawn in a 5-of-12 panel — 425px at
            1440, 457px at the 1518 this was confirmed at on production — and six dimension
            names and five group names have never fitted in it at any window width, 2560
            included. Giving it the row makes the names a wrapping problem instead of a
            truncation one. */}
        <div className="flex flex-col gap-4">
          {/* The signature (Main and CompanyHome boards): one climate range bar per
              dimension — the stretch between the lowest and the highest DISCLOSED
              department, the dot at the organization's mean as served, the track in the
              company's own bands. A withheld department never enters a range. */}
          {rangeRows.length > 0 && (
            <section aria-labelledby="next-climate" data-slot="climate-by-dimension" className={CARD}>
              <SectionHead
                id="next-climate"
                heading={t('dashboard.next.climateHeading')}
                sub={wave ? t('dashboard.next.climateSubWave', { wave: wave.code }) : t('dashboard.next.climateSub')}
                action={
                  capabilities.seesWholeCompany && wave ? (
                    <ResultsLink to={`/surveys/${wave.id}/results`} label={t('dashboard.next.seeResults')} />
                  ) : undefined
                }
              />
              <ClimateRangeBar rows={rangeRows} bands={bands} floor={floor} />
            </section>
          )}

          <section aria-labelledby="next-moved" className={CARD}>
            <SectionHead
              id="next-moved"
              heading={t('dashboard.next.movedHeading')}
              // No legend over no series: "0 encuestas cerradas" described a chart not drawn.
              sub={
                closedWaveCount(model) === 0 ? undefined : (
                <span className="inline-flex items-center gap-2">
                  <svg aria-hidden="true" width="18" height="2" viewBox="0 0 18 2" className="shrink-0">
                    <line x1="0" x2="18" y1="1" y2="1" stroke={BOUNDARY_RULE} strokeDasharray="3 2" />
                  </svg>
                  {movedLegend(closedWaveCount(model), bands, t, locale)}
                </span>
                )
              }
            />
            <RegionNotice regions={regions} region="trends" t={t} />
            {ordered.length > 0 && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {ordered.map((dimension) => (
                  <SparkCard
                    key={dimension.key}
                    dimension={dimension}
                    bands={bands}
                    labels={waveCodes}
                    domain={domain}
                    t={t}
                    locale={locale}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="next-by-group" className={CARD}>
            {/* `GET /surveys/{id}/results` is `CanAdminister` (`SurveyResultsEndpoints.cs:199`):
                an admin with a company, for any survey of the scoped tenant. And: no wave,
                no link — there is no results page for a survey nobody read. */}
            <SectionHead
              id="next-by-group"
              heading={wave ? t('dashboard.next.byGroupHeading', { wave: wave.code }) : t('dashboard.next.byGroupHeadingNoWave')}
              action={
                capabilities.seesWholeCompany && wave ? (
                  <ResultsLink to={`/surveys/${wave.id}/results`} label={t('dashboard.next.openResults')} />
                ) : undefined
              }
            />
            <RegionNotice regions={regions} region="map" t={t} />
            {/* No rows, no grid. An empty ClimateMap is a set of headers promising a
                table that never arrives; the notice above has already said why. */}
            {model.map.rows.length > 0 && (
            // On a phone the grid is wider than its card and scrolls sideways. The fade on
            // the trailing edge and the line under it say so: a header cut mid-word at the
            // card's edge, with nothing beside it, read as a layout bug (review, 390).
            <div data-slot="map-scroll" className="relative">
            <div
              className="overflow-x-auto"
              // A region with a name, so a keyboard can reach it and scroll it.
              role="region"
              aria-label={t('dashboard.next.mapScrollLabel')}
              tabIndex={0}
            >
              <ClimateMap
                // The artboard's grid: whole names set small and cut by their column (the
                // full name on hover and for AT), the grouped legend, and no ring — the deep
                // red is the mark. Columns in the survey's question order
                // (`compose.ts` `questionOrderOf`), which is the artboard's order.
                variant="canvas"
                dimensions={model.map.dimensionKeys.map((key) => ({ key, label: dimensionName(key) }))}
                rows={model.map.rows.map((row) => ({
                  id: row.departmentId,
                  label: row.name,
                  responses: row.responses,
                  scores: row.scores,
                }))}
                // Something is disclosed, so the grid has a reading to draw; the colour is
                // the company's bands, judged at the printed decimal like every chip here.
                target={bands.opportunityMin}
                bands={bands}
                decimals={1}
                // The floor, and never lower: a row under it is hatched and prints nothing.
                threshold={floor}
              />
            </div>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-linear-to-l from-surface-card sm:hidden"
              />
              <p data-slot="map-scroll-hint" className="m-0 mt-2 text-sm text-fg-tertiary sm:hidden">
                {t('dashboard.next.mapScrollHint', { count: model.map.dimensionKeys.length })}
              </p>
            </div>
            )}
            {/* How many people are behind each row of the map above — the one thing the
                grid does not say. A group under the floor draws a fixed band and no
                count: `PopulationGrid` records why `n` dots would BE the count. */}
            {model.map.rows.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-line-default pt-3.5">
                <Eyebrow>{t('dashboard.next.whoAnsweredHeading')}</Eyebrow>
                <PopulationGrid
                  // Under `sm` the name column gives the dots room: at 390 its 16rem
                  // maximum left the dots a 10px column, one dot per line (review finding 4).
                  className="max-sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto]"
                  bands={model.map.rows.map((row) => ({
                    name: row.name,
                    responses: row.responses,
                    isProtected: isSuppressed(row.responses, floor),
                  }))}
                  // "Menos de 3", the words the leader's and supervisor's views and the
                  // TeamHome board print for a protected group; "protegido" said less.
                  protectedLabel={t('dashboard.next.protectedWord', { floor })}
                />
                <p className="m-0 text-sm text-fg-tertiary">
                  {t('dashboard.next.whoAnsweredNote', { floor })}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <section aria-labelledby="next-attention" className={cn(CARD_FLUSH, 'xl:col-span-7')}>
            <SectionHead
              id="next-attention"
              heading={t('dashboard.next.attentionHeading')}
              count={model.attention.length > 0 ? model.attention.length : undefined}
              className="px-5"
            />
            <div className="flex flex-col gap-2 px-5 empty:hidden">
              <RegionNotice regions={regions} region="actionPlans" t={t} />
              <RegionNotice regions={regions} region="tracking" t={t} />
            </div>
            {model.attention.length > 0 ? (
              <ul data-slot="attention-list" className="m-0 list-none divide-y divide-line-default p-0">
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
            ) : attentionComplete ? (
              <p className="m-0 px-5 pb-1 text-sm text-fg-tertiary">{t('dashboard.next.attentionNone')}</p>
            ) : null}
          </section>

          <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
            <section aria-labelledby="next-cycle" className={CARD}>
              <SectionHead id="next-cycle" heading={t('dashboard.next.cycleHeading')} />
              <RegionNotice regions={regions} region="surveys" t={t} />
              {/* Same rule as the map: no waves, no timeline — and no note about a cycle
                  nobody read. */}
              {steps.length > 0 && (
                <>
                  <CycleTimeline steps={steps} label={t('dashboard.next.cycleLabel')} />
                  <Note icon={<FileText />} className="text-sm">
                    {t('dashboard.next.cycleNote')}
                  </Note>
                </>
              )}
            </section>
            <RegionNotice regions={regions} region="microclimates" t={t} />
            {model.liveMicroclimate && (
              <div
                data-slot="live-microclimate"
                // On a phone the link drops under the name, so the name has the card's width:
                // beside it, two lines still cut the title to "How did this week's…" at 390.
                className="flex items-center justify-between gap-3 rounded-xl border border-line-panel bg-surface-card px-5 py-3.5 max-sm:flex-col max-sm:items-start"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  {/* The name's head, as the artboard's "Pulso semanal en vivo"; the whole
                      name, subtitle included, is the tooltip. */}
                  <span className="flex min-w-0 items-start gap-2">
                    <Chip tone="live" label={t('dashboard.next.liveChip')} className="mt-0.5 shrink-0" />
                    {/* Two lines before it cuts: one line left "How did thi…" at 390. */}
                    <span className="line-clamp-2 min-w-0 break-words text-base font-semibold text-fg-primary" title={model.liveMicroclimate.name}>
                      {t('dashboard.next.liveNamed', { name: nameHead(model.liveMicroclimate.name) })}
                    </span>
                  </span>
                  <span className="text-sm text-fg-tertiary">
                    <span className="tabular-nums">{model.liveMicroclimate.responses}</span>{' '}
                    {t('dashboard.next.liveSub', {
                      // An instant, not a calendar day: the minute the session stops
                      // taking answers, read where the reader is (`instantDay`).
                      date: instantDay(Date.parse(model.liveMicroclimate.closesAt), locale, { now: Date.parse(model.asOf) }),
                      floor: ANONYMITY_FLOOR,
                    })}
                  </span>
                </div>
                {/* The live page loads `GET /microclimates/{id}/live-results`, which is
                    `CanAccessCompany` (`MicroclimateEndpoints.cs:1420`): the same admin-with-a-company. */}
                {capabilities.seesWholeCompany && (
                  <ResultsLink to={`/microclimates/${model.liveMicroclimate.id}/live`} label={t('dashboard.next.viewSession')} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A bordered card in the box (spec `.card`): 12px radius, the panel hairline, no shadow. */
const CARD = 'flex min-w-0 flex-col gap-3.5 rounded-xl border border-line-panel bg-surface-card px-5 pt-4.5 pb-5'
/** The same card with its rows edge to edge (spec `.card.flush`). */
const CARD_FLUSH = 'flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-line-panel bg-surface-card pt-4.5 pb-2'

/**
 * A section's heading row, as the boards' `.ch`: the serif title (index.css sets every `h2`
 * in the display face), an optional count and secondary line, and one blue text action at
 * the end. The `h2` keeps its `id` because `aria-labelledby` and the tests point at it.
 */
function SectionHead({
  id,
  heading,
  sub,
  action,
  count,
  className,
}: {
  id: string
  heading: string
  sub?: ReactNode
  action?: ReactNode
  count?: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-1', className)}>
      <div className="flex min-w-0 grow basis-60 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h2 id={id} className="m-0 text-2xl font-semibold">
            {heading}
          </h2>
          {count !== undefined && <span className="text-sm text-fg-tertiary tabular-nums">{count}</span>}
        </div>
        {sub && <div className="text-sm text-fg-tertiary">{sub}</div>}
      </div>
      {action}
    </div>
  )
}

/** The boards' `.btn.t`: a blue text action with a chevron, 44px tall on touch. */
function ResultsLink({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild variant="plain" className="-mr-2 shrink-0">
      <Link to={to}>
        {label}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  )
}

/**
 * The climate range bar's rows, one per dimension in the trend cards' order (the two views
 * show the same data, so they read in one order — review finding 17).
 *
 * - **The dot** is the organization's own mean for the latest closed wave, as the trends
 *   endpoint served it — the same figure the climate tile averages. Never a mean of the
 *   groups below: those are partly withheld.
 * - **The range** is drawn over the map's departments for that wave. A row the map hatches
 *   (under the floor the server applied) arrives `protected` and never enters it; a row
 *   with no score for the dimension arrives with `mean: null`, which is not a 0.
 */
function climateRangeRows(
  model: AdminDashboardModel,
  ordered: readonly DimensionSeries[],
  floor: number,
): ClimateRangeRow[] {
  return ordered.flatMap((dimension) => {
    const mean = dimension.values[dimension.values.length - 1]
    if (mean === undefined) return []
    const column = model.map.dimensionKeys.indexOf(dimension.key)
    const groups =
      column < 0
        ? []
        : model.map.rows.map((row) => {
            const withheld = isSuppressed(row.responses, floor) || row.scores.length === 0
            return { name: row.name, mean: withheld ? null : (row.scores[column] ?? null), protected: withheld }
          })
    return [{ key: dimension.key, label: dimension.name, mean, groups }]
  })
}

/** The decimals a trend card prints its reading and move at: the climate range bar's. */
const SPARK_DECIMALS = 2

/** One dimension's card in "Qué se movió": its name, its latest reading and move, its sparkline. */
function SparkCard({
  dimension,
  bands,
  labels,
  domain,
  t,
  locale,
}: {
  dimension: DimensionSeries
  bands: ResultBands
  labels: readonly string[]
  domain: readonly [number, number]
  t: TranslateFn
  locale: string
}) {
  const value = dimension.values[dimension.values.length - 1]
  const before = dimension.values[dimension.values.length - 2]
  if (value === undefined) return null
  // Two decimals, as the climate range bar above and the climate tile print the same
  // reading: "Pertenencia 3,92" in the bar and "3,9" in its card read as two numbers for
  // one fact. Judged at the decimal it prints, so the chip and the figure agree.
  const band = bandOf(value, bands, SPARK_DECIMALS)
  // The move between the two readings AS PRINTED, so the move and the two figures beside
  // it always subtract: the raw difference can print one hundredth off.
  const move = before === undefined ? null : printedMove(value, before, SPARK_DECIMALS, bands.scale)
  return (
    <div
      data-slot="trend-card"
      data-dimension={dimension.key}
      data-band={band}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-default px-3.5 pt-3 pb-2.5"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        {/* The dimension name is what the number is OF, so it wraps rather than truncates —
            same reason as the map's column heads below. At 1024, where this grid drops to
            two columns, "Seguridad psicológica" was cut in three of the six cards. */}
        <span className="text-sm break-words text-fg-secondary">{dimension.name}</span>
        <BandChip band={band} bands={bands} className="h-4.5 shrink-0 px-1.5 text-2xs" />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-reading leading-none font-semibold tabular-nums text-fg-primary">{reading(value, locale, SPARK_DECIMALS, bands.scale)}</span>
        {move !== null && (
          <span
            data-slot="trend-move"
            // The sign carries the direction; green and red are result areas, never a move.
            className="text-sm tabular-nums text-fg-secondary"
          >
            {signedReading(move, locale, SPARK_DECIMALS, bands.scale)}
          </span>
        )}
      </div>
      <TrendSparkline
        values={dimension.values}
        bands={bands}
        labels={labels}
        domain={domain}
        decimals={SPARK_DECIMALS}
        label={t('resultBands.dashboard.sparklineLabel', {
          dimension: dimension.name,
          values: dimension.values.map((v) => reading(v, locale, SPARK_DECIMALS, bands.scale)).join(' → '),
          low: boundaryText(bands.opportunityMin, locale, bands.scale),
          high: boundaryText(bands.strengthMin, locale, bands.scale),
        })}
      />
    </div>
  )
}

/**
 * "segunda alza seguida" — the rises in a row as the artboard words them (its "tercer
 * alza seguida"), by the count the data gives: Q1 → Q2 → Q3 is the second. Past the
 * sixth the catalogue has no ordinal and the count is printed.
 */
function risesPhrase(rises: number, t: TranslateFn): string {
  return rises <= 6 ? t(`dashboard.next.riseOrdinal.${rises}`) : t('dashboard.next.risesInARow', { count: rises })
}

/**
 * "límites de área 3,00 y 4,00 · tres encuestas cerradas, toda la empresa" — the count in
 * words up to ten, as the artboard writes it.
 */
function movedLegend(count: number, bands: ResultBands, t: TranslateFn, locale: string): string {
  const low = boundaryText(bands.opportunityMin, locale, bands.scale)
  const high = boundaryText(bands.strengthMin, locale, bands.scale)
  if (count === 1) return t('resultBands.dashboard.movedLegendOne', { low, high })
  const words = count >= 2 && count <= 10 ? t(`dashboard.next.countWord.${count}`) : count.toLocaleString(locale)
  return t('resultBands.dashboard.movedLegend', { low, high, count: words })
}

/**
 * The rail: one step per wave, its code and what its date means ("cerró 12 feb",
 * "cierra 10 oct") on screen, as the artboard draws them — and,
 * when nothing is planned after the open wave, the next slot of a quarterly cycle as a
 * hollow "por planificar" step (`nextWaveCode`), which names a slot and claims no survey.
 */
function cycleSteps(waves: readonly Wave[], t: TranslateFn, locale: string): CycleStep[] {
  const steps = waves.map((wave): CycleStep => {
    // The verb is on screen, not only for AT: a bare date under a code does not say
    // which way it points, and the artboard reads "cerró 12 feb" and "cierra 10 oct".
    if (wave.status === 'closed' && wave.closedAt) {
      const date = calendarDay(Date.parse(wave.closedAt), locale)
      return { id: wave.id, code: wave.code, detail: t('dashboard.next.waveClosed', { date }), status: 'closed' }
    }
    if (wave.status === 'open' && wave.closesAt) {
      const date = calendarDay(Date.parse(wave.closesAt), locale)
      return {
        id: wave.id,
        code: t('dashboard.next.waveOpen', { code: wave.code }),
        detail: t('dashboard.next.waveCloses', { date }),
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
          <span className="tabular-nums">{value.mono}</span>
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
    const cell = lowestCell(model, model.minimumGroupSize ?? SINGLE_SEGMENT_FLOOR)
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
              score: { mono: reading(cell.score, locale, 1, model.bands.scale) },
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
        // Where tracking replaces `/action-plans` in the sidebar it replaces it here too
        // (`actionPlansOffered`): "create" goes to the tracking listing the sidebar offers,
        // and a generic plan's page is not linked at all.
        action={
          item.plan
            ? capabilities.seesWholeCompany && actionPlansOffered()
              ? { label: t('dashboard.next.openPlan'), href: `/action-plans/${item.plan.id}` }
              : undefined
            : capabilities.canCreateActionPlan
              ? { label: t('dashboard.next.createPlan'), href: actionPlansOffered() ? '/action-plans' : '/tracking/planes' }
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
        // A segment whose value is unknown is left out, never printed as "—".
        detail={t(item.plan.owner ? 'dashboard.next.overduePlanSub' : 'dashboard.next.overduePlanSubNoOwner', {
          date: item.plan.dueAt ? longDay(item.plan.dueAt, locale) : '—',
          owner: item.plan.owner ?? '',
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
  // The closed wave's completion, for "last time X% answered". Absent unless BOTH
  // halves were read — the sentence then takes its unknown-rate wording.
  const previousRate =
    model.participation.completed !== null && model.participation.responses !== null
      ? percent(model.participation.completed, model.participation.responses)
      : null
  // Past the close the sentence says when it closed, never "a −45 días del cierre".
  const days = daysBetween(model.asOf, survey.closesAt)
  const headlineKey =
    days < 0
      ? 'dashboard.next.lowParticipationHeadlineClosed'
      : days === 0
        ? 'dashboard.next.lowParticipationHeadlineToday'
        : 'dashboard.next.lowParticipationHeadline'
  return (
    <AttentionItemRow
      icon={<Send aria-hidden="true" className="size-4" />}
      tone="warning"
      headline={
        <RichLine
          t={t}
          messageKey={headlineKey}
          params={{
            // The title as it reads inside the sentence: "Encuesta de Clima Q4", its
            // "(abierta)" dropped because the sentence already says it is open.
            survey: {
              strong: sentenceName(
                survey.name,
                model.waves.filter((wave) => wave.id !== survey.id).map((wave) => wave.name),
              ),
            },
            responses: { mono: survey.responses.toLocaleString(locale) },
            audience: { mono: survey.audience === null ? '—' : survey.audience.toLocaleString(locale) },
            days: { mono: Math.abs(days).toLocaleString(locale) },
          }}
        />
      }
      detail={participationDetail(
        item.remindersSent,
        model.latestClosedWave && previousRate !== null
          ? { wave: model.latestClosedWave.code, percent: percentReading(previousRate, locale) }
          : null,
        t,
      )}
      // Not "Enviar recordatorio", but the reason changed on 2026-10-31 and the old one is worth
      // correcting rather than leaving to mislead. It used to be "there is no reminder to send":
      // the sweep was deleted with the invitation email and the batch route still answers zeros
      // by design (#G11). Since `e3132f31` there IS a reminder -- per PERSON, from the roster --
      // so the label is right for a better reason: chasing is a per-person decision, and the
      // page this leads to is where that decision is made and where the button lives.
      //
      // `item.remindersSent` counts both kinds since 2026-11-08: invitation reminders and the
      // ones recorded on per-survey keys (`remindersOf`).
      action={
        capabilities.canAuthorSurveys
          ? { label: t('surveys.next.distribution.send.seeWhoIsMissing'), href: `/surveys/${survey.id}/distribution` }
          : undefined
      }
    />
  )
}

/**
 * The line under the low-participation item: how the last wave closed, and the reminders,
 * each said only when known. "Q3 cerró al —" said nothing; with neither known there is no line.
 */
function participationDetail(
  reminders: number | null,
  last: { wave: string; percent: string } | null,
  t: TranslateFn,
): string | undefined {
  if (last === null) {
    if (reminders === null) return undefined
    return reminders === 0
      ? t('dashboard.next.lowParticipationSubNoReminderBare')
      : t('dashboard.next.lowParticipationSubRemindersBare', { count: reminders })
  }
  const params = { ...last, count: reminders ?? 0 }
  if (reminders === null) return t('dashboard.next.lowParticipationSubUnknown', params)
  return reminders === 0
    ? t('dashboard.next.lowParticipationSubNoReminder', params)
    : t('dashboard.next.lowParticipationSubReminders', params)
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
  /** Absent when nothing is known to say: a line of dashes says nothing. */
  detail?: string
  /** Absent when the viewer may not take it: the row still informs, it just offers nothing. */
  action?: { label: string; href: string }
}) {
  return (
    <li data-slot="attention-item" className="flex flex-wrap items-center gap-3 px-5 py-3 sm:flex-nowrap">
      {/* One neutral glyph box for every kind: red and amber are result areas, and
          the headline already says what kind of item this is. */}
      <span
        aria-hidden="true"
        data-tone={tone}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-fill-subtle text-fg-secondary"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <div className="text-base text-fg-primary">{headline}</div>
        {detail && <div className="text-sm text-fg-tertiary">{detail}</div>}
      </div>
      {action && (
        <Button asChild variant="outline" className="shrink-0 max-sm:ml-11">
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

/** The sentence for each way a read can fail: what happened, in the reader's language. */
const FAILURE_CAUSE_KEYS: Record<FailureCause, string> = {
  forbidden: 'dashboard.next.failureForbidden',
  notFound: 'dashboard.next.failureNotFound',
  server: 'dashboard.next.failureServer',
  network: 'dashboard.next.failureNetwork',
  other: 'dashboard.next.failureOther',
}

/**
 * The honest sentence a section carries when its region is missing: which region,
 * and why, as a sentence chosen by how the read failed (`FailureCause`). The server's own
 * text is never printed: it is English on a Spanish screen and can carry paths and ids.
 * Drawn nowhere otherwise — a live
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
  const failed = state.reason === 'failed'
  return (
    // A grey note, not an amber one: amber is the Oportunidad area (ruling 11 Nov). The
    // sentence says what is missing in words a reader can act on; why follows on a quieter
    // line of its own, chosen by the failure's cause rather than copied from the server.
    <Note data-slot="region-fallback" data-region={region} role="status" icon={<Info />} className="py-2.5 text-sm">
      <span className="flex flex-col gap-0.5">
        <span data-slot="region-fallback-text">
          {failed ? t('dashboard.next.unavailableRegion', { region: name }) : t('dashboard.next.unavailableEmpty', { region: name })}
        </span>
        {failed && (
          <span data-slot="region-fallback-reason" className="text-fg-tertiary">
            {t(FAILURE_CAUSE_KEYS[state.cause ?? 'other'])}
          </span>
        )}
      </span>
    </Note>
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
      <PageHeader title={t('dashboard.next.title')} description={t('dashboard.next.description')} />
      <div className="flex flex-col gap-section">
        {SECTION_REGIONS.map((section) => (
          <section key={section.id} aria-labelledby={section.id} className="flex flex-col gap-3.5">
            {/* The same rule the loaded screen draws, so the skeleton does not reflow
                into a different shape the moment the data lands. */}
            <SectionHead id={section.id} heading={t(section.headingKey)} />
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
