import type { BenchmarkListItem } from '../api/benchmarks'
import { isGlobalBenchmark } from '../benchmarkScope'
import { QUALITY_SCORE_FORMAT } from '../benchmarkReadings'
import { useTranslation } from '../../../i18n'
import { Badge, Checkbox, EmptyState, Table } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

export interface BenchmarkListProps {
  benchmarks: readonly BenchmarkListItem[]
  /**
   * Selection is optional so the analytics dashboard (#94) can render this as a
   * plain read-only table while the benchmarks page (#95) drives comparison from
   * it. Omitting both hides the checkbox column entirely rather than rendering
   * inert controls.
   */
  selectedIds?: readonly string[]
  onToggle?: (id: string) => void
}

/**
 * The benchmark table, with the global/company distinction on every row.
 *
 * The scope badge is not decoration. `companyId === null` means the row is shared
 * with every tenant and is SuperAdmin-only to write (`CanWriteBenchmark`, #207), so
 * an admin looking at a list of mixed rows has no way to predict which ones they can
 * edit unless the table says so. It is the whole reason #93 modelled the field as
 * `string | null`.
 *
 * `secondary` and `outline` specifically: they are the only two badge variants that
 * clear WCAG AA in BOTH themes. See the measured table in
 * features/reports/components/ReportList.tsx and the guard in
 * src/styles/badgeVariantContrast.test.ts. A light-mode-only contrast failure is this
 * project's documented recurring blind spot (#80), so do not swap in `default` here
 * because it looks better in dark.
 *
 * Selection lives here as a checkbox column rather than as a separate "compare" mode:
 * the comparison and the trend are both driven by the same selection, so one control
 * feeds both and there is no state where the table shows one thing and the panels
 * below it another.
 */
export default function BenchmarkList({ benchmarks, selectedIds, onToggle }: BenchmarkListProps) {
  const { t, locale } = useTranslation()
  const selectable = onToggle !== undefined

  if (benchmarks.length === 0) {
    return (
      <EmptyState
        title={t('analytics.noBenchmarks')}
        description={t('analytics.noBenchmarksDescription')}
      />
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          {selectable ? <th></th> : null}
          <th>{t('analytics.benchmarkName')}</th>
          <th>{t('analytics.benchmarkType')}</th>
          <th>{t('analytics.category')}</th>
          <th>{t('analytics.scope')}</th>
          <th>{t('common.active')}</th>
          <th className="text-right">{t('analytics.qualityScore')}</th>
        </tr>
      </thead>
      <tbody>
        {benchmarks.map((benchmark) => {
          const global = isGlobalBenchmark(benchmark)
          return (
            <tr key={benchmark.id}>
              {selectable ? (
                <td>
                  <Checkbox
                    checked={selectedIds?.includes(benchmark.id) ?? false}
                    onCheckedChange={() => onToggle?.(benchmark.id)}
                    aria-label={t('benchmarks.selectForComparison', { name: benchmark.name })}
                  />
                </td>
              ) : null}
              <td>{benchmark.name}</td>
              <td>{benchmark.type}</td>
              <td>{benchmark.category}</td>
              <td>
                <Badge variant={global ? 'secondary' : 'outline'}>
                  {global ? t('analytics.scopeGlobal') : t('analytics.scopeCompany')}
                </Badge>
              </td>
              <td>{benchmark.isActive ? t('common.yes') : t('common.no')}</td>
              {/* Mono with tabular figures, like every other reading in the
                  product: a column of scores that do not line up digit for digit
                  cannot be scanned, which is the whole reason it is a column.
                  Tabular figures only line the column up if every score has the
                  same number of them, which is what `QUALITY_SCORE_FORMAT` is
                  for — and going through `formatMetric` is also what gives a
                  Spanish reader `0,92` rather than a raw JS `0.92`. */}
              <td className="text-right font-mono tabular-nums">
                {formatMetric(benchmark.qualityScore, QUALITY_SCORE_FORMAT, locale)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
