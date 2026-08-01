import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listDemographicFields, createDemographicField, updateDemographicField, type DemographicField } from '../api/demographicFields'
import DemographicFieldList from '../components/DemographicFieldList'
import DemographicFieldForm, { type DemographicFieldFormValues } from '../components/DemographicFieldForm'

export default function DemographicFieldsPage() {
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
      setError(err instanceof Error ? err.message : 'Failed to load demographic fields')
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
      <h1>Demographic fields</h1>
      <button onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'New field'}</button>
      {creating && <DemographicFieldForm submitLabel="Create field" onSubmit={handleCreate} />}
      {editingField && (
        <DemographicFieldForm key={editingField.id} initialValues={editingField} submitLabel="Save field" onSubmit={handleUpdate} />
      )}
      <DemographicFieldList fields={fields} onEdit={setEditingField} />
    </div>
  )
}
