import { Navigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { PageTopBar } from '../../../../components/layout'
import { KpiTile } from '../../../../components/charts'
import { Button, Chip, EmptyState, LoadingRegion, NetworkError } from '../../../../components/ui'
import { KpiRow } from '../../../dashboard/components/dashboardGrammar'
import { reading, signedReading } from '../../../dashboard/next/derive'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { WHOLE_COMPANY_KEY } from '../../api/climateTrends'
import DimensionTrendChart from './DimensionTrendChart'
import TrendsNumbersTable from './TrendsNumbersTable'
import {
  deltaSince,
  latestIndex,
  sharedAxisTicks,
  standing,
  standings,
  waveMean,
  type DimensionStanding,
  type Standing,
} from './derive'
import type { ClimateTrendsNextModel, TrendDimension, TrendWave } from './model'
import { useClimateTrendsModel } from './useClimateTrendsModel'

const STANDING_TONE: Record<Standing, 'good' | 'neutral' | 'critical'> = {
  above: 'good',
  on: 'neutral',
  below: 'critical',
}

/** The target rule's hex, as `DimensionTrendChart` draws it, for the legend's swatch. */
const TARGET_RULE = '#b9b6cc'

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
 * No export action, where the artboard draws one: `/surveys/climate-trends` has no
 * export endpoint (`SurveyClimateTrendsEndpoints.cs` maps one GET), and a button that
 * exists and then does nothing is the failure `viewerCapabilities.ts` describes.
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

/** "Pertenencia, Desarrollo y Seguridad psicológica" — the reader's own list grammar. */
function listOf(names: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names)
}

