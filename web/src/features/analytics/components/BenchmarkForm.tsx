import { useState, type FormEvent } from 'react'
import type { Benchmark } from '../api/benchmarks'
import { useTranslation } from '../../../i18n'

export interface BenchmarkFormValues {
  name: string
  description: string
  type: string
  category: string
  source: string
  industry: string
  companySize: string
  region: string
}

export interface BenchmarkFormProps {
  /**
   * `create` shows every field; `edit` hides `type`, `category` and `source`.
   *
   * That is not a styling choice — `UpdateBenchmarkRequest` on the API does not
   * carry those three, and `UpdateAsync` never assigns them. Rendering them in
   * edit mode would show an admin a field they can change, accept the change, and
   * discard it silently on save.
   */
  variant: 'create' | 'edit'
  initialValues?: Partial<Benchmark>
  submitLabel: string
  onSubmit: (values: BenchmarkFormValues) => Promise<void>
}

export default function BenchmarkForm({ variant, initialValues, submitLabel, onSubmit }: BenchmarkFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<BenchmarkFormValues>({
    name: initialValues?.name ?? '',
    description: initialValues?.description ?? '',
    type: initialValues?.type ?? '',
    category: initialValues?.category ?? '',
    source: initialValues?.source ?? '',
    industry: initialValues?.industry ?? '',
    companySize: initialValues?.companySize ?? '',
    region: initialValues?.region ?? '',
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
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('benchmarks.name')}
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required />
      </label>
      <label>
        {t('benchmarks.benchmarkDescription')}
        <input value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} required />
      </label>
      {variant === 'create' && (
        <>
          <label>
            {t('common.type')}
            <input value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value })} required />
          </label>
          <label>
            {t('benchmarks.category')}
            <input value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })} required />
          </label>
          <label>
            {t('benchmarks.source')}
            <input value={values.source} onChange={(e) => setValues({ ...values, source: e.target.value })} required />
          </label>
        </>
      )}
      <label>
        {t('benchmarks.industry')}
        <input value={values.industry} onChange={(e) => setValues({ ...values, industry: e.target.value })} />
      </label>
      <label>
        {t('benchmarks.companySize')}
        <input value={values.companySize} onChange={(e) => setValues({ ...values, companySize: e.target.value })} />
      </label>
      <label>
        {t('benchmarks.region')}
        <input value={values.region} onChange={(e) => setValues({ ...values, region: e.target.value })} />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? t('common.saving') : submitLabel}
      </button>
    </form>
  )
}
