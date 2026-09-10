import { Navigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { PageTopBar } from '../../../../components/layout'
import { ClimateMap, KpiTile } from '../../../../components/charts'
import { Button, Chip, EmptyState, LoadingRegion, NetworkError } from '../../../../components/ui'
import { KpiRow, SectionHeading } from '../../../dashboard/components/dashboardGrammar'
import { reading, signedReading } from '../../../dashboard/next/derive'
import { cn } from '../../../../lib/cn'
import { dimensionLabel } from '../../dimensionLabel'
import { WHOLE_COMPANY_KEY } from '../../api/climateTrends'
import type { ClimateTrendMapModel } from '../../climateTrendsMap'
import DimensionTrendChart from './DimensionTrendChart'
import { deltaSince, latestIndex, standing, standings, waveMean, type Standing } from './derive'
import type { ClimateTrendsNextModel, TrendWave } from './model'
import { useClimateTrendsModel } from './useClimateTrendsModel'

const STANDING_TONE: Record<Standing, 'good' | 'neutral' | 'critical'> = {
  above: 'good',
  on: 'neutral',
  below: 'critical',
}

/**
 * `/surveys/climate-trends/next` — the redesigned Clima en el tiempo, for the company
 * administrator: header → four tiles → the segmented control → six charts, one per
 * dimension → the same numbers as the accessible grid.
 *
 * Same gate as `DashboardNextPage`: `company_admin`, or `super_admin` once a company
 * is chosen; a SuperAdmin with none chosen is asked to choose one, as the current
 * page does, because the endpoint answers 400 with no company to name. Every other
 * role goes to `/dashboard`, which dispatches them to the view their role has.
 *
 * No export action: `/surveys/climate-trends` has no export endpoint, and a button
 * that exists and then does nothing is the failure `viewerCapabilities.ts` describes.
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
      {state.model && (
        <ClimateTrendsNextView model={state.model} table={state.table} onSelectGroup={state.selectGroup} />
      )}
    </LoadingRegion>
  )
}

function waveName(wave: TrendWave, locale: string): string {
  const name = wave.name?.trim()
  if (name && name.length > 0) return name
  return new Date(wave.closedAt).toLocaleDateString(locale, { year: 'numeric', month: 'short' })
}

function ClimateTrendsNextView({
  model,
  table,
  onSelectGroup,
}: {
  model: ClimateTrendsNextModel
  table: ClimateTrendMapModel | null
  onSelectGroup: (key: string) => void
}) {
  const { t, locale } = useTranslation()
  const { target } = model
  const targetText = reading(target, locale)
  const sample = model.isSample ? <Chip tone="warning" label={t('dashboard.next.sampleChip')} /> : null
  const lastWave = model.waves.length - 1
  const latestWave = model.waves[lastWave]
  const previousWave = model.waves[lastWave - 1]
  const latestMean = latestWave ? waveMean(model.dimensions, lastWave) : null
  const previousMean = previousWave ? waveMean(model.dimensions, lastWave - 1) : null
  const judged = standings(model.dimensions, target)
  const above = judged.filter((entry) => entry.standing === 'above')
  const below = judged.filter((entry) => entry.standing === 'below')
  const groupName =
    model.selectedGroup === WHOLE_COMPANY_KEY
      ? t('surveys.next.trends.wholeCompany')
      : (model.groups.find((group) => group.key === model.selectedGroup)?.name ?? model.selectedGroup)
  // A short wave code reads "Q1 · feb" as the design; a long title would print over
  // its neighbours' ticks (measured at 1440), so it steps aside for the month and year
  // and the card's deltas keep naming the wave in full.
  const tickLabels = model.waves.map((wave) => {
    const month = new Date(wave.closedAt).toLocaleDateString(locale, { month: 'short', year: '2-digit' })
    const name = wave.name?.trim() ?? ''
    return name.length > 0 && name.length <= 8 ? `${name} · ${month}` : month
  })
  const format = (value: number) => reading(value, locale)

  return (
    <div>
      <PageTopBar
        eyebrow={model.companyName}
        title={t('surveys.next.trends.title')}
        description={t('surveys.next.trends.description', { target: targetText })}
        badge={model.isSample ? { text: t('dashboard.next.sampleChip'), variant: 'warning' } : undefined}
      />

      <div className="flex flex-col gap-section">
        {model.waves.length === 0 ? (
          <EmptyState
            title={t('surveys.climateTrends.noSurveysTitle')}
            description={t('surveys.climateTrends.noSurveysBody')}
          />
        ) : (
          <>
            <section aria-label={t('surveys.next.trends.standingHeading')}>
              <KpiRow>
                <KpiTile
                  label={t('surveys.next.trends.climateLabel', { wave: latestWave ? waveName(latestWave, locale) : '' })}
                  value={latestMean}
                  format={{ kind: 'number', decimals: 2 }}
                  previousValue={previousMean ?? undefined}
                  locale={locale}
                  changeLabel={previousWave ? t('surveys.next.trends.climateVs', { wave: waveName(previousWave, locale) }) : undefined}
                  sub={<span>{t('surveys.next.trends.climateOf')}</span>}
                />
                <KpiTile
                  label={t('surveys.next.trends.closedLabel')}
                  value={model.waves.length}
                  locale={locale}
                  sub={<span>{model.waves.map((wave) => waveName(wave, locale)).join(' · ')}</span>}
                />
                <KpiTile
                  label={t('surveys.next.trends.aboveLabel')}
                  value={above.length}
                  locale={locale}
                  sub={
                    <span className="flex flex-col gap-0.5">
                      <span>{t('surveys.next.trends.ofDimensions', { total: judged.length })}</span>
                      <span className="text-accent-green">
                        {above.length === 0 ? t('surveys.next.trends.none') : above.map((entry) => entry.dimension.name).join(', ')}
                      </span>
                      {sample}
                    </span>
                  }
                />
                <KpiTile
                  label={t('surveys.next.trends.belowLabel')}
                  value={below.length}
                  higherIsBetter={false}
                  locale={locale}
                  sub={
                    <span className="flex flex-col gap-0.5">
                      <span>{t('surveys.next.trends.ofDimensions', { total: judged.length })}</span>
                      {/* Not the red ink: `respondContrast.test.ts` sweeps this whole feature for
                          `text-accent-red` (4.43:1 on a card). The tile's tone and the chips
                          already say "below"; the names need no second colour. */}
                      <span className="text-fg-primary">
                        {below.length === 0
                          ? t('surveys.next.trends.none')
                          : below.map((entry) => `${entry.dimension.name} ${reading(entry.value, locale)}`).join(' · ')}
                      </span>
                      {sample}
                    </span>
                  }
                />
              </KpiRow>
            </section>

            <section aria-labelledby="trends-next-moved">
              <div className="mb-inline flex flex-wrap items-center justify-between gap-inline">
                <div className="flex flex-wrap items-center gap-inline">
                  <span id="trends-next-moved" className="text-sm text-fg-secondary">
                    {t('surveys.next.trends.breakDownBy')}
                  </span>
                  <div
                    role="group"
                    aria-label={t('surveys.next.trends.breakDownBy')}
                    className="flex flex-wrap gap-1 rounded-lg border border-line-light bg-surface-icon-box p-1"
                  >
                    {model.groups.map((group) => {
                      const selected = group.key === model.selectedGroup
                      return (
                        <Button
                          key={group.key}
                          type="button"
                          size="sm"
                          variant={selected ? 'default' : 'ghost'}
                          aria-pressed={selected}
                          data-group={group.key}
                          onClick={() => onSelectGroup(group.key)}
                        >
                          {group.name ?? t('surveys.next.trends.wholeCompany')}
                        </Button>
                      )
                    })}
                  </div>
                </div>
                <p className="m-0 flex flex-wrap items-center gap-inline text-2xs text-fg-label">
                  <span aria-hidden="true" className="inline-block w-5 border-t border-dashed border-line-default" />
                  <span>{t('surveys.next.trends.legendTarget', { target: targetText })}</span>
                  <span aria-hidden="true" className="inline-block size-2 rounded-full bg-accent-red" />
                  <span>{t('surveys.next.trends.legendBelow')}</span>
                  {sample}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 xl:grid-cols-3">
                {model.dimensions.map((dimension) => {
                  const last = latestIndex(dimension.values)
                  const value = last === -1 ? null : (dimension.values[last] ?? null)
                  const stand = value === null ? null : standing(value, target)
                  const sincePrevious = last > 0 ? deltaSince(dimension.values, last - 1) : null
                  const sinceFirst = last > 1 ? deltaSince(dimension.values, 0) : null
                  const prevWave = last > 0 ? model.waves[last - 1] : undefined
                  return (
                    <div
                      key={dimension.key}
                      data-slot="trend-card"
                      data-dimension={dimension.key}
                      data-standing={stand ?? 'withheld'}
                      className="rounded-lg border border-line-default bg-surface-card p-card"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-inline">
                        <span className="text-sm font-semibold text-fg-primary">{dimension.name}</span>
                        {stand && <Chip tone={STANDING_TONE[stand]} label={t(`surveys.next.trends.standing.${stand}`)} />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-inline">
                        <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
                          {value === null ? t('surveys.next.trends.withheld') : reading(value, locale)}
                        </span>
                        {sincePrevious !== null && prevWave && (
                          <Delta value={sincePrevious} wave={waveName(prevWave, locale)} locale={locale} />
                        )}
                        {sinceFirst !== null && model.waves[0] && (
                          <Delta value={sinceFirst} wave={waveName(model.waves[0], locale)} locale={locale} />
                        )}
                      </div>
                      <div className="mt-2">
                        <DimensionTrendChart
                          values={dimension.values}
                          target={target}
                          labels={tickLabels}
                          format={format}
                          withheldText={t('surveys.next.trends.withheld')}
                          targetText={t('surveys.next.trends.legendTarget', { target: targetText })}
                          label={t('surveys.next.trends.chartLabel', {
                            dimension: dimension.name,
                            values: dimension.values
                              .map((entry) => (entry === null ? t('surveys.next.trends.withheld') : reading(entry, locale)))
                              .join(' → '),
                            target: targetText,
                          })}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section
              aria-labelledby="trends-next-table"
              className="rounded-lg border border-line-default bg-surface-card p-card"
            >
              <div className="mb-inline flex flex-wrap items-baseline justify-between gap-inline">
                <SectionHeading>
                  <span id="trends-next-table">{t('surveys.next.trends.tableHeading')}</span>
                </SectionHeading>
                <p className="m-0 text-2xs text-fg-label">
                  {t('surveys.next.trends.tableScale', { group: groupName })}
                </p>
              </div>
              {table === null ? (
                <EmptyState
                  title={t('surveys.climateTrends.nothingToDrawTitle')}
                  description={t('surveys.climateTrends.nothingToDrawBody')}
                />
              ) : (
                <ClimateMap
                  dimensions={table.dimensions.map((dimension) => ({ ...dimension, label: dimensionLabel(dimension.key, t) }))}
                  rows={table.rows}
                  target={table.target}
                  deadBandAt={table.deadBandAt}
                  extremeAt={table.extremeAt}
                  threshold={table.threshold}
                  decimals={1}
                  size="large"
                  title={t('surveys.climateTrends.mapTitle')}
                />
              )}
              <div className={cn('mt-inline flex flex-col gap-1 text-xs text-fg-secondary')}>
                {table !== null && table.omittedDimensions.length > 0 && (
                  <p className="m-0">
                    {t('surveys.climateTrends.omittedDimensions', { dimensions: table.omittedDimensions.join(', ') })}
                  </p>
                )}
                {model.suppressedGroupCount > 0 && (
                  <p className="m-0">
                    {t('surveys.climateTrends.suppressedGroups', { count: model.suppressedGroupCount, threshold: model.floor })}
                  </p>
                )}
                <p className="m-0">{t('surveys.next.trends.floorNote', { floor: model.floor })}</p>
                {model.isSample && <p className="m-0">{t('surveys.next.trends.targetSampleNote', { target: targetText })}</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Delta({ value, wave, locale }: { value: number; wave: string; locale: string }) {
  const { t } = useTranslation()
  return (
    <span className="text-xs text-fg-secondary">
      {/* The sign is in the reading (`signDisplay: 'always'`), so the colour is not
          load-bearing; green marks a rise and a fall stays in the primary ink rather
          than the red the feature-wide contrast sweep refuses. */}
      <span className={cn('font-mono tabular-nums', value >= 0 ? 'text-accent-green' : 'text-fg-primary')}>
        {signedReading(value, locale)}
      </span>{' '}
      {t('surveys.next.trends.sinceWave', { wave })}
    </span>
  )
}
