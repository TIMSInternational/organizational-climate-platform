import type { ReactNode } from 'react'
import { useTranslation } from '../../../i18n'
import { Chip } from '../../../components/ui'
import { dimensionStanding, signedDelta, type Standing } from '../next/benchmarks/derive'

/**
 * One company's score against its cohort's median, dimension by dimension — the hero of
 * Puntos de Referencia, drawn as the Benchmarks artboard (10 Sep).
 *
 * ## Why the median is a tick INSIDE the bar and not a second bar
 *
 * The question this screen answers is "are we above or below the cohort", and a tick
 * inside the bar makes the answer a spatial fact — the fill either reaches past the rule
 * or it does not — with no arithmetic and no legend-reading. Two side-by-side bars would
 * make the reader compare two lengths instead, which is the comparison people are
 * measurably worst at.
 *
 * ## No colour for the standing (Apple design, 11 Nov)
 *
 * The fill used to turn red below the median and the chips went red / green. Under the
 * product's colour rule green, amber and red are the three result areas — Fortaleza,
 * Oportunidad, Crítica, set by the company's bands on the climate scale — and nothing else;
 * a 0–100 index against a cohort median is not one of them, and painting it red would read as
 * "Crítica" beside a result that is not. So every fill is this company's blue, the median is
 * the ink tick, and the standing is carried by position, the signed delta and the word
 * ("bajo la mediana") — which already carried it alone in greyscale (HIG `color.md` › Best
 * practices: never rely on colour alone). A dimension the cohort carries no median for says so
 * in words ("sin mediana del grupo") rather than showing a tick-less bar that reads as level.
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

export interface CohortDimensionBarsProps {
  dimensions: CohortDimension[]
  locale?: string
  /** The card's serif heading. Omitted, the card starts at the first row. */
  heading?: ReactNode
  /** The sentence beside the heading — "3 dimensiones bajo la mediana · …". */
  summary?: string | null
  /** Companies the cohort speaks for, printed in the legend when known. */
  cohortSize?: number | null
  /** The survey the company's bars are read from, printed in the legend when known. */
  surveyTitle?: string | null
}

/** Clamped to the track, so a stray value cannot render a bar wider than its container. */
function percent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

const CHIP: Record<Exclude<Standing, 'none'>, { key: string }> = {
  below: { key: 'benchmarks.next.chipBelow' },
  at: { key: 'benchmarks.next.chipAt' },
  above: { key: 'benchmarks.next.chipAbove' },
}

export default function CohortDimensionBars({
  dimensions,
  locale,
  heading,
  summary,
  cohortSize,
  surveyTitle,
}: CohortDimensionBarsProps) {
  const { t } = useTranslation()

  return (
    <div
      data-slot="cohort-dimension-bars"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-line-panel bg-surface-card px-4 pt-4 pb-4.5 sm:px-5"
    >
      {(heading || summary) && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {heading && <h2 className="m-0 min-w-0 text-2xl">{heading}</h2>}
          {summary && (
            <p data-slot="cohort-below-summary" className="m-0 text-sm text-fg-label">
              {summary}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col">
        {dimensions.map((dimension) => {
          const { standing, delta } = dimensionStanding(dimension.score, dimension.cohortMedian)
          const chip = standing === 'none' ? null : CHIP[standing]

          return (
            <div
              key={dimension.key}
              data-slot="cohort-dimension-row"
              data-standing={standing}
              // 170px / fill / 190px with 16px between, the artboard's row; `items-center` so
              // a long dimension name that wraps keeps its bar centred against it.
              // Below `md` the bar drops to its own line under the name and the reading, as the
              // canvas's `.cb` does under 640px, so a phone keeps the whole track.
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line-light py-2.5 last:border-b-0 md:grid-cols-[170px_minmax(0,1fr)_190px] md:gap-y-0"
            >
              <span className="min-w-0 break-words text-base text-fg-primary md:truncate">{dimension.label}</span>

              <span className="relative order-3 col-span-2 block h-2 w-full rounded-full bg-band-track md:order-none md:col-span-1">
                {dimension.score !== null && (
                  <span
                    data-slot="cohort-dimension-fill"
                    className="block h-2 rounded-full bg-accent-blue"
                    style={{ width: `${percent(dimension.score)}%` }}
                  />
                )}
                {dimension.cohortMedian !== null && (
                  // `aria-hidden`: the tick is a second rendering of a number the delta
                  // beside it already states, so announcing it would read the same fact twice.
                  <span
                    aria-hidden="true"
                    data-slot="cohort-median-tick"
                    className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-xs bg-fg-primary"
                    style={{ left: `${percent(dimension.cohortMedian)}%` }}
                  />
                )}
              </span>

              {chip && delta !== null ? (
                <span className="flex items-center justify-end gap-2">
                  <span className="text-base font-semibold tabular-nums text-fg-primary">{signedDelta(delta, locale)}</span>
                  <Chip tone="neutral" label={t(chip.key)} />
                </span>
              ) : (
                <span data-slot="cohort-no-median" className="whitespace-nowrap text-right text-sm text-fg-tertiary">
                  {t('benchmarks.next.noMedian')}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4.5 gap-y-2 text-sm text-fg-tertiary">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-fg-primary" />
          {typeof cohortSize === 'number'
            ? t('benchmarks.next.legendMedian', { count: cohortSize })
            : t('benchmarks.next.legendMedianOnly')}
        </span>
        {surveyTitle && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-3.5 rounded-full bg-accent-blue" />
            {t('benchmarks.next.legendCompany', { survey: surveyTitle })}
          </span>
        )}
        <span className="text-fg-tertiary md:ml-auto">{t('benchmarks.next.legendScale')}</span>
      </div>
    </div>
  )
}
