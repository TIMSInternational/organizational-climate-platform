import { Navigate } from 'react-router'
import { Download } from 'lucide-react'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { downloadTextFile } from '../../../../lib/downloadTextFile'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { PageTopBar } from '../../../../components/layout'
import { BandChip, BandLegend, KpiTile, bandName, bandOf, boundaryText, type ResultBandKey } from '../../../../components/charts'
import { Button, EmptyState, LoadingRegion, NetworkError } from '../../../../components/ui'
import { KpiRow } from '../../../dashboard/components/dashboardGrammar'
import { printedMove, reading, signedReading } from '../../../dashboard/next/derive'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { WHOLE_COMPANY_KEY } from '../../api/climateTrends'
import DimensionTrendChart from './DimensionTrendChart'
import TrendsNumbersTable from './TrendsNumbersTable'
import {
  deltaSince,
  latestIndex,
  sharedTrendAxis,
  standings,
  waveMean,
  type DimensionStanding,
  type TrendAxis,
} from './derive'
import { buildTrendsCsv } from './trendsCsv'
import type { ClimateTrendsNextModel, TrendDimension, TrendWave } from './model'
import { useClimateTrendsModel } from './useClimateTrendsModel'

/** The ink each band's tile prints its list in: the band's chip ink, measured for AA. */
const BAND_INK: Record<ResultBandKey, string> = {
  strength: 'text-chip-good-ink',
  opportunity: 'text-chip-warning-ink',
  critical: 'text-chip-critical-ink',
}

/**
 * `/surveys/climate-trends` — the redesigned Clima en el tiempo, which replaced
 * `ClimateTrendsPage` on this route (the old page stays unrouted as the wiring
 * reference), for the company administrator, drawn as the ClimateTrends artboard:
 * header → four tiles → the segmented control → six charts, one per dimension, on one
 * axis → the same numbers as the accessible table.
 *
 * Same gate as `DashboardPage`'s company branch: `company_admin`, or `super_admin` once a company
 * is chosen; a SuperAdmin with none chosen is asked to choose one, as the current
 * page does, because the endpoint answers 400 with no company to name. Every other
 * role goes to `/dashboard`, which dispatches them to the view their role has.
 *
 * "Exportar" is the numbers table as a CSV, built in the browser from the same model the
 * table draws (`trendsCsv.ts`): `/surveys/climate-trends` has no export endpoint
 * (`SurveyClimateTrendsEndpoints.cs` maps one GET), and the page already holds every
 * number the file carries and nothing the page withholds. It is offered to the viewers
 * the product lets export (`viewerCapabilities.canExport`).
 */
export default function ClimateTrendsNextPage() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const isAdmin = scope.role === 'company_admin' || scope.isSuperAdmin
  const state = useClimateTrendsModel(isAdmin && scope.status === 'ready')

  if (!isAdmin) return <Navigate to="/dashboard" replace />

  if (scope.status !== 'ready') {
    return (
      <div className="grid gap-panel-gap">
        <PageTopBar title={t('surveys.next.trends.title')} />
        {scope.status === 'needs-selection' ? (
          <EmptyState
            title={t('companyContext.chooseACompany')}
            description={t('companyContext.chooseACompanyDescription')}
          />
        ) : (
          <p role="alert">{t('common.noCompanyAssociated')}</p>
        )}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="grid gap-panel-gap">
        <PageTopBar title={t('surveys.next.trends.title')} />
        <NetworkError
          title={t('surveys.climateTrends.loadError')}
          description={state.error ?? undefined}
          onRetry={state.retry}
          retryText={t('common.retry')}
        />
      </div>
    )
  }

  return (
    <LoadingRegion loading={state.model === null} label={t('common.loading')}>
      {state.model && <ClimateTrendsNextView model={state.model} onSelectGroup={state.selectGroup} />}
    </LoadingRegion>
  )
}

