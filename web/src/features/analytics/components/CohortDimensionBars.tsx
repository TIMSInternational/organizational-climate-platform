import { useTranslation } from '../../../i18n'

/**
 * One company's score against its cohort's median, dimension by dimension.
 *
 * ## Why the median is a tick INSIDE the bar and not a second bar
 *
 * The approved design draws one bar per dimension and puts the cohort median on it as a
 * 2px rule. That is not decoration: the question this screen answers is "are we above or
 * below the cohort", and a tick inside the bar makes the answer a spatial fact — the fill
 * either reaches past the rule or it does not — with no arithmetic and no legend-reading.
 * Two side-by-side bars would make the reader compare two lengths instead, which is the
 * comparison people are measurably worst at.
 *
 * ## The colour rule, and what carries it
 *
 * The fill turns critical when the score is BELOW its own cohort median, not below some
 * fixed target: a 61 that beats a cohort of 58 is good news, and a 74 that trails a cohort
 * of 80 is not. Colour is never the only carrier — the delta column states the direction in
 * text with a sign, so the row survives being read in greyscale or by somebody who cannot
 * separate the two hues.
 */

export interface CohortDimension {
  /** The dimension key, as `Question.Category` stores it. */
  key: string
  /** Already translated. */
  label: string
  /** This company's score on the 0-100 index, or null when the survey did not ask it. */
  score: number | null
  /** The cohort's median on the same index, or null when the cohort does not carry it. */
  cohortMedian: number | null
}

/** Clamped to the track, so a stray value cannot render a bar wider than its container. */
function percent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export default function CohortDimensionBars({
  dimensions,
  locale,
}: {
  dimensions: CohortDimension[]
  locale?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="cohort-dimension-bars"
      className="rounded-lg border border-line-light bg-surface-panel p-panel"
    >
      {dimensions.map((dimension) => {
        const delta =
          dimension.score === null || dimension.cohortMedian === null
            ? null
            : Math.round(dimension.score - dimension.cohortMedian)
        const below = delta !== null && delta < 0

        return (
          <div
            key={dimension.key}
            data-slot="cohort-dimension-row"
            // 150px / fill / 78px, the design's own three-column row. `items-center` so a
            // long dimension name that wraps keeps its bar centred against it.
            className="grid grid-cols-[minmax(0,150px)_1fr_78px] items-center gap-3 border-b border-line-light py-2 last:border-b-0"
          >
            <span className="min-w-0 truncate text-xs text-fg-secondary">{dimension.label}</span>

            <div className="relative h-[18px]">
              <div className="mt-[5px] h-2 overflow-hidden rounded-full bg-surface-icon-box">
                {dimension.score !== null && (
                  <div
                    className={`h-full rounded-full ${below ? 'bg-accent-red' : 'bg-accent-blue'}`}
                    style={{ width: `${percent(dimension.score)}%` }}
                  />
                )}
              </div>
              {dimension.cohortMedian !== null && (
                // `aria-hidden`: the tick is a second rendering of a number the delta
                // column already states, so announcing it would read the same fact twice.
                <span
                  aria-hidden="true"
                  data-slot="cohort-median-tick"
                  className="absolute top-0 h-[18px] w-0.5 rounded-full bg-fg-tertiary"
                  style={{ left: `${percent(dimension.cohortMedian)}%` }}
                />
              )}
            </div>

            <span
              className={`text-right font-mono text-xs font-semibold tabular-nums ${
                delta === null ? 'text-fg-tertiary' : below ? 'text-accent-red' : 'text-accent-green'
              }`}
            >
              {delta === null
                ? '—'
                : // An explicit sign on both directions. A bare "4" beside a bar leaves the
                  // reader working out which side of the median it fell on.
                  `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toLocaleString(locale)}`}
            </span>
          </div>
        )
      })}

      <div className="mt-2.5 flex items-center gap-1.5 text-2xs text-fg-tertiary">
        <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-fg-tertiary" />
        {t('benchmarks.cohortMedianLegend')}
      </div>
    </div>
  )
}
