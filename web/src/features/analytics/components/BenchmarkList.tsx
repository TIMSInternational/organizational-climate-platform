import type { BenchmarkListItem } from '../api/benchmarks'
import { isGlobalBenchmark } from '../benchmarkScope'
import { useTranslation } from '../../../i18n'
import { Badge, Checkbox, Table } from '../../../components/ui'

export interface BenchmarkListProps {
  benchmarks: BenchmarkListItem[]
  selectedIds: string[]
  onToggle: (id: string) => void
}

/**
 * The benchmark table, with the global/company distinction on every row.
 *
 * The scope badge is not decoration. `companyId === null` means the row is shared
 * with every tenant and is SuperAdmin-only to write (#207), so an admin looking at
 * a list of mixed rows has no way to predict which ones they can edit unless the
 * table says so. `secondary` for global and `default` for company keeps the
 * company's own rows the ones that stand out, since those are the rows an admin
 * can act on.
 *
 * Selection lives here as a checkbox column rather than as a separate "compare"
 * mode: the comparison and the trend are both driven by the same selection, so
 * one control feeds both and there is no state where the table shows one thing
 * and the panels below it another.
 */
export default function BenchmarkList({ benchmarks, selectedIds, onToggle }: BenchmarkListProps) {
  const { t } = useTranslation()

  return (
    <Table>
      <thead>
        <tr>
          <th></th>
          <th>{t('benchmarks.name')}</th>
          <th>{t('common.type')}</th>
          <th>{t('benchmarks.scope')}</th>
          <th>{t('benchmarks.qualityScore')}</th>
          <th>{t('common.status')}</th>
        </tr>
      </thead>
      <tbody>
        {benchmarks.map((benchmark) => {
          const global = isGlobalBenchmark(benchmark)
          return (
            <tr key={benchmark.id}>
              <td>
                <Checkbox
                  checked={selectedIds.includes(benchmark.id)}
                  onCheckedChange={() => onToggle(benchmark.id)}
                  aria-label={t('benchmarks.selectForComparison', { name: benchmark.name })}
                />
              </td>
              <td>{benchmark.name}</td>
              <td>{benchmark.type}</td>
              <td>
                <Badge variant={global ? 'secondary' : 'default'}>
                  {global ? t('benchmarks.global') : t('benchmarks.company')}
                </Badge>
              </td>
              <td>{benchmark.qualityScore}</td>
              <td>{benchmark.isActive ? t('common.active') : t('common.inactive')}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
