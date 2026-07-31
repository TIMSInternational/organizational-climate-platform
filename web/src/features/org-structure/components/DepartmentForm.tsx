import { useState, type FormEvent } from 'react'
import type { Department } from '../api/departments'

export interface DepartmentFormValues {
  name: string
  description: string
  parentDepartmentId: string
  isActive: boolean
}

interface DepartmentFormProps {
  departments: Department[]
  initialValues?: Partial<DepartmentFormValues>
  excludeIdFromParentOptions?: string
  submitLabel: string
  onSubmit: (values: DepartmentFormValues) => Promise<void>
}

const EMPTY_VALUES: DepartmentFormValues = { name: '', description: '', parentDepartmentId: '', isActive: true }

export default function DepartmentForm({ departments, initialValues, excludeIdFromParentOptions, submitLabel, onSubmit }: DepartmentFormProps) {
  const [values, setValues] = useState<DepartmentFormValues>({ ...EMPTY_VALUES, ...initialValues })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const parentOptions = departments.filter((d) => d.id !== excludeIdFromParentOptions)

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
        Name
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required maxLength={100} />
      </label>
      <label>
        Description
        <textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} maxLength={500} />
      </label>
      <label>
        Parent department
        <select value={values.parentDepartmentId} onChange={(e) => setValues({ ...values, parentDepartmentId: e.target.value })}>
          <option value="">None (top-level)</option>
          {parentOptions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} />
        Active
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
