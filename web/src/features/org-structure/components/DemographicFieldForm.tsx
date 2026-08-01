import { useState, type FormEvent } from 'react'
import type { DemographicField } from '../api/demographicFields'

export interface DemographicFieldFormValues {
  field: string
  label: string
  type: string
  optionsText: string
  required: boolean
  order: number
}

interface DemographicFieldFormProps {
  initialValues?: Partial<DemographicField>
  submitLabel: string
  onSubmit: (values: DemographicFieldFormValues) => Promise<void>
}

const TYPES = ['select', 'text', 'number', 'date']

export default function DemographicFieldForm({ initialValues, submitLabel, onSubmit }: DemographicFieldFormProps) {
  const [values, setValues] = useState<DemographicFieldFormValues>({
    field: initialValues?.field ?? '',
    label: initialValues?.label ?? '',
    type: initialValues?.type ?? 'text',
    optionsText: (initialValues?.options ?? []).join(', '),
    required: initialValues?.required ?? false,
    order: initialValues?.order ?? 0,
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Field key
        <input value={values.field} onChange={(e) => setValues({ ...values, field: e.target.value })} required disabled={Boolean(initialValues?.field)} />
      </label>
      <label>
        Label
        <input value={values.label} onChange={(e) => setValues({ ...values, label: e.target.value })} required />
      </label>
      <label>
        Type
        <select value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value })} disabled={Boolean(initialValues?.field)}>
          {TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </label>
      {values.type === 'select' && (
        <label>
          Options (comma-separated)
          <input value={values.optionsText} onChange={(e) => setValues({ ...values, optionsText: e.target.value })} />
        </label>
      )}
      <label>
        <input type="checkbox" checked={values.required} onChange={(e) => setValues({ ...values, required: e.target.checked })} />
        Required
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
