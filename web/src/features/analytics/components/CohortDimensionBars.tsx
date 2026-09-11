import type { ReactNode } from 'react'
import { useTranslation } from '../../../i18n'
import { Chip, type ChipTone } from '../../../components/ui'
import { cn } from '../../../lib/cn'
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
 * ## The colour rule, and what carries it
 *
 * The fill turns red when the score is BELOW its own cohort median, not below some fixed
 * target: a 61 that beats a cohort of 58 is good news, and a 74 that trails a cohort of 80
 * is not. Colour is never the only carrier — every row states the direction as a signed
 * delta AND as a word ("bajo la mediana"), so it survives greyscale and a reader who cannot
 * separate the two hues. A dimension the cohort carries no median for says so in words
 * ("sin mediana del grupo") rather than showing a tick-less bar that reads as level.
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

const CHIP: Record<Exclude<Standing, 'none'>, { tone: ChipTone; key: string; ink: string }> = {
  below: { tone: 'critical', key: 'benchmarks.next.chipBelow', ink: 'text-accent-red' },
  at: { tone: 'neutral', key: 'benchmarks.next.chipAt', ink: 'text-fg-label' },
  above: { tone: 'good', key: 'benchmarks.next.chipAbove', ink: 'text-accent-green-ink' },
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
      className="flex flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-xs"
    >
      {(heading || summary) && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {heading && <h2 className="m-0 text-2xl">{heading}</h2>}
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
              className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_minmax(0,150px)] items-center gap-4 border-b border-line-light py-2.25 md:grid-cols-[170px_minmax(0,1fr)_190px]"
            >
              <span className="min-w-0 truncate text-base text-fg-primary">{dimension.label}</span>

              <span className="relative block h-2.5 w-full rounded-full bg-line-light">
                {dimension.score !== null && (
                  <span
                    data-slot="cohort-dimension-fill"
                    className={cn('block h-2.5 rounded-full', standing === 'below' ? 'bg-accent-red' : 'bg-accent-blue')}
                    style={{ width: `${percent(dimension.score)}%` }}
                  />
                )}
                {dimension.cohortMedian !== null && (
                  // `aria-hidden`: the tick is a second rendering of a number the delta
                  // beside it already states, so announcing it would read the same fact twice.
                  <span
                    aria-hidden="true"
                    data-slot="cohort-median-tick"
                    className="absolute -top-0.75 h-4 w-0.5 rounded-xs bg-fg-primary"
                    style={{ left: `${percent(dimension.cohortMedian)}%` }}
                  />
                )}
              </span>

              {chip && delta !== null ? (
                <span className="flex items-center justify-end gap-2">
                  <span className={cn('font-mono text-base font-semibold tabular-nums', chip.ink)}>
                    {signedDelta(delta, locale)}
                  </span>
                  {/* The canvas's chip is 24px tall (22px plus its border, content-box); the
                      primitive's is 22px, which put these rows 41px apart where the artboard's
                      are 43 — the row's 9px padding is the artboard's own. */}
                  <Chip tone={chip.tone} label={t(chip.key)} className="h-6" />
                </span>
              ) : (
                <span data-slot="cohort-no-median" className="whitespace-nowrap text-xs text-fg-label">
                  {t('benchmarks.next.noMedian')}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4.5 gap-y-2 text-sm text-fg-label">
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
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-3.5 rounded-full bg-accent-red" />
          {t('benchmarks.next.chipBelow')}
        </span>
        <span className="ml-auto text-fg-label">{t('benchmarks.next.legendScale')}</span>
      </div>
    </div>
  )
}
