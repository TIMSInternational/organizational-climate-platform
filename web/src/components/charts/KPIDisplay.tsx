import { useTranslation } from '../../i18n'
import { Card, CardContent } from '../ui/card'
import { Progress } from '../ui/progress'
import Counter from './Counter'
import { changeDirection, deltaFraction, formatMetric, type MetricFormat } from './formatMetric'

export interface Kpi {
  /** Stable identity, used as the React key. */
  id: string
  /** Already-translated label. This never translates its own copy. */
  label: string
  value: number
  /** How the number reads. Defaults to a plain localised number. */
  format?: MetricFormat
  /** The value this is measured against, if there is one. */
  target?: number
  /** The previous period's value, for the change indicator. */
  previousValue?: number
  /**
   * Whether a rise is good news. Defaults to true.
   *
   * Set false for a metric where up is bad — attrition, absenteeism, time to
   * hire. Legacy hardcoded `trend === 'up' ? 'success' : 'destructive'`, which
   * paints rising attrition green.
   */
  higherIsBetter?: boolean
}

interface KPIDisplayProps {
  kpis: readonly Kpi[]
  /** Already-translated section heading. */
  title?: string
  columns?: 1 | 2 | 3 | 4
  /** BCP-47 locale. Defaults to the document's language. */
  locale?: string
  isLoading?: boolean
}

const COLUMN_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
}

/**
 * A row of headline numbers — the summary band at the top of a dashboard.
 *
 * `Counter` is one hero number; this is the set of them, with the context that
 * makes a number mean something: what it is measured against, and which way it
 * moved. Each card delegates its value to `Counter`, so the count-up,
 * `prefers-reduced-motion` handling and the sr-only settled value are shared
 * rather than reimplemented (legacy had a *second* `AnimatedCounter` defined
 * inside `KPIDisplay.tsx`, separate from `charts/AnimatedCounter.tsx`, with
 * different behaviour).
 *
 * ## What was dropped from the legacy component, and why
 *
 * **The per-KPI colour prop** (`color: 'blue' | 'green' | 'yellow' | ...`). It let
 * the caller tint a card any of six ways, four of which are the reserved status
 * colours — so "engagement" could be green and "attrition" could be green, and
 * green stopped meaning anything. Colour here is derived from the data instead:
 * only the change indicator is coloured, and only because up-versus-down against
 * `higherIsBetter` genuinely *is* a judgement.
 *
 * **The `icon` prop.** A per-KPI icon from a fixed map of five
 * (`users`/`target`/`calendar`/...) decorated the card without adding
 * information; every card got `Target` by default, so the icon told the reader
 * nothing about which KPI they were looking at.
 *
 * **The second, undocumented single-KPI API.** Legacy `KPIDisplay` branched on
 * `props.value !== undefined && props.icon` into a completely different component
 * (`SimpleKPICard`) with its own colour map and no target or trend support. One
 * component, one contract; a single KPI is a one-element array.
 */
export default function KPIDisplay({
  kpis,
  title,
  columns = 3,
  locale,
  isLoading = false,
}: KPIDisplayProps) {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-4">
      {title ? <h3>{title}</h3> : null}

      {isLoading ? (
        <div
          role="status"
          aria-label={t('charts.loadingChart')}
          className={`grid gap-4 ${COLUMN_CLASSES[columns]}`}
        >
          {Array.from({ length: columns }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-lg border border-line-default bg-surface-icon-box" />
          ))}
        </div>
      ) : kpis.length === 0 ? (
        <p role="status" className="text-fg-secondary">
          {t('charts.noData')}
        </p>
      ) : (
        <div className={`grid gap-4 ${COLUMN_CLASSES[columns]}`}>
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} locale={locale} />
          ))}
        </div>
      )}
    </section>
  )
}

