import { useTranslation } from '../../../i18n'
import { Input } from '../../../components/ui'

export interface UserFiltersValue {
  search: string
}

interface UserFiltersProps {
  value: UserFiltersValue
  onChange: (value: UserFiltersValue) => void
}

/**
 * The user listing's one filter.
 *
 * `Input` from `ui/`, not a bare `<input>`. The bare element takes the browser's
 * default `size` — about 20 characters, ~177px — which neither grows nor shrinks:
 * rendered at 320px the placeholder was cut mid-word ("Search by name o"), and on a
 * wide monitor the field sat marooned at 177px in a panel several times that.
 * `w-full` with a cap gives it the panel's width up to a sensible reading size,
 * which is the same treatment `MicroclimateFilters` already uses.
 */
export default function UserFilters({ value, onChange }: UserFiltersProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-panel-gap w-full max-w-sm">
      <Input
        type="search"
        aria-label={t('users.searchByNameOrEmail')}
        placeholder={t('users.searchByNameOrEmail')}
        value={value.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
    </div>
  )
}
