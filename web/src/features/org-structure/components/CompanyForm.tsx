import { useState, type FormEvent } from 'react'
import { CompanyValidation } from './companyValidation'

export interface CompanyFormValues {
  name: string
  emailDomain: string
  industry: string
  size: string
  country: string
  subscriptionTier: string
}

interface CompanyFormProps {
  initialValues?: Partial<CompanyFormValues>
  submitLabel: string
  onSubmit: (values: CompanyFormValues) => Promise<void>
}

const EMPTY_VALUES: CompanyFormValues = { name: '', emailDomain: '', industry: '', size: '', country: '', subscriptionTier: '' }

export default function CompanyForm({ initialValues, submitLabel, onSubmit }: CompanyFormProps) {
  const [values, setValues] = useState<CompanyFormValues>({ ...EMPTY_VALUES, ...initialValues })
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
        Domain
        <input value={values.emailDomain} onChange={(e) => setValues({ ...values, emailDomain: e.target.value })} required />
      </label>
      <label>
        Industry
        <input value={values.industry} onChange={(e) => setValues({ ...values, industry: e.target.value })} required />
      </label>
      <label>
        Size
        <select value={values.size} onChange={(e) => setValues({ ...values, size: e.target.value })} required>
          <option value="">Select size</option>
          {CompanyValidation.sizes.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </label>
      <label>
        Country
        <input value={values.country} onChange={(e) => setValues({ ...values, country: e.target.value })} required />
      </label>
      <label>
        Subscription tier
        <select value={values.subscriptionTier} onChange={(e) => setValues({ ...values, subscriptionTier: e.target.value })}>
          <option value="">Default (basic)</option>
          {CompanyValidation.subscriptionTiers.map((tier) => (
            <option key={tier} value={tier}>{tier}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