function KpiCard({ kpi, locale }: { kpi: Kpi; locale?: string }) {
  const format: MetricFormat = kpi.format ?? { kind: 'number' }
  const render = (value: number) => formatMetric(value, format, locale)

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <h4 className="text-sm font-medium text-fg-secondary">{kpi.label}</h4>

        <Counter value={kpi.value} formatValue={render} locale={locale} />

        {kpi.target !== undefined ? (
          <TargetProgress kpi={kpi} render={render} />
        ) : null}

        {kpi.previousValue !== undefined ? (
          <Change kpi={kpi} previous={kpi.previousValue} render={render} locale={locale} />
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Progress towards the target.
 *
 * Two things legacy got wrong here. `kpi.target ? ... : 100` treats a target of
 * **0** as "no target" and shows a full bar, because 0 is falsy — and 0 is a
 * legitimate target for a metric you want to eliminate. And
 * `Math.min((value / target) * 100, 100)` clamped the *displayed percentage*, so
 * beating the target by 40% was indistinguishable from exactly meeting it. Here
 * the bar fills to 100% (it cannot draw past its own end) while the label states
 * the true figure, so overshoot is visible.
 */
function TargetProgress({ kpi, render }: { kpi: Kpi; render: (value: number) => string }) {
  const { t } = useTranslation()
  const target = kpi.target as number

  // A target of zero cannot be a denominator. "Reached" is then simply whether
  // the value got there.
  const attained = target === 0 ? (kpi.value <= 0 ? 100 : 0) : (kpi.value / target) * 100
  // Rounded before it reaches the bar. Radix writes the value straight into
  // `aria-valuenow`, and an unrounded ratio lands there as
  // `aria-valuenow="91.76470588235294"` -- which a screen reader reads out digit
  // by digit. The precise figure, where it is wanted, is in the label.
  const clamped = Math.round(Math.max(0, Math.min(100, attained)))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-fg-tertiary">
        <span>{t('charts.targetLabel', { value: render(target) })}</span>
        <span>{formatPercent(attained)}</span>
      </div>
      <Progress
        value={clamped}
        aria-label={t('charts.progressToTarget', {
          value: render(kpi.value),
          target: render(target),
        })}
      />
    </div>
  )
}

/** Rounded to whole points — a progress figure to one decimal implies precision it lacks. */
function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

/**
 * Change against the previous period.
 *
 * The arrow states the *direction* and the colour states whether that direction is
 * good, which are not the same question — see `higherIsBetter`. The arrow is
 * accompanied by text rather than being the only signal, because a coloured
 * triangle alone is unreadable to a colourblind reader and silent to a screen
 * reader.
 */
function Change({
  kpi,
  previous,
  render,
  locale,
}: {
  kpi: Kpi
  previous: number
  render: (value: number) => string
  locale?: string
}) {
  const { t } = useTranslation()
  const direction = changeDirection(kpi.value, previous)
  const delta = deltaFraction(kpi.value, previous)
  const higherIsBetter = kpi.higherIsBetter ?? true

  const tone =
    direction === 'flat'
      ? 'text-fg-tertiary'
      : (direction === 'up') === higherIsBetter
        ? 'text-accent-green'
        : 'text-accent-red'

  const arrow =
    direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'

  // `deltaFraction` is null when the previous value was zero, where a percentage
  // is meaningless. Falling back to the absolute change keeps the card informative
  // instead of printing "Infinity%".
  const magnitude =
    delta === null
      ? render(Math.abs(kpi.value - previous))
      : formatMetric(Math.abs(delta) * 100, { kind: 'percentage', decimals: 1 }, locale)

  return (
    <p className="m-0 flex items-center gap-2 text-xs text-fg-tertiary">
      <span className={tone}>
        <span aria-hidden="true">{arrow}</span>{' '}
        {direction === 'flat' ? t('charts.changeFlat') : magnitude}
      </span>
      <span>{t('charts.previousValue', { value: render(previous) })}</span>
    </p>
  )
}
