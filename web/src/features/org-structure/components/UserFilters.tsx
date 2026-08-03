import { useTranslation } from '../../../i18n'

export interface UserFiltersValue {
  search: string
}

interface UserFiltersProps {
  value: UserFiltersValue
  onChange: (value: UserFiltersValue) => void
}

export default function UserFilters({ value, onChange }: UserFiltersProps) {
  const { t } = useTranslation()

  return (
    <input
      type="search"
      placeholder={t('users.searchByNameOrEmail')}
      value={value.search}
      onChange={(e) => onChange({ search: e.target.value })}
    />
  )
}
