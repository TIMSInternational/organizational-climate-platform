import { useEffect, useState } from 'react'
import type { Benchmark, BenchmarkMetricChange, PriorPeriodCandidate, PriorPeriodStatus } from '../api/benchmarks'
import { useTranslation } from '../../../i18n'
import { Button, Table } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

export interface BenchmarkPriorPeriodPanelProps {
  benchmark: Benchmark
  /** `canWriteBenchmark` for THIS benchmark — a CompanyAdmin reads a global one and may not link it. */
  canWrite: boolean
  loadCandidates: (id: string) => Promise<PriorPeriodCandidate[]>
  onSet: (status: PriorPeriodStatus, priorPeriodBenchmarkId?: string) => Promise<void>
}

/**
 * What a benchmark's prior period is — and, when it has none, which kind of none.
 *
 * ## The three states are three different sentences
 *
 * This is the criterion #89 turns on, and the one the page could not meet before.
 * `priorPeriodBenchmarkId === null` was the whole of the evidence, so the page printed
 * *"This benchmark does not link to a prior period"* over two situations that have
 * nothing to do with each other:
 *
 * - **`none`** — an administrator looked and there is nothing before this. A first-year
 *   company, a first measurement. That is an answer, and a complete one: there is no
 *   action to offer and nothing missing.
 * - **`unlinked`** — nobody has said. The comparison is absent because of our own data
 *   entry, not because of the company. This one names the gap and offers to close it.
 *
 * Telling a client's first-ever climate measurement that its year-over-year column is
 * "not linked yet" invents a backlog that does not exist; telling a real backlog that the
 * company has no history hides one that does. Both were the same string.
 *
 * ## `linked` with nothing to show is a fourth thing, and it is also not an error
 *
 * A link written before #89 could point at another tenant's benchmark, and
 * `LoadPriorPeriodAsync` omits the comparison rather than handing over rows the caller
 * cannot otherwise read. So `linked` + `priorPeriod === null` is a real state. It says the
 * link exists and this reader may not follow it, rather than falling through to "not
 * linked", which would be a lie about the data.
 *
 * ## Choosing is a human act here
 *
 * The candidate list is a *suggestion* — same company, same category, same type, earlier —
 * and nothing on this panel applies one on its own, not even when there is only one. The
 * API is built the same way (`docs/decisions/prior-period-benchmark-linkage.md`): a
 * benchmark has no period field, only `createdAt`, so an automatic match is a guess, and a
 * wrong guess produces a confidently wrong year-over-year figure that a reader has no way
 * to check. A blank column is recoverable; an invented comparison is not.
 *
 * ## And then it shows the numbers
 *
 * `priorPeriod.metrics` is the year-over-year reading itself — this period's value, the
 * prior period's, the change and the change as a fraction — computed once on the server in
 * `BenchmarkPriorPeriod.BuildChanges` so that the report section (#88) and the tracking
 * module's `resultado_anio_anterior_pct` cannot come out different. It reached no screen at
 * all until this table: the panel named the prior period and stopped, and the only figures a
 * reader saw came from the browser's own `buildTrend`, which is a separate derivation over a
 * chain. A feature that computes a comparison nobody can look at has not been delivered.
 *
 * Where the server withheld the change it says why rather than leaving a gap — a metric only
 * one of the two periods recorded, or the same metric recorded in two different units.
 */
