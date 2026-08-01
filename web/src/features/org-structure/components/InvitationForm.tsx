import { useState, type FormEvent } from 'react'
import RoleSelector from './RoleSelector'

export interface InvitationFormValues {
  invitationType: string
  email: string
  role: string
}

interface InvitationFormProps {
  allowCompanyAdminSetup: boolean
  onSubmit: (values: InvitationFormValues) => Promise<void>
}

export default function InvitationForm({ allowCompanyAdminSetup, onSubmit }: InvitationFormProps) {
  const [values, setValues] = useState<InvitationFormValues>({
    invitationType: 'employee_direct',
    email: '',
    role: 'employee',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues({ invitationType: 'employee_direct', email: '', role: 'employee' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      {allowCompanyAdminSetup && (
        <label>
          Type
          <select value={values.invitationType} onChange={(e) => setValues({ ...values, invitationType: e.target.value })}>
            <option value="employee_direct">Employee</option>
            <option value="company_admin_setup">Company admin</option>
          </select>
        </label>
      )}
      <label>
        Email
        <input type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} required />
      </label>
      {values.invitationType === 'employee_direct' && (
        <label>
          Role
          <RoleSelector value={values.role} onChange={(role) => setValues({ ...values, role })} />
        </label>
      )}
      <button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send invitation'}</button>
    </form>
  )
}
