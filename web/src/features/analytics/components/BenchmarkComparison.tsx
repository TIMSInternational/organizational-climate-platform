import type { Benchmark } from '../api/benchmarks'
import { buildComparison } from '../benchmarkAnalysis'
import { isGlobalBenchmark } from '../benchmarkScope'
import { useTranslation } from '../../../i18n'
import { Badge, Table } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

/**
 * Metric-by-benchmark matrix for two or more selected benchmarks.
 *
 * The scope badge repeats in the column header rather than only in the list
 * above. Whether the number you are measuring yourself against is your own
 * company's figure or a shared global one changes what the comparison *means*,
 * and by the time a reader has scrolled to this table the list's badges are off
 * screen.
 *
 * Numbers go through `formatMetric` with the active locale, so 1234.5 reads
 * `1,234.5` in English and `1.234,5` in Spanish. The unit is appended rather than
 * folded into the format because `BenchmarkMetric.Unit` is a free string on the
 * API — it can be `%`, `days`, or anything an admin typed — and `Intl` has no
 * meaningful handling for that.
 */
export default function BenchmarkComparison({ benchmarks }: { benchmarks: Benchmark[] }) {
  const { t, locale } = useTranslation()
  const rows = buildComparison(benchmarks)

  return (
    <section>
      <h2>{t('benchmarks.comparison')}</h2>
      <Table>
        <thead>
          <tr>
            <th>{t('benchmarks.metricName')}</th>
            {benchmarks.map((benchmark) => (
              <th key={benchmark.id}>
                {benchmark.name}{' '}
                <Badge variant={isGlobalBenchmark(benchmark) ? 'secondary' : 'default'}>
                  {isGlobalBenchmark(benchmark) ? t('benchmarks.global') : t('benchmarks.company')}
                </Badge>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metricName}>
              <td>
                {row.metricName}
                {row.unitsDiffer && (
                  <>
                    {' '}
                    <Badge variant="warning" title={t('benchmarks.unitsDifferHint')}>
                      {t('benchmarks.unitsDiffer')}
                    </Badge>
                  </>
                )}
              </td>
              {row.cells.map((cell) => (
                <td key={cell.benchmarkId}>
                  {cell.value === null
                    ? t('benchmarks.notRecorded')
                    : `${formatMetric(cell.value, { kind: 'number' }, locale)} ${cell.unit ?? ''}`.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}
