import type { Benchmark } from '../api/benchmarks'
import { buildCohortRows, trackFraction } from '../cohortComparison'
import { isGlobalBenchmark } from '../benchmarkScope'
import { useTranslation } from '../../../i18n'
import { Badge } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

/**
 * The selected benchmarks, read as one bar per metric against the cohort.
 *
 * ## Why this is bars-with-a-tick and not the matrix it replaced
 *
 * This used to be a metric × benchmark table of numbers. Every value was there and
 * the one question the page exists to answer — *are we above or below* — still had
 * to be worked out by the reader, differencing two columns of digits per row.
 *
 * So the subject's value is a zero-anchored bar and the cohort median is a **tick
 * mark inside that same bar**, not a second bar. Position against a reference is
 * what the eye reads instantly; two bars would make it a length comparison, and a
 * second measure on its own scale is the dual axis `charts/palette.ts` forbids
 * outright. The arithmetic — including why the cohort is a median — lives in
 * `../cohortComparison.ts`.
 *
 * Every reading is mono with tabular figures; the metric name and the direction
 * word stay in the sans face. A column of readings that do not line up is the
 * thing tabular figures exist to prevent, and these are stacked in a column.
 *
 * ## Why the bar is not painted green above and red below
 *
 * `BenchmarkTrend` already made this call for the same data and it holds here:
 * whether a metric going up is good depends entirely on the metric — absenteeism
 * up is bad, engagement up is good — and the API carries nothing that says which
 * this is. Painting "above the cohort" green would be a claim the data does not
 * support. The bar therefore wears `chart-series-1`, which is identity rather than
 * state, and the direction is carried by a signed number **and a word** beside it.
 * That also keeps it inside WCAG 1.4.1: no meaning is ever in the colour alone.
 *
 * Measured, because a bar and its tick are graphical objects and owe 3:1
 * (WCAG 1.4.11). Against the light/dark token pairs in `styles/tokens.css`:
 * `--admin-chart-series-1` #0d9488 on the `--admin-bg-icon-box` track is 3.29:1 /
 * 3.83:1; the tick, `--admin-font-primary`, is 16.17:1 / 12.04:1 on that track
 * and 4.92:1 / 3.14:1 where it crosses the fill.
 *
 * ## A row whose units disagree is not compared at all
 *
 * `unitsDiffer` means two benchmarks recorded this metric as, say, 1.2 s and
 * 1200 ms. On one track that is a 1000× gap rather than the same number twice, so
 * the bar is replaced by the warning — and `buildCohortRows` withholds the cohort
 * median and the change for that row, which is why both print as an em dash here.
 * The badge is `warning`, which is what the matrix used before this rewrite.
 */
