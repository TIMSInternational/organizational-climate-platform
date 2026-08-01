export interface MicroclimateFiltersValue {
  status: string
}

const STATUSES = ['', 'draft', 'active', 'closed']

export default function MicroclimateFilters({ value, onChange }: { value: MicroclimateFiltersValue; onChange: (value: MicroclimateFiltersValue) => void }) {
  return (
    <select value={value.status} onChange={(e) => onChange({ status: e.target.value })}>
      {STATUSES.map((status) => (
        <option key={status} value={status}>{status || 'All statuses'}</option>
      ))}
    </select>
  )
}
