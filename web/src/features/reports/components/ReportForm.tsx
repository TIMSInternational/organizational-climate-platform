import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from '../../../i18n'
import { Button, Input, Label, Textarea } from '../../../components/ui'
import { REPORT_FORMATS } from '../api/reports'
import { describeApiError } from '../../../api/describeApiError'

export interface ReportFormValues {
  title: string
  description: string
  type: string
  format: string
  /** The one survey the report covers, or `''` for every survey of the company. */
  surveyId: string
}

/** A survey the report can be about — the company's distributed ones, oldest first. */
export interface ReportSurveyChoice {
  id: string
  title: string | null
}

/**
 * `type` is free text on the wire — `CreateReportRequest` does not validate it and nothing
 * downstream branches on it. Offering a fixed list anyway keeps the values consistent enough
 * to group and filter on later; a free-text box would give one company "Summary", "summary"
 * and "SUMMARY".
 *
 * `format` is NOT free text any more. `ReportEndpoints.CreateAsync` answers 400 for anything
 * `ReportFormats.Normalise` refuses, because `DownloadAsync` now renders the column and a
 * stored value is a promise the download has to keep. The list therefore comes from
 * `REPORT_FORMATS` in the api module, which mirrors `ReportFormats.Supported` — so the
 * dropdown cannot offer a value the server will reject.
 *
 * **`excel` is gone from this list**, and that is the one visible consequence of the change.
 * It was offered here for a year and never produced a spreadsheet; there is no xlsx writer in
 * the API's solution. See `docs/decisions/report-rendering.md`. `ReportList` still ships a
 * label for it, because rows created before the validation still say `excel`.
 */
const TYPES = ['summary', 'detailed', 'comparison', 'executive'] as const

const EMPTY_VALUES: ReportFormValues = {
  title: '',
  description: '',
  type: 'summary',
  format: 'pdf',
  surveyId: '',
}

interface ReportFormProps {
  onSubmit: (values: ReportFormValues) => Promise<void>
  /**
   * The company's surveys. Offered when given: without a choice, every report and every share
   * link covered ALL of a company's surveys in one document -- ESPH's Clima, Teletrabajo and
   * Contraloría mixed together (docs/audits/2026-11-08-operator-ui-walkthrough.md, B3).
   */
  surveys?: readonly ReportSurveyChoice[]
}

export default function ReportForm({ onSubmit, surveys }: ReportFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<ReportFormValues>(EMPTY_VALUES)
  // The most recent survey is the likeliest subject, so it is chosen until somebody chooses —
  // "Todas" included, which then stays chosen.
  const [surveyTouched, setSurveyTouched] = useState(false)
  const latest = surveys && surveys.length > 0 ? surveys[surveys.length - 1].id : ''
  useEffect(() => {
    if (!surveyTouched && latest) setValues((current) => (current.surveyId === '' ? { ...current, surveyId: latest } : current))
  }, [latest, surveyTouched])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues({ ...EMPTY_VALUES, surveyId: latest })
      setSurveyTouched(false)
    } catch (err) {
      setError(describeApiError(err, t))
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

      {surveys && surveys.length > 0 ? (
        <div>
          <Label htmlFor="report-survey">{t('reports.survey')}</Label>
          <select
            id="report-survey"
            value={values.surveyId}
            aria-describedby="report-survey-help"
            onChange={(event) => {
              setSurveyTouched(true)
              setValues({ ...values, surveyId: event.target.value })
            }}
          >
            {surveys.map((survey) => (
              <option key={survey.id} value={survey.id}>
                {survey.title ?? t('surveys.next.statusWorkbook.untitled')}
              </option>
            ))}
            <option value="">{t('reports.allSurveys')}</option>
          </select>
          <p id="report-survey-help" className="m-0 mt-1 text-xs text-fg-secondary">
            {t('reports.surveyHelp')}
          </p>
        </div>
      ) : null}

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
          {REPORT_FORMATS.map((format) => (
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
