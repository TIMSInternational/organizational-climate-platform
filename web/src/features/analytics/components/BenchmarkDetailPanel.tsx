import { useState, type FormEvent } from 'react'
import type { AddBenchmarkMetricInput, Benchmark, UpdateBenchmarkInput } from '../api/benchmarks'
import { isGlobalBenchmark } from '../benchmarkScope'
import BenchmarkForm, { type BenchmarkFormValues } from './BenchmarkForm'
import { useTranslation } from '../../../i18n'
import { Badge, Table } from '../../../components/ui'
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
 * When the caller may not write, the panel says *why* rather than simply omitting
 * the buttons. A global benchmark with no Edit button and no explanation reads as
 * a missing feature; "Read only — global benchmarks are shared with every company
 * and only a platform administrator can change them" reads as a rule, which is
 * what it is.
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

  return (
    <section>
      <h2>{benchmark.name}</h2>
      <p>
        <Badge variant={global ? 'secondary' : 'default'}>
          {global ? t('benchmarks.global') : t('benchmarks.company')}
        </Badge>{' '}
        {!canWrite && <Badge variant="outline">{t('benchmarks.readOnlyGlobal')}</Badge>}
      </p>
      <p>{benchmark.description}</p>
      <dl>
        <dt>{t('common.type')}</dt>
        <dd>{benchmark.type}</dd>
        <dt>{t('benchmarks.category')}</dt>
        <dd>{benchmark.category}</dd>
        <dt>{t('benchmarks.source')}</dt>
        <dd>{benchmark.source}</dd>
        <dt>{t('benchmarks.industry')}</dt>
        <dd>{benchmark.industry ?? t('benchmarks.notRecorded')}</dd>
        <dt>{t('benchmarks.companySize')}</dt>
        <dd>{benchmark.companySize ?? t('benchmarks.notRecorded')}</dd>
        <dt>{t('benchmarks.region')}</dt>
        <dd>{benchmark.region ?? t('benchmarks.notRecorded')}</dd>
        <dt>{t('benchmarks.validationStatus')}</dt>
        <dd>{benchmark.validationStatus}</dd>
        <dt>{t('benchmarks.qualityScore')}</dt>
        <dd>{formatMetric(benchmark.qualityScore, { kind: 'number' }, locale)}</dd>
      </dl>

      {canWrite ? (
        <>
          <button onClick={() => setEditing((open) => !open)}>
            {editing ? t('common.cancel') : t('common.edit')}
          </button>
          {editing && (
            <BenchmarkForm
              variant="edit"
              initialValues={benchmark}
              submitLabel={t('common.save')}
              onSubmit={handleUpdate}
            />
          )}
        </>
      ) : (
        <p>{t('benchmarks.globalScopeHint')}</p>
      )}

      <h3>{t('benchmarks.metrics')}</h3>
      {benchmark.metrics.length === 0 ? (
        <p>{t('benchmarks.noMetrics')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('benchmarks.metricName')}</th>
              <th>{t('common.value')}</th>
              <th>{t('benchmarks.unit')}</th>
              <th>{t('benchmarks.percentile')}</th>
              <th>{t('benchmarks.sampleSize')}</th>
            </tr>
          </thead>
          <tbody>
            {benchmark.metrics.map((metric) => (
              <tr key={metric.id}>
                <td>{metric.metricName}</td>
                <td>{formatMetric(metric.value, { kind: 'number' }, locale)}</td>
                <td>{metric.unit}</td>
                <td>
                  {metric.percentile === null
                    ? t('benchmarks.notRecorded')
                    : formatMetric(metric.percentile, { kind: 'number' }, locale)}
                </td>
                <td>
                  {metric.sampleSize === null
                    ? t('benchmarks.notRecorded')
                    : formatMetric(metric.sampleSize, { kind: 'number' }, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
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
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('benchmarks.metricName')}
        <input value={metricName} onChange={(e) => setMetricName(e.target.value)} required />
      </label>
      <label>
        {t('common.value')}
        <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <label>
        {t('benchmarks.unit')}
        <input value={unit} onChange={(e) => setUnit(e.target.value)} required />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? t('common.saving') : t('benchmarks.addMetric')}
      </button>
    </form>
  )
}
