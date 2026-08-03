import { useTranslation } from '../../../i18n'

export interface ActionPlanFiltersValue {
  status: string
}

interface ActionPlanFiltersProps {
  value: ActionPlanFiltersValue
  onChange: (value: ActionPlanFiltersValue) => void
}

const STATUSES = ['', 'not_started', 'in_progress', 'completed', 'overdue', 'cancelled']

export default function ActionPlanFilters({ value, onChange }: ActionPlanFiltersProps) {
  const { t } = useTranslation()

  return (
    <select value={value.status} onChange={(e) => onChange({ status: e.target.value })}>
      {STATUSES.map((status) => (
        <option key={status} value={status}>{status || t('common.allStatuses')}</option>
      ))}
    </select>
  )
}
