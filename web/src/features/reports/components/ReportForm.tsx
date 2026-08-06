import { useState, type FormEvent } from 'react'
import { useTranslation } from '../../../i18n'
import { Button, Input, Label, Textarea } from '../../../components/ui'

export interface ReportFormValues {
  title: string
  description: string
  type: string
  format: string
}

/**
 * `type` and `format` are free text on the wire — `CreateReportRequest` validates neither,
 * and nothing downstream branches on them, because rendering is stubbed. Offering a fixed
 * list anyway keeps the values consistent enough to group and filter on later; a free-text
 * box would give one company "PDF", "pdf" and "Pdf".
 */
const TYPES = ['summary', 'detailed', 'comparison', 'executive'] as const
const FORMATS = ['pdf', 'excel', 'csv'] as const

const EMPTY_VALUES: ReportFormValues = {
  title: '',
  description: '',
  type: 'summary',
  format: 'pdf',
}

interface ReportFormProps {
  onSubmit: (values: ReportFormValues) => Promise<void>
}

export default function ReportForm({ onSubmit }: ReportFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<ReportFormValues>(EMPTY_VALUES)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues(EMPTY_VALUES)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-inline">
      <div>
        <Label htmlFor="report-title">{t('reports.reportTitle')}</Label>
        <Input
          id="report-title"
          required
          value={values.title}
          onChange={(event) => setValues({ ...values, title: event.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="report-description">{t('actionPlans.description')}</Label>
        <Textarea
          id="report-description"
          value={values.description}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
      </div>

      {/* Native `<select>`, matching every other filter and form in `features/`.
          `index.css` styles it in both themes, and unlike the Radix `Select` it is
          driven by a real change event, so a test does not depend on pointer
          capture that happy-dom does not implement. */}
      <div>
        <Label htmlFor="report-type">{t('reports.type')}</Label>
        <select
          id="report-type"
          value={values.type}
          onChange={(event) => setValues({ ...values, type: event.target.value })}
        >
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`reports.type_${type}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="report-format">{t('reports.format')}</Label>
        <select
          id="report-format"
          value={values.format}
          onChange={(event) => setValues({ ...values, format: event.target.value })}
        >
          {FORMATS.map((format) => (
            <option key={format} value={format}>
              {t(`reports.format_${format}`)}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? t('common.creating') : t('reports.createReport')}
        </Button>
      </div>
    </form>
  )
}