/** "ambas suben", "sube", "1 de 2 suben" — how the dimensions in the critical area last moved. */
function risingPhrase(below: readonly DimensionStanding[], t: (key: string, params?: Record<string, string | number>) => string): string | null {
  const known = below.filter((entry) => entry.lastMove !== null)
  if (known.length === 0 || known.length !== below.length) return null
  const rising = known.filter((entry) => (entry.lastMove ?? 0) > 0).length
  if (rising === 0) return t('surveys.next.trends.risingNone')
  if (rising < below.length) return t('surveys.next.trends.risingSome', { count: rising, total: below.length })
  if (below.length === 1) return t('surveys.next.trends.risingOne')
  if (below.length === 2) return t('surveys.next.trends.risingBoth')
  return t('surveys.next.trends.risingAll')
}

function ClimateTrendsNextView({
  model,
  onSelectGroup,
}: {
  model: ClimateTrendsNextModel
  onSelectGroup: (key: string) => void
}) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const { bands, waves, dimensions } = model
  const last = waves.length - 1
  const latestWave = waves[last]
  const latestMean = latestWave ? waveMean(dimensions, last) : null
  // The climate average's moves: against the wave before, and against the first once
  // there are three. Both ends must be readings, or there is no move to print.
  const moves = [last - 1, ...(last >= 2 ? [0] : [])].flatMap((index) => {
    const wave = waves[index]
    const mean = index >= 0 ? waveMean(dimensions, index) : null
    // The difference of the two averages as the tile prints them, at two decimals.
    return wave && mean !== null && latestMean !== null ? [{ wave, delta: printedMove(latestMean, mean, 2) }] : []
  })
  const judged = standings(dimensions, bands)
  const inBand = (band: ResultBandKey) =>
    judged.filter((entry) => entry.band === band).sort((a, b) => b.value - a.value)
  const strength = inBand('strength')
  const critical = inBand('critical').reverse()
  const rising = risingPhrase(critical, t)
  const axis = sharedTrendAxis(dimensions, bands)
  const groupName =
    model.selectedGroup === WHOLE_COMPANY_KEY
      ? t('surveys.next.trends.wholeCompany').toLocaleLowerCase(locale)
      : (model.groups.find((group) => group.key === model.selectedGroup)?.name ?? model.selectedGroup)
  // "Q1 · feb" as the canvas draws it; a wave with no short code is named by its month
  // alone, because a full title under a point prints over its neighbours' labels.
  const tickLabels = waves.map((wave) => {
    const month = new Date(wave.closedAt).toLocaleDateString(locale, { timeZone: 'UTC', month: 'short' })
    return wave.code.length <= 8 ? `${wave.code} · ${month}` : month
  })
  const exportTable = () => {
    downloadTextFile(
      `${t('surveys.next.trends.exportFileName')}.csv`,
      'text/csv;charset=utf-8',
      buildTrendsCsv({
        groupName:
          model.selectedGroup === WHOLE_COMPANY_KEY
            ? t('surveys.next.trends.wholeCompany')
            : (model.groups.find((group) => group.key === model.selectedGroup)?.name ?? model.selectedGroup),
        waves,
        withheld: model.withheld,
        respondents: model.respondents,
        dimensions,
        labels: {
          group: t('surveys.next.trends.csvColGroup'),
          survey: t('surveys.next.trends.tableColSurvey'),
          closed: t('surveys.next.trends.csvColClosed'),
          responses: t('surveys.next.trends.csvColResponses'),
          withheld: t('surveys.next.trends.withheld'),
        },
      }),
    )
  }

  return (
    <div>
      <PageTopBar
        eyebrow={model.companyName}
        title={t('surveys.next.trends.title')}
        description={t('resultBands.trends.description')}
        actions={
          capabilities.canExport && waves.length > 0 ? (
            <Button type="button" variant="outline" onClick={exportTable}>
              <Download aria-hidden="true" />
              {t('surveys.next.trends.export')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-section">
        {waves.length === 0 ? (
          <EmptyState
            title={t('surveys.climateTrends.noSurveysTitle')}
            description={t('surveys.climateTrends.noSurveysBody')}
          />
        ) : (
          <>
            <section aria-label={t('surveys.next.trends.standingHeading')}>
              <KpiRow>
                <KpiTile
                  size="large"
                  label={t('surveys.next.trends.climateLabel', { wave: latestWave?.code ?? '' })}
                  value={latestMean}
                  format={{ kind: 'number', decimals: 2 }}
                  unit={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {t('surveys.next.trends.climateOf')}
                      {/* Printed at two decimals, so judged at two. */}
                      {latestMean !== null && <BandChip band={bandOf(latestMean, bands, 2)} bands={bands} />}
                    </span>
                  }
                  locale={locale}
                  sub={
                    moves.length > 0 ? (
                      <span data-slot="climate-moves" className="flex flex-wrap gap-x-1">
                        {moves.map((move, index) => (
                          <span key={move.wave.id} className={move.delta >= 0 ? 'text-accent-green-ink' : 'text-fg-primary'}>
                            {index > 0 && <span aria-hidden="true">· </span>}
                            <span className="font-mono tabular-nums">{signedReading(move.delta, locale, 2)}</span>{' '}
                            {t('surveys.next.trends.climateVs', { wave: move.wave.code })}
                          </span>
                        ))}
                      </span>
                    ) : undefined
                  }
                />
                <KpiTile
                  size="large"
                  label={t('surveys.next.trends.closedLabel')}
                  value={waves.length}
                  unit={waves.map((wave) => wave.code).join(' · ')}
                  locale={locale}
                  sub={
                    model.openWave ? (
                      <span data-slot="open-wave" className="text-fg-label">
                        {t('surveys.next.trends.openEnters', {
                          wave: model.openWave.code,
                          date: calendarDay(Date.parse(model.openWave.closesAt), locale),
                        })}
                      </span>
                    ) : undefined
                  }
                />
                {/* The two ends of the scale, where the old page put "sobre / bajo la meta":
                    how many dimensions are in the strength area and how many in the critical
                    one. The opportunity area is what is left, and every chart names it. */}
                {(['strength', 'critical'] as const).map((band) => {
                  const entries = band === 'strength' ? strength : critical
                  return (
                    <KpiTile
                      key={band}
                      size="large"
                      label={bandName(band, bands, t)}
                      value={entries.length}
                      unit={t('surveys.next.trends.ofDimensions', { total: judged.length })}
                      locale={locale}
                      sub={
                        <span data-slot={`band-tile-${band}`} className={entries.length > 0 ? BAND_INK[band] : undefined}>
                          {entries.length === 0
                            ? t('surveys.next.trends.none')
                            : [
                                  ...entries.map((entry) => `${entry.dimension.name} ${reading(entry.value, locale)}`),
                                  ...(band === 'critical' && rising ? [rising] : []),
                                ].join(' · ')}
                        </span>
                      }
                    />
                  )
                })}
              </KpiRow>
            </section>

            <section aria-label={t('surveys.next.trends.chartsLabel')} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span id="trends-next-breakdown" className="text-sm font-semibold text-fg-secondary">
                  {t('surveys.next.trends.breakDownBy')}
                </span>
                <div
                  role="group"
                  aria-labelledby="trends-next-breakdown"
                  data-slot="trends-segments"
                  className="inline-flex flex-wrap gap-0.5 rounded-md border border-line-default bg-surface-icon-box p-0.75"
                >
                  {model.groups.map((group) => {
                    const selected = group.key === model.selectedGroup
                    return (
                      <Button
                        key={group.key}
                        type="button"
                        variant={selected ? 'default' : 'ghost'}
                        aria-pressed={selected}
                        data-group={group.key}
                        className={cn('h-7 rounded px-2.5 text-sm font-medium', selected && 'shadow-sm')}
                        onClick={() => onSelectGroup(group.key)}
                      >
                        {group.name ?? t('surveys.next.trends.wholeCompany')}
                      </Button>
                    )
                  })}
                </div>
                <BandLegend bands={bands} short className="ml-auto" />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {dimensions.map((dimension) => (
                  <TrendCard
                    key={dimension.key}
                    dimension={dimension}
                    model={model}
                    axis={axis}
                    tickLabels={tickLabels}
                  />
                ))}
              </div>
            </section>

            <section
              aria-labelledby="trends-next-table"
              className="flex flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pt-4 pb-4.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="trends-next-table" className="m-0 text-2xl">
                  {t('surveys.next.trends.tableHeading')}
                </h2>
                <p className="m-0 text-sm text-fg-label">{t('surveys.next.trends.tableScale', { group: groupName })}</p>
              </div>
              <TrendsNumbersTable
                waves={waves}
                withheld={model.withheld}
                respondents={model.respondents}
                dimensions={dimensions}
                bands={bands}
                floor={model.floor}
                caption={t('surveys.next.trends.tableHeading')}
              />
              {/* The artboard's one line: the floor's rule, and — only while it is true of
                  every wave on the page — that the whole company is never under it. A
                  department withheld in every wave says so in its own segment, where every
                  cell is hatched; the bands are the company's, and the legend above
                  already names them. */}
              <p data-slot="trends-footnote" className="m-0 -mt-1 text-xs leading-normal text-fg-label">
                {t('surveys.next.trends.floorNote', { floor: model.floor })}
                {!model.companyWithheld.some(Boolean) && <> {t('surveys.next.trends.companyNeverWithheld')}</>}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function TrendCard({
  dimension,
  model,
  axis,
  tickLabels,
}: {
  dimension: TrendDimension
  model: ClimateTrendsNextModel
  axis: TrendAxis
  tickLabels: readonly string[]
}) {
  const { t, locale } = useTranslation()
  const { bands, waves } = model
  const last = latestIndex(dimension.values)
  const value = last === -1 ? null : (dimension.values[last] ?? null)
  const band = value === null ? null : bandOf(value, bands)
  const sincePrevious = last > 0 ? deltaSince(dimension.values, last - 1) : null
  const sinceFirst = last > 1 ? deltaSince(dimension.values, 0) : null
  const previousWave: TrendWave | undefined = last > 0 ? waves[last - 1] : undefined
  const firstWave: TrendWave | undefined = waves[0]

  return (
    <div
      data-slot="trend-card"
      data-dimension={dimension.key}
      data-band={band ?? 'withheld'}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-default bg-surface-card px-4 pt-3.5 pb-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-base font-semibold text-fg-primary">{dimension.name}</span>
        {band && <BandChip band={band} bands={bands} className="h-6" />}
      </div>
      {/* `leading-normal` is the canvas's line box: the artboard sets this 22px reading in a
          body of `line-height: 1.5`, so the row is 33px and the card 254px tall
          (ClimateTrends.dc.html, `.card` with `padding: 14px 16px 12px; gap: 8px`). */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span data-slot="trend-reading" className="font-mono text-reading leading-normal tabular-nums text-fg-primary">
          {value === null ? t('surveys.next.trends.withheld') : reading(value, locale)}
        </span>
        {sincePrevious !== null && previousWave && <Move value={sincePrevious} />}
        {(sincePrevious !== null || sinceFirst !== null) && (
          <span className="text-xs text-fg-label">
            {sincePrevious !== null && previousWave && (
              <span>{t('surveys.next.trends.sinceWave', { wave: previousWave.code })}</span>
            )}
            {sinceFirst !== null && firstWave && (
              <>
                {sincePrevious !== null && <span aria-hidden="true"> · </span>}
                <Move value={sinceFirst} small /> <span>{t('surveys.next.trends.sinceWave', { wave: firstWave.code })}</span>
              </>
            )}
          </span>
        )}
      </div>
      <DimensionTrendChart
        values={dimension.values}
        withheld={model.withheld}
        bands={bands}
        axis={axis}
        labels={tickLabels}
        format={(reading_) => reading(reading_, locale)}
        withheldText={t('surveys.next.trends.withheld')}
        label={t('resultBands.trends.chartLabel', {
          dimension: dimension.name,
          values: dimension.values
            .map((entry, index) =>
              entry === null
                ? model.withheld[index]
                  ? t('surveys.next.trends.withheld')
                  : t('surveys.next.trends.notAsked')
                : reading(entry, locale),
            )
            .join(' → '),
          low: boundaryText(bands.opportunityMin, locale),
          high: boundaryText(bands.strengthMin, locale),
        })}
      />
    </div>
  )
}

/**
 * A signed move, in mono. The sign is in the reading (`signDisplay: 'always'`), so the
 * colour is not load-bearing; green marks a rise and a fall stays in the primary ink
 * rather than the red the feature-wide contrast sweep refuses.
 */
function Move({ value, small = false }: { value: number; small?: boolean }) {
  const { locale } = useTranslation()
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        small ? 'text-xs' : 'text-sm',
        value >= 0 ? 'text-accent-green-ink' : 'text-fg-primary',
      )}
    >
      {signedReading(value, locale)}
    </span>
  )
}
