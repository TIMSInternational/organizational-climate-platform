import type { Benchmark } from '../api/benchmarks'
import { buildTrend } from '../benchmarkAnalysis'
import { useTranslation } from '../../../i18n'
import { Table } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

/**
 * Metric movement across a benchmark's prior-period chain.
 *
 * "Trends" on this page means the chain of `priorPeriodBenchmarkId` links, which
 * is the only notion of time the benchmark API actually models — a benchmark has
 * no period field, only a pointer at the benchmark that preceded it. So a period
 * is labelled with its benchmark's *name*, not a date, because a date would have
 * to be invented.
 *
 * ## Every reading is mono with tabular figures
 *
 * The value, its unit and the change, in every period column. Before this rewrite
 * the whole table was in the sans face — "70 pts", "74 pts +4" — sitting a few
 * hundred pixels under a comparison that sets every one of its readings in mono.
 * That is the one typographic rule the product rests on, and a period column is
 * exactly the case tabular figures exist for: the same metric read at two dates,
 * stacked, meant to be differenced by eye.
 *
 * The metric *name* stays sans. It is a word, not a reading.
 *
 * ## The delta is signed, and deliberately not coloured
 *
 * It carries an explicit sign, so a reader can tell a fall from a rise without
 * inferring it from two adjacent numbers. It is not painted green/red: whether a
 * metric going up is good depends entirely on the metric (absenteeism up is bad,
 * engagement up is good), and the API carries nothing that says which this is.
 * `BenchmarkComparison` makes the same call on the same data for the same reason.
 * It sits on its own line under the value rather than beside it, so the value
 * column stays a column of like readings that line up.
 */
export default function BenchmarkTrend({ chain }: { chain: Benchmark[] }) {
  const { t, locale } = useTranslation()
  const series = buildTrend(chain)
  const periods = [...chain].reverse()

  return (
    <section className="rounded-lg border border-line-light bg-surface-icon-box p-panel">
      <p className="mb-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
        {t('benchmarks.priorPeriods')}
      </p>
      <h2 className="mt-1 mb-inline text-xl">{t('benchmarks.trend')}</h2>

      <div className="rounded-lg border border-line-light bg-surface-panel p-card">
        <Table>
          <thead>
            <tr>
              <th>{t('benchmarks.metricName')}</th>
              {periods.map((period) => (
                <th key={period.id} className="text-right">
                  {period.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((entry) => (
              <tr key={entry.metricName}>
                <td>{entry.metricName}</td>
                {entry.points.map((point) => (
                  <td key={point.benchmarkId} className="text-right">
                    {point.value === null ? (
                      <span className="text-fg-tertiary">{t('benchmarks.notRecorded')}</span>
                    ) : (
                      <>
                        <div className="font-mono text-base font-semibold tabular-nums">
                          {`${formatMetric(point.value, { kind: 'number' }, locale)} ${point.unit ?? ''}`.trim()}
                        </div>
                        {point.delta !== null && (
                          <div className="font-mono text-xs tabular-nums text-fg-secondary">
                            {`${point.delta >= 0 ? '+' : '−'}${formatMetric(Math.abs(point.delta), { kind: 'number' }, locale)}`}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </section>
  )
}
