import { useState, type FormEvent } from 'react'
import type { AddBenchmarkMetricInput, Benchmark, UpdateBenchmarkInput } from '../api/benchmarks'
import { isGlobalBenchmark } from '../benchmarkScope'
import { QUALITY_SCORE_FORMAT } from '../benchmarkReadings'
import BenchmarkForm, { type BenchmarkFormValues } from './BenchmarkForm'
import { useTranslation } from '../../../i18n'
import { Badge, Button, Table } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

export interface BenchmarkDetailPanelProps {
  benchmark: Benchmark
  /**
   * Whether this caller may write *this* benchmark — the result of
   * `canWriteBenchmark`, not a role check.
   *
   * A CompanyAdmin looking at a global benchmark reads `false` here while reading
   * `true` on the row above it, which is the whole reason this is a per-benchmark
   * prop rather than something the panel derives once from the session.
   */
  canWrite: boolean
  onUpdate: (input: UpdateBenchmarkInput) => Promise<void>
  onAddMetric: (input: AddBenchmarkMetricInput) => Promise<void>
}

/**
 * One benchmark in full: its attributes, its metrics, and — only when the caller
 * may actually write it — the edit and add-metric forms.
 *
 * ## Why this is a panel and not a `<dl>` on the page background
 *
 * This state is one click away from the comparison above it: ticking a single row
 * opens this instead of the cohort bars. Before this rewrite it was a bare
 * `<section>` — an unstyled sixteen-line label/value dump in which "Type" and
 * "internal" were set identically, a metrics table whose values were in the sans
 * face, and an unpanelled form directly on the page ground. That put two different
 * design languages on one screen a single click apart.
 *
 * So the panel wears the same shell as `InsightDetailPanel` — `rounded-lg border
 * border-line-light bg-surface-icon-box p-panel`, eyebrow, title, chips — and the
 * attributes are a grid of label-over-value cells, where the label is a 10px
 * tracked cap and the value is the reading. A label and its value can never again
 * be mistaken for each other.
 *
 * ## Every number here is mono with tabular figures
 *
 * The quality score, and every value, percentile and sample size in the metrics
 * table — three readings per metric row, so this panel alone is where most of the
 * numbers on the screen are. That is the one typographic rule the product rests
 * on, and the comparison directly above sets all of ITS readings in mono, so a
 * sans-face metrics table one click later is the same measurement in two different
 * voices. The metric *name* and the unit stay sans — they are words, not readings.
 *
 * `QUALITY_SCORE_FORMAT` fixes the score at two decimals rather than letting
 * `formatMetric`'s default cap it at one. The default printed a stored 0.92 as
 * "0.9", losing a digit off a number this panel exists to report, and left 0.9 and
 * 0.92 unable to line up in the list column beside it.
 *
 * ## When the caller may not write, the panel says why
 *
 * A global benchmark with no Edit button and no explanation reads as a missing
 * feature; "Global benchmarks are shared with every company. Only a platform
 * administrator can change them." reads as a rule, which is what it is.
 */
