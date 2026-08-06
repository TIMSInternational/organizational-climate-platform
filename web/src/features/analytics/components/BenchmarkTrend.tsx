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
 * The delta column is signed and rendered with an explicit sign, so a reader can
 * tell a fall from a rise without inferring it from two adjacent numbers. It is
 * deliberately not coloured green/red: whether a metric going up is good depends
 * entirely on the metric (absenteeism up is bad, engagement up is good), and the
 * API carries nothing that says which this is.
 */
export default function BenchmarkTrend({ chain }: { chain: Benchmark[] }) {
  const { t, locale } = useTranslation()
  const series = buildTrend(chain)
  const periods = [...chain].reverse()

  return (
    <section>
      <h2>{t('benchmarks.trend')}</h2>
      <Table>
        <thead>
          <tr>
            <th>{t('benchmarks.metricName')}</th>
            {periods.map((period) => (
              <th key={period.id}>{period.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => (
            <tr key={entry.metricName}>
              <td>{entry.metricName}</td>
              {entry.points.map((point) => (
                <td key={point.benchmarkId}>
                  {point.value === null ? (
                    t('benchmarks.notRecorded')
                  ) : (
                    <>
                      {`${formatMetric(point.value, { kind: 'number' }, locale)} ${point.unit ?? ''}`.trim()}
                      {point.delta !== null && (
                        <>
                          {' '}
                          <span className="text-fg-secondary">
                            {`${point.delta >= 0 ? '+' : '−'}${formatMetric(Math.abs(point.delta), { kind: 'number' }, locale)}`}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}
