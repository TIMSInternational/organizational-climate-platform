import { useState, type FormEvent } from 'react'
import type { CompanySettingsData, CompanyBranding } from '../api/companySettings'
import { useTranslation } from '../../../i18n'

export interface CompanySettingsFormValues {
  surveyFrequency: string
  microclimateEnabled: boolean
  anonymousSurveys: boolean
  primaryColor: string
}

interface CompanySettingsFormProps {
  settings: CompanySettingsData
  branding: CompanyBranding
  onSubmit: (values: CompanySettingsFormValues) => Promise<void>
}

export default function CompanySettingsForm({ settings, branding, onSubmit }: CompanySettingsFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<CompanySettingsFormValues>({
    surveyFrequency: settings.surveyFrequency,
    microclimateEnabled: settings.microclimateEnabled,
    anonymousSurveys: settings.anonymousSurveys,
    primaryColor: branding.primaryColor,
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
        {t('dashboard.surveyFrequency')}
        <input value={values.surveyFrequency} onChange={(e) => setValues({ ...values, surveyFrequency: e.target.value })} />
      </label>
      <label>
        <input type="checkbox" checked={values.microclimateEnabled} onChange={(e) => setValues({ ...values, microclimateEnabled: e.target.checked })} />
        {t('dashboard.microclimatesEnabled')}
      </label>
      <label>
        <input type="checkbox" checked={values.anonymousSurveys} onChange={(e) => setValues({ ...values, anonymousSurveys: e.target.checked })} />
        {t('dashboard.anonymousSurveys')}
      </label>
      <label>
        {t('dashboard.primaryColor')}
        <input type="color" value={values.primaryColor} onChange={(e) => setValues({ ...values, primaryColor: e.target.value })} />
      </label>
      <button type="submit" disabled={submitting}>{submitting ? t('common.saving') : t('dashboard.saveSettings')}</button>
    </form>
  )
}
