import type { DemographicField } from '../api/demographicFields'
import { useTranslation } from '../../../i18n'

export default function DemographicFieldList({ fields, onEdit }: { fields: DemographicField[]; onEdit: (field: DemographicField) => void }) {
  const { t } = useTranslation()

  if (fields.length === 0) {
    return <p>{t('users.noDemographicFieldsYet')}</p>
  }

  return (
    <table>
      <thead>
        <tr>
          {/* Field key is shown so an admin can see which keys are already taken --
              without it, a duplicate-key 409 (POST /admin/demographic-fields) gives
              no visual clue which of the fields below is the collision. */}
          <th>{t('common.key')}</th>
          <th>{t('common.label')}</th>
          <th>{t('common.type')}</th>
          <th>{t('common.required')}</th>
          <th>{t('common.active')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.id}>
            <td>{field.field}</td>
            <td>{field.label}</td>
            <td>{field.type}</td>
            <td>{field.required ? t('common.yes') : t('common.no')}</td>
            <td>{field.isActive ? t('common.yes') : t('common.no')}</td>
            <td><button onClick={() => onEdit(field)}>{t('common.edit')}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
