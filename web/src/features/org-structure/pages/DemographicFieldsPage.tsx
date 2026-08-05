import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { listDemographicFields, createDemographicField, updateDemographicField, type DemographicField } from '../api/demographicFields'
import DemographicFieldList from '../components/DemographicFieldList'
import DemographicFieldForm, { type DemographicFieldFormValues } from '../components/DemographicFieldForm'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'

export default function DemographicFieldsPage() {
  const { t } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [fields, setFields] = useState<DemographicField[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<DemographicField | null>(null)
  const [creating, setCreating] = useState(false)

  async function reload() {
    if (!companyId) return
    setError(null)
    try {
      const result = await listDemographicFields(baseUrl, companyId)
      setFields(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  useEffect(() => {
    reload()
  }, [companyId])

  function parseOptions(optionsText: string): string[] | undefined {
    const trimmed = optionsText.split(',').map((o) => o.trim()).filter(Boolean)
    return trimmed.length > 0 ? trimmed : undefined
  }

  async function handleCreate(values: DemographicFieldFormValues) {
    if (!companyId) return
    await createDemographicField(baseUrl, {
      companyId,
      field: values.field,
      label: values.label,
      type: values.type,
      options: parseOptions(values.optionsText),
      required: values.required,
      order: values.order,
    })
    setCreating(false)
    await reload()
  }

  async function handleUpdate(values: DemographicFieldFormValues) {
    if (!editingField) return
    await updateDemographicField(baseUrl, editingField.id, {
      label: values.label,
      options: parseOptions(values.optionsText),
      required: values.required,
      order: values.order,
      isActive: values.isActive,
    })
    setEditingField(null)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.demographicFields')}
        breadcrumbs={[
          { label: t('navigation.companySettings'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.demographicFields') },
        ]}
        actions={
          <button onClick={() => setCreating((v) => !v)}>
            {creating ? t('common.cancel') : t('common.newField')}
          </button>
        }
      />
      {creating && (
        <DemographicFieldForm submitLabel={t('common.createField')} onSubmit={handleCreate} />
      )}
      {editingField && (
        <DemographicFieldForm
          key={editingField.id}
          initialValues={editingField}
          submitLabel={t('common.saveField')}
          onSubmit={handleUpdate}
        />
      )}
      <DemographicFieldList fields={fields} onEdit={setEditingField} />
    </div>
  )
}