export default function BenchmarkDetailPanel({ benchmark, canWrite, onUpdate, onAddMetric }: BenchmarkDetailPanelProps) {
  const { t, locale } = useTranslation()
  const [editing, setEditing] = useState(false)
  const global = isGlobalBenchmark(benchmark)

  async function handleUpdate(values: BenchmarkFormValues) {
    await onUpdate({
      name: values.name,
      description: values.description,
      // Empty means "not set" on a nullable column, so send nothing rather than
      // an empty string the API would store and later render as a blank field.
      industry: values.industry || undefined,
      companySize: values.companySize || undefined,
      region: values.region || undefined,
    })
    setEditing(false)
  }

  /** Label over value. The label is a caption; the value is the record. */
  function attribute(label: string, value: string, reading = false) {
    return (
      <div>
        <dt className="text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
          {label}
        </dt>
        <dd
          className={
            reading
              ? 'mt-0.5 mb-0 font-mono text-base tabular-nums text-fg-primary'
              : 'mt-0.5 mb-0 text-base text-fg-primary'
          }
        >
          {value}
        </dd>
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-line-light bg-surface-icon-box p-panel">
      <p className="mb-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
        {t('benchmarks.selectedBenchmark')}
      </p>
      <h2 className="mt-1 mb-inline text-xl">{benchmark.name}</h2>

      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={global ? 'secondary' : 'outline'}>
          {global ? t('benchmarks.global') : t('benchmarks.company')}
        </Badge>
        {!canWrite && <Badge variant="secondary">{t('benchmarks.readOnlyGlobal')}</Badge>}
      </div>

      <p className="mt-inline mb-0 max-w-prose text-base text-fg-secondary">
        {benchmark.description}
      </p>

      {/* The record behind the row, as captioned cells rather than a stack of
          alternating lines. Two columns on a phone so a label and its value stay
          adjacent instead of a column of thirty-two lines. */}
      <dl className="mt-section grid grid-cols-2 gap-inline border-t border-line-light pt-inline sm:grid-cols-4">
        {attribute(t('common.type'), benchmark.type)}
        {attribute(t('benchmarks.category'), benchmark.category)}
        {attribute(t('benchmarks.source'), benchmark.source)}
        {attribute(t('benchmarks.validationStatus'), benchmark.validationStatus)}
        {attribute(t('benchmarks.industry'), benchmark.industry ?? t('benchmarks.notRecorded'))}
        {attribute(
          t('benchmarks.companySize'),
          benchmark.companySize ?? t('benchmarks.notRecorded'),
        )}
        {attribute(t('benchmarks.region'), benchmark.region ?? t('benchmarks.notRecorded'))}
        {attribute(
          t('benchmarks.qualityScore'),
          formatMetric(benchmark.qualityScore, QUALITY_SCORE_FORMAT, locale),
          true,
        )}
      </dl>

      {canWrite ? (
        <div className="mt-section">
          <Button variant="outline" onClick={() => setEditing((open) => !open)}>
            {editing ? t('common.cancel') : t('common.edit')}
          </Button>
          {editing && (
            <div className="mt-inline rounded-lg border border-line-light bg-surface-panel p-card">
              <BenchmarkForm
                variant="edit"
                initialValues={benchmark}
                submitLabel={t('common.save')}
                onSubmit={handleUpdate}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="mt-section mb-0 max-w-prose text-sm text-fg-tertiary">
          {t('benchmarks.globalScopeHint')}
        </p>
      )}

      <h3 className="mt-section mb-inline text-base">{t('benchmarks.metrics')}</h3>
      {benchmark.metrics.length === 0 ? (
        <p className="mb-0 text-sm text-fg-tertiary">{t('benchmarks.noMetrics')}</p>
      ) : (
        <div className="rounded-lg border border-line-light bg-surface-panel p-card">
          <Table>
            <thead>
              <tr>
                <th>{t('benchmarks.metricName')}</th>
                <th className="text-right">{t('common.value')}</th>
                <th>{t('benchmarks.unit')}</th>
                <th className="text-right">{t('benchmarks.percentile')}</th>
                <th className="text-right">{t('benchmarks.sampleSize')}</th>
              </tr>
            </thead>
            <tbody>
              {benchmark.metrics.map((metric) => (
                <tr key={metric.id}>
                  <td>{metric.metricName}</td>
                  {/* Right-aligned mono with tabular figures: a column of
                      readings that does not line up digit for digit cannot be
                      scanned, which is the whole reason it is a column. */}
                  <td className="text-right font-mono tabular-nums">
                    {formatMetric(metric.value, { kind: 'number' }, locale)}
                  </td>
                  <td className="text-fg-secondary">{metric.unit}</td>
                  <td className="text-right font-mono tabular-nums">
                    {metric.percentile === null
                      ? '—'
                      : formatMetric(metric.percentile, { kind: 'number' }, locale)}
                  </td>
                  <td className="text-right font-mono tabular-nums">
                    {metric.sampleSize === null
                      ? '—'
                      : formatMetric(metric.sampleSize, { kind: 'number' }, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {canWrite && <AddMetricForm onAddMetric={onAddMetric} />}
    </section>
  )
}

function AddMetricForm({ onAddMetric }: { onAddMetric: (input: AddBenchmarkMetricInput) => Promise<void> }) {
  const { t } = useTranslation()
  const [metricName, setMetricName] = useState('')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // `Number('')` is 0, so an empty box would post a real zero rather than
      // failing validation. `required` on the input is what keeps that from being
      // reachable; the parse stays explicit anyway.
      await onAddMetric({ metricName, value: Number(value), unit })
      setMetricName('')
      setValue('')
      setUnit('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-section rounded-lg border border-line-light bg-surface-panel p-card"
    >
      <h3 className="mb-inline text-base">{t('benchmarks.addMetric')}</h3>
      {error && (
        <p role="alert" className="mb-inline text-sm text-accent-red">
          {error}
        </p>
      )}
      {/* Three boxes on one line where there is room: they are one record, and a
          column of three full-width fields reads as three separate questions. */}
      <div className="flex flex-wrap items-end gap-inline">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm text-fg-secondary">
          {t('benchmarks.metricName')}
          <input value={metricName} onChange={(e) => setMetricName(e.target.value)} required />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm text-fg-secondary">
          {t('common.value')}
          <input
            type="number"
            step="any"
            className="font-mono tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm text-fg-secondary">
          {t('benchmarks.unit')}
          <input value={unit} onChange={(e) => setUnit(e.target.value)} required />
        </label>
        <Button type="submit" variant="outline" disabled={submitting}>
          {submitting ? t('common.saving') : t('benchmarks.addMetric')}
        </Button>
      </div>
    </form>
  )
}