export default function BenchmarkPriorPeriodPanel({
  benchmark,
  canWrite,
  loadCandidates,
  onSet,
}: BenchmarkPriorPeriodPanelProps) {
  const { t, locale } = useTranslation()
  const [candidates, setCandidates] = useState<PriorPeriodCandidate[] | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linked = benchmark.priorPeriodStatus === 'linked'

  useEffect(() => {
    // Only fetched where it could be used. A `none` benchmark has an answer already, and a
    // reader who may not write cannot act on a shortlist.
    if (!canWrite || linked) {
      setCandidates(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await loadCandidates(benchmark.id)
        if (!cancelled) setCandidates(result)
      } catch {
        if (!cancelled) setCandidates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [benchmark.id, canWrite, linked, loadCandidates])

  /**
   * One period's reading of one metric, or the fact that this period did not record it.
   *
   * Never `0` and never a dash for a missing value: a metric nobody measured and a metric
   * measured at zero are different facts, and the whole table exists to be differenced.
   */
  function reading(value: number | null, unit: string | null) {
    if (value === null) return <span className="text-fg-tertiary">{t('benchmarks.notRecorded')}</span>
    return (
      <span className="font-mono text-base font-semibold tabular-nums">
        {`${formatMetric(value, { kind: 'number' }, locale)} ${unit ?? ''}`.trim()}
      </span>
    )
  }

  async function apply(status: PriorPeriodStatus, priorId?: string) {
    setBusy(true)
    setError(null)
    try {
      await onSet(status, priorId)
      setSelected('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-line-light bg-surface-icon-box p-panel">
      <p className="mb-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
        {t('benchmarks.priorPeriods')}
      </p>
      <h2 className="mt-1 mb-inline text-xl">{t('benchmarks.priorPeriodHeading')}</h2>

      {error && (
        <p role="alert" className="mb-inline text-sm text-accent-red">
          {error}
        </p>
      )}

      {benchmark.priorPeriodStatus === 'none' && (
        <p className="mb-0 max-w-prose text-sm text-fg-secondary">
          {t('benchmarks.priorPeriodNoneExplained')}
        </p>
      )}

      {benchmark.priorPeriodStatus === 'unlinked' && (
        <p className="mb-0 max-w-prose text-sm text-fg-secondary">
          {t('benchmarks.priorPeriodUnlinkedExplained')}
        </p>
      )}

      {linked && benchmark.priorPeriod === null && (
        <p className="mb-0 max-w-prose text-sm text-fg-secondary">
          {t('benchmarks.priorPeriodUnreadable')}
        </p>
      )}

      {linked && benchmark.priorPeriod !== null && (
        <>
          <p className="mb-inline max-w-prose text-sm text-fg-secondary">
            {t('benchmarks.priorPeriodLinkedTo', { name: benchmark.priorPeriod.name })}
          </p>

          {benchmark.priorPeriod.metrics.length > 0 && (
            <div className="rounded-lg border border-line-light bg-surface-panel p-card">
              <Table>
                <thead>
                  <tr>
                    <th>{t('benchmarks.metricName')}</th>
                    <th className="text-right">{benchmark.name}</th>
                    <th className="text-right">{benchmark.priorPeriod.name}</th>
                    <th className="text-right">{t('benchmarks.delta')}</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmark.priorPeriod.metrics.map((change: BenchmarkMetricChange) => (
                    <tr key={change.metricName}>
                      <td>{change.metricName}</td>
                      <td className="text-right">{reading(change.value, change.unit)}</td>
                      <td className="text-right">{reading(change.priorValue, change.priorUnit)}</td>
                      <td className="text-right">
                        {change.delta === null ? (
                          // Both values present and no change means the server refused to
                          // difference two different units, and that is worth saying: a blank
                          // in a column of signed numbers reads as "unchanged". Any other
                          // missing change is a metric one of the periods did not record, and
                          // the row itself already shows which.
                          <span className="text-fg-tertiary">
                            {change.value !== null && change.priorValue !== null
                              ? t('benchmarks.unitsDiffer')
                              : '—'}
                          </span>
                        ) : (
                          <>
                            <span className="font-mono text-base font-semibold tabular-nums">
                              {`${change.delta >= 0 ? '+' : '−'}${formatMetric(Math.abs(change.delta), { kind: 'number' }, locale)}`}
                            </span>
                            {change.changeRatio !== null && (
                              <span className="ml-1 font-mono text-xs tabular-nums text-fg-secondary">
                                {`${change.changeRatio >= 0 ? '+' : '−'}${formatMetric(Math.abs(change.changeRatio) * 100, { kind: 'percentage' }, locale)}`}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}

      {canWrite && (
        <div className="mt-section flex flex-wrap items-end gap-inline">
          {!linked && candidates !== null && candidates.length > 0 && (
            <>
              <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm text-fg-secondary">
                {t('benchmarks.priorPeriodChoose')}
                <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                  <option value="">{t('benchmarks.priorPeriodChoosePlaceholder')}</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={busy || selected === ''}
                onClick={() => void apply('linked', selected)}
              >
                {t('benchmarks.priorPeriodLink')}
              </Button>
            </>
          )}

          {!linked && candidates !== null && candidates.length === 0 && (
            <p className="mb-0 max-w-prose text-sm text-fg-tertiary">
              {t('benchmarks.priorPeriodNoCandidates')}
            </p>
          )}

          {benchmark.priorPeriodStatus !== 'none' && (
            <Button variant="outline" disabled={busy} onClick={() => void apply('none')}>
              {t('benchmarks.priorPeriodDeclareNone')}
            </Button>
          )}

          {benchmark.priorPeriodStatus !== 'unlinked' && (
            <Button variant="outline" disabled={busy} onClick={() => void apply('unlinked')}>
              {t('benchmarks.priorPeriodClear')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
