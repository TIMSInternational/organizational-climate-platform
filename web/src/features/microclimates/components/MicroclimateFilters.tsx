import { useTranslation } from '../../../i18n'
import { SelectField } from '../../../components/ui'
import { MICROCLIMATE_STATUSES, statusLabel } from '../microclimateVocabulary'

export interface MicroclimateFiltersValue {
  status: string
}

/**
 * The "no filter" option's value.
 *
 * Not `''`: Radix's `SelectItem` throws on an empty-string value, because it
 * reserves it for "nothing is selected" and needs the placeholder to be
 * distinguishable from a real choice. The empty string stays the *filter's* value —
 * that is what `MicroclimatesListPage` compares against — and this sentinel exists
 * only between the two.
 */
const ANY_STATUS = 'any'

/**
 * The listing's one filter.
 *
 * It used to be a bare `<select>` rendering the server's own status strings as its
 * option text, so a Spanish admin picked between "draft", "active" and "closed".
 * The vocabulary now goes through `statusLabel`, and the control is the `ui/`
 * primitive so it carries the same label wiring and focus treatment as every other
 * field in the product.
 */
export default function MicroclimateFilters({
  value,
  onChange,
}: {
  value: MicroclimateFiltersValue
  onChange: (value: MicroclimateFiltersValue) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="mb-panel-gap max-w-xs">
      <SelectField
        label={t('common.status')}
        value={value.status === '' ? ANY_STATUS : value.status}
        onChange={(status) => onChange({ status: status === ANY_STATUS ? '' : status })}
        options={[
          { value: ANY_STATUS, label: t('common.allStatuses') },
          ...MICROCLIMATE_STATUSES.map((status) => ({
            value: status,
            label: statusLabel(t, status),
          })),
        ]}
      />
    </div>
  )
}