export default function BenchmarkComparison({ benchmarks }: { benchmarks: Benchmark[] }) {
  const { t, locale } = useTranslation()
  const [subject] = benchmarks
  const rows = buildCohortRows(benchmarks)

  // `buildCohortRows` needs a subject and at least one cohort member. The page
  // only mounts this with two or more, but the guard keeps `subject` defined for
  // the header below rather than leaning on the caller.
  if (!subject || rows.length === 0) return null

  function reading(value: number, unit: string | null): string {
    return `${formatMetric(value, { kind: 'number' }, locale)} ${unit ?? ''}`.trim()
  }

  return (
    <section>
      <h2 className="mb-inline text-base">{t('benchmarks.comparison')}</h2>
      <p className="mb-inline max-w-prose text-sm text-fg-secondary">
        {t('benchmarks.cohortExplainer', { name: subject.name })}
      </p>

      <div className="rounded-lg border border-line-light bg-surface-panel p-card">
        {/* The column captions. Written out rather than shared with the rows via a
            constant, because `styles/utilityExistence.test.ts` only sees class
            strings written literally in a `className`. */}
        <div className="flex flex-wrap items-end gap-inline border-b border-line-light pb-2 text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
          <div className="w-40 shrink-0">{t('benchmarks.metricName')}</div>
          {/* The subject's scope, stated where the subject is named. Whether the
              number the cohort is judged against is this company's own or a shared
              platform-wide one changes what the comparison means, and by the time a
              reader is down here the list's own scope column is off screen. As
              words rather than a badge: this is a caption row at 10px, and a badge
              at its own 11px would out-shout the column heading it sits in. */}
          <div className="min-w-40 flex-1 truncate">
            {subject.name} ·{' '}
            {isGlobalBenchmark(subject)
              ? t('analytics.scopeGlobal')
              : t('analytics.scopeCompany')}
          </div>
          <div className="w-24 shrink-0 text-right">{t('benchmarks.cohortMedian')}</div>
          <div className="w-32 shrink-0 text-right">{t('benchmarks.delta')}</div>
        </div>

        {rows.map((row) => {
          const subjectFraction =
            row.subject === null ? null : trackFraction(row.subject, row.scaleMax)
          const cohortFraction =
            row.cohortMedian === null ? null : trackFraction(row.cohortMedian, row.scaleMax)
          // Four different reasons a row can have no change, and they are not the
          // same statement. "No cohort value" on a row where the *subject* is the
          // missing side was the wording defect this replaced.
          const directionKey = row.unitsDiffer
            ? 'benchmarks.notComparable'
            : row.subject === null
              ? 'benchmarks.noSubjectValue'
              : row.cohortMedian === null
                ? 'benchmarks.noCohortValue'
                : row.delta === null || row.delta === 0
                  ? 'benchmarks.levelWithCohort'
                  : row.delta > 0
                    ? 'benchmarks.aboveCohort'
                    : 'benchmarks.belowCohort'

          return (
            <div
              key={row.metricName}
              className="flex flex-wrap items-center gap-inline border-b border-line-light py-2 last:border-b-0"
            >
              <div className="w-40 min-w-0 shrink-0">
                <div className="truncate text-sm text-fg-secondary" title={row.metricName}>
                  {row.metricName}
                </div>
                {row.subject === null ? (
                  <div className="text-base text-fg-tertiary">{t('benchmarks.notRecorded')}</div>
                ) : (
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {reading(row.subject, row.unit)}
                  </div>
                )}
              </div>

              {row.unitsDiffer ? (
                <div className="min-w-40 flex-1">
                  <Badge variant="warning" title={t('benchmarks.unitsDifferHint')}>
                    {t('benchmarks.unitsDiffer')}
                  </Badge>
                </div>
              ) : (
                // Redundant: the subject value, the cohort median and the change
                // are all printed as text in the columns beside it, so it is
                // hidden from assistive technology rather than given a label that
                // would read the same three numbers a second time.
                <div aria-hidden="true" className="min-w-40 flex-1">
                  <div className="relative h-4">
                    <div className="absolute inset-x-0 top-1 h-2 overflow-hidden rounded-full bg-surface-icon-box">
                      {subjectFraction !== null && (
                        <span
                          className="block h-full rounded-full bg-chart-series-1"
                          style={{ width: `${subjectFraction * 100}%` }}
                        />
                      )}
                    </div>
                    {cohortFraction !== null && (
                      // The cohort median, as an index mark across the whole track
                      // height so it reads over the fill as well as past its end.
                      // `-ml-px` centres the 2px mark on its position.
                      <span
                        className="absolute top-0 -ml-px h-4 w-0.5 rounded-full bg-fg-primary"
                        style={{ left: `${cohortFraction * 100}%` }}
                      />
                    )}
                  </div>
                  {/* The axis, stated. Bars are anchored at zero and the upper
                      bound is this row's own, so a row that did not print both
                      would be a bar of unknown length. */}
                  <div className="flex justify-between font-mono text-2xs tabular-nums text-fg-tertiary">
                    <span>{formatMetric(0, { kind: 'number' }, locale)}</span>
                    <span>{formatMetric(row.scaleMax, { kind: 'number' }, locale)}</span>
                  </div>
                </div>
              )}

              <div className="w-24 shrink-0 text-right">
                {row.cohortMedian === null ? (
                  <div className="text-base text-fg-tertiary">—</div>
                ) : (
                  <div className="font-mono text-base tabular-nums text-fg-secondary">
                    {reading(row.cohortMedian, row.unit)}
                  </div>
                )}
              </div>

              <div className="w-32 shrink-0 text-right">
                <div className="font-mono text-base font-semibold tabular-nums">
                  {row.delta === null
                    ? '—'
                    : `${row.delta >= 0 ? '+' : '−'}${formatMetric(Math.abs(row.delta), { kind: 'number' }, locale)}`}
                </div>
                <div className="text-xs text-fg-tertiary">{t(directionKey)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-inline flex items-center gap-2 text-xs text-fg-tertiary">
        <span aria-hidden="true" className="inline-block h-3 w-0.5 rounded-full bg-fg-primary" />
        {t('benchmarks.cohortMedian')}
      </p>
    </section>
  )
}
