import { useTranslation } from '../../../i18n'

export interface CompanyFiltersValue {
  search: string
}

interface CompanyFiltersProps {
  value: CompanyFiltersValue
  onChange: (value: CompanyFiltersValue) => void
}

export default function CompanyFilters({ value, onChange }: CompanyFiltersProps) {
  const { t } = useTranslation()

  return (
    <input
      type="search"
      placeholder={t('dashboard.searchCompanies')}
      value={value.search}
      onChange={(e) => onChange({ search: e.target.value })}
    />
  )
}
