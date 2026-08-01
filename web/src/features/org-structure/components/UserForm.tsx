import { useState, type FormEvent } from 'react'
import RoleSelector from './RoleSelector'
import type { User } from '../api/users'

export interface UserFormValues {
  name: string
  role: string
  isActive: boolean
}

interface UserFormProps {
  user: User
  canChangeRole: boolean
  onSubmit: (values: UserFormValues) => Promise<void>
}

export default function UserForm({ user, canChangeRole, onSubmit }: UserFormProps) {
  const [values, setValues] = useState<UserFormValues>({ name: user.name, role: user.role, isActive: user.isActive })
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
        Name
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required />
      </label>
      <label>
        Role
        <RoleSelector value={values.role} onChange={(role) => setValues({ ...values, role })} disabled={!canChangeRole} />
      </label>
      <label>
        <input type="checkbox" checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} />
        Active
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
