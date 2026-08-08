import type { DemographicField } from '../api/demographicFields'
import { useTranslation } from '../../../i18n'
import { Table, EmptyState } from '../../../components/ui'
import { Tags } from 'lucide-react'

export default function DemographicFieldList({ fields, onEdit }: { fields: DemographicField[]; onEdit: (field: DemographicField) => void }) {
  const { t } = useTranslation()

  if (fields.length === 0) {
    // A designed state rather than one sentence. A bare <p> in an otherwise empty
    // panel reads as a page that failed to load, not as "there is nothing here
    // yet" -- and it gave no clue what a demographic field is for or why anyone
    // would add one. No action is passed: the page's own "New field" button is
    // already in the header directly above this, and a second button would be two
    // controls for one job.
    return (
      <EmptyState
        fill
        icon={<Tags className="size-6" aria-hidden="true" />}
        title={t('users.noDemographicFieldsYet')}
        description={t('users.noDemographicFieldsDescription')}
      />
    )
  }

  return (
    <Table>
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
    </Table>
  )
}
