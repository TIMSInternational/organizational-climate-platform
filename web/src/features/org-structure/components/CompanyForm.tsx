import { useState, type FormEvent } from 'react'
import { CompanyValidation } from './companyValidation'
import { useTranslation } from '../../../i18n'
import { describeApiError } from '../../../api/describeApiError'
import { sizeText } from '../next/super/labels'
import { countryNames } from '../next/super/countries'

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
  const { t, locale } = useTranslation()
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
      setError(describeApiError(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('departments.name')}
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required />
      </label>
      <label>
        {t('dashboard.domain')}
        <input
          value={values.emailDomain}
          onChange={(e) => setValues({ ...values, emailDomain: e.target.value })}
          required
          aria-describedby="company-domain-help"
        />
        {/* Said before it is typed: the domain decides where a self-registration lands, and it is
            unique on the platform (the PROCOMER script carried this warning; the form did not). */}
        <small id="company-domain-help">{t('superadmin.next.companies.domainHelp')}</small>
      </label>
      <label>
        {t('dashboard.industry')}
        <input value={values.industry} onChange={(e) => setValues({ ...values, industry: e.target.value })} required />
      </label>
      <label>
        {t('dashboard.size')}
        <select value={values.size} onChange={(e) => setValues({ ...values, size: e.target.value })} required>
          <option value="">{t('dashboard.selectSize')}</option>
          {CompanyValidation.sizes.map((size) => (
            <option key={size} value={size}>{sizeText(t, size) ?? size}</option>
          ))}
        </select>
      </label>
      <label>
        {t('dashboard.country')}
        {/* The same list the company's own page offers, so the two never disagree. */}
        <select value={values.country} onChange={(e) => setValues({ ...values, country: e.target.value })} required>
          <option value="">{t('dashboard.selectCountry')}</option>
          {countryNames(locale).map((country) => (
            <option key={country} value={country}>{country}</option>
          ))}
        </select>
      </label>
      <label>
        {t('dashboard.subscriptionTier')}
        <select value={values.subscriptionTier} onChange={(e) => setValues({ ...values, subscriptionTier: e.target.value })}>
          <option value="">{t('dashboard.defaultBasic')}</option>
          {CompanyValidation.subscriptionTiers.map((tier) => (
            <option key={tier} value={tier}>{tier}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={submitting}>{submitting ? t('common.saving') : submitLabel}</button>
    </form>
  )
}
