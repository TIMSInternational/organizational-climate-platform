import { useState, type FormEvent } from 'react'
import RoleSelector from './RoleSelector'
import { useTranslation } from '../../../i18n'

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
  const { t } = useTranslation()
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
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      {allowCompanyAdminSetup && (
        <label>
          {t('common.type')}
          <select value={values.invitationType} onChange={(e) => setValues({ ...values, invitationType: e.target.value })}>
            <option value="employee_direct">{t('users.employee')}</option>
            <option value="company_admin_setup">{t('users.companyAdmin')}</option>
          </select>
        </label>
      )}
      <label>
        {t('users.email')}
        <input type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} required />
      </label>
      {values.invitationType === 'employee_direct' && (
        <label>
          {t('users.role')}
          <RoleSelector value={values.role} onChange={(role) => setValues({ ...values, role })} />
        </label>
      )}
      <button type="submit" disabled={submitting}>{submitting ? t('common.sending') : t('users.sendInvitation')}</button>
    </form>
  )
}
