import type { BenchmarkListItem } from '../api/benchmarks'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'

interface BenchmarkListProps {
  benchmarks: readonly BenchmarkListItem[]
}

export default function BenchmarkList({ benchmarks }: BenchmarkListProps) {
  const { t } = useTranslation()

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
          <th>{t('analytics.benchmarkName')}</th>
          <th>{t('analytics.benchmarkType')}</th>
          <th>{t('analytics.category')}</th>
          <th>{t('analytics.scope')}</th>
          <th>{t('common.active')}</th>
          <th>{t('analytics.qualityScore')}</th>
        </tr>
      </thead>
      <tbody>
        {benchmarks.map((benchmark) => (
          <tr key={benchmark.id}>
            <td>{benchmark.name}</td>
            <td>{benchmark.type}</td>
            <td>{benchmark.category}</td>
            <td>
              {/* `companyId === null` is a GLOBAL benchmark: every tenant reads it,
                  only a SuperAdmin may write it (`CanWriteBenchmark`). Showing the
                  distinction is the whole reason #93 modelled it as `string | null`
                  -- without it the row looks editable to a CompanyAdmin who would
                  be 403'd.

                  `secondary` and `outline` specifically: they are the only two badge
                  variants that clear WCAG AA in BOTH themes. See the measured table in
                  features/reports/components/ReportList.tsx, and the guard in
                  src/styles/badgeVariantContrast.test.ts. */}
              <Badge variant={benchmark.companyId === null ? 'secondary' : 'outline'}>
                {benchmark.companyId === null
                  ? t('analytics.scopeGlobal')
                  : t('analytics.scopeCompany')}
              </Badge>
            </td>
            <td>{benchmark.isActive ? t('common.yes') : t('common.no')}</td>
            <td>{benchmark.qualityScore}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