/** "ambas suben", "sube", "1 de 2 suben" — how the dimensions under the target last moved. */
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
  const { target, waves, dimensions } = model
  const targetText = reading(target, locale)
  const last = waves.length - 1
  const latestWave = waves[last]
  const latestMean = latestWave ? waveMean(dimensions, last) : null
  // The climate average's moves: against the wave before, and against the first once
  // there are three. Both ends must be readings, or there is no move to print.
  const moves = [last - 1, ...(last >= 2 ? [0] : [])].flatMap((index) => {
    const wave = waves[index]
    const mean = index >= 0 ? waveMean(dimensions, index) : null
    return wave && mean !== null && latestMean !== null ? [{ wave, delta: latestMean - mean }] : []
  })
  const judged = standings(dimensions, target)
  const above = judged.filter((entry) => entry.standing === 'above')
  const below = judged.filter((entry) => entry.standing === 'below').sort((a, b) => a.value - b.value)
  const rising = risingPhrase(below, t)
  const ticks = sharedAxisTicks(dimensions, target)
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

  return (
    <div>
      <PageTopBar
        eyebrow={model.companyName}
        title={t('surveys.next.trends.title')}
        description={t('surveys.next.trends.description', { target: targetText })}
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
                  label={t('surveys.next.trends.climateLabel', { wave: latestWave?.code ?? '' })}
                  value={latestMean}
                  format={{ kind: 'number', decimals: 2 }}
                  unit={t('surveys.next.trends.climateOf')}
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
                  label={t('surveys.next.trends.closedLabel')}
                  value={waves.length}
                  unit={waves.map((wave) => wave.code).join(' · ')}
                  locale={locale}
                  sub={
                    model.openWave ? (
                      <span data-slot="open-wave">
                        {t('surveys.next.trends.openEnters', {
                          wave: model.openWave.code,
                          date: calendarDay(Date.parse(model.openWave.closesAt), locale),
                        })}
                      </span>
                    ) : undefined
                  }
                />
                <KpiTile
                  label={t('surveys.next.trends.aboveLabel')}
                  value={above.length}
                  unit={t('surveys.next.trends.ofDimensions', { total: judged.length })}
                  locale={locale}
                  sub={
                    <span className={above.length > 0 ? 'text-accent-green-ink' : undefined}>
                      {above.length === 0
                        ? t('surveys.next.trends.none')
                        : listOf(above.map((entry) => entry.dimension.name), locale)}
                    </span>
                  }
                />
                <KpiTile
                  label={t('surveys.next.trends.belowLabel')}
                  value={below.length}
                  unit={t('surveys.next.trends.ofDimensions', { total: judged.length })}
                  locale={locale}
                  sub={
                    // `text-chip-critical-ink`, not the accent red: `respondContrast.test.ts`
                    // sweeps this whole feature for `text-accent-red` (4.43:1 on a card);
                    // the chip ink is the red measured to clear AA in both themes.
                    <span className={below.length > 0 ? 'text-chip-critical-ink' : undefined}>
                      {below.length === 0
                        ? t('surveys.next.trends.none')
                        : [
                            ...below.map((entry) => `${entry.dimension.name} ${reading(entry.value, locale)}`),
                            ...(rising ? [rising] : []),
                          ].join(' · ')}
                    </span>
                  }
                />
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
                        className={cn('h-6.5 rounded px-2.5 text-sm font-medium', selected && 'shadow-sm')}
                        onClick={() => onSelectGroup(group.key)}
                      >
                        {group.name ?? t('surveys.next.trends.wholeCompany')}
                      </Button>
                    )
                  })}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-3 text-sm text-fg-label">
                  <span className="inline-flex items-center gap-1.5">
                    <svg aria-hidden="true" width="18" height="2" viewBox="0 0 18 2" className="shrink-0">
                      <line x1="0" x2="18" y1="1" y2="1" stroke={TARGET_RULE} strokeDasharray="3 2" />
                    </svg>
                    {t('surveys.next.trends.legendTarget', { target: targetText })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full bg-accent-red" />
                    {t('surveys.next.trends.legendBelow')}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {dimensions.map((dimension) => (
                  <TrendCard
                    key={dimension.key}
                    dimension={dimension}
                    model={model}
                    ticks={ticks}
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
                target={target}
                floor={model.floor}
                caption={t('surveys.next.trends.tableHeading')}
              />
              <div className="flex flex-col gap-1 text-xs text-fg-label">
                {model.suppressedGroupCount > 0 && (
                  <p className="m-0">
                    {t('surveys.climateTrends.suppressedGroups', { count: model.suppressedGroupCount, threshold: model.floor })}
                  </p>
                )}
                <p className="m-0">{t('surveys.next.trends.floorNote', { floor: model.floor })}</p>
                <p className="m-0">{t('surveys.next.trends.targetNote', { target: targetText })}</p>
              </div>
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
  ticks,
  tickLabels,
}: {
  dimension: TrendDimension
  model: ClimateTrendsNextModel
  ticks: readonly number[]
  tickLabels: readonly string[]
}) {
  const { t, locale } = useTranslation()
  const { target, waves } = model
  const last = latestIndex(dimension.values)
  const value = last === -1 ? null : (dimension.values[last] ?? null)
  const stand = value === null ? null : standing(value, target)
  const sincePrevious = last > 0 ? deltaSince(dimension.values, last - 1) : null
  const sinceFirst = last > 1 ? deltaSince(dimension.values, 0) : null
  const previousWave: TrendWave | undefined = last > 0 ? waves[last - 1] : undefined
  const firstWave: TrendWave | undefined = waves[0]
  const targetText = reading(target, locale)

  return (
    <div
      data-slot="trend-card"
      data-dimension={dimension.key}
      data-standing={stand ?? 'withheld'}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-line-default bg-surface-card px-4 pt-3.5 pb-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-base font-semibold text-fg-primary">{dimension.name}</span>
        {stand && <Chip tone={STANDING_TONE[stand]} label={t(`surveys.next.trends.standing.${stand}`)} />}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-2xl tabular-nums text-fg-primary">
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
        target={target}
        ticks={ticks}
        labels={tickLabels}
        format={(reading_) => reading(reading_, locale)}
        withheldText={t('surveys.next.trends.withheld')}
        targetText={t('surveys.next.trends.legendTarget', { target: targetText })}
        label={t('surveys.next.trends.chartLabel', {
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
          target: targetText,
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
