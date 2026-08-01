export interface UserFiltersValue {
  search: string
}

interface UserFiltersProps {
  value: UserFiltersValue
  onChange: (value: UserFiltersValue) => void
}

export default function UserFilters({ value, onChange }: UserFiltersProps) {
  return (
    <input
      type="search"
      placeholder="Search by name or email"
      value={value.search}
      onChange={(e) => onChange({ search: e.target.value })}
    />
  )
}
