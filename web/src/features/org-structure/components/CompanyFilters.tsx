export interface CompanyFiltersValue {
  search: string
}

interface CompanyFiltersProps {
  value: CompanyFiltersValue
  onChange: (value: CompanyFiltersValue) => void
}

export default function CompanyFilters({ value, onChange }: CompanyFiltersProps) {
  return (
    <input
      type="search"
      placeholder="Search by name, domain, or industry"
      value={value.search}
      onChange={(e) => onChange({ search: e.target.value })}
    />
  )
}
