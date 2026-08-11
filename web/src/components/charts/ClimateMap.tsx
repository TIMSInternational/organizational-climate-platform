import { useTranslation } from '../../i18n'
import { Table } from '../ui'
import { DIVERGING_COLORS, divergingPair } from './palette'
import ProtectedCell from './ProtectedCell'
import { isSuppressed } from './suppression'

/**
 * Score against a target, by group and dimension — the dashboard's hero.
 *
 * ## Why this is DIVERGING and not the sequential ramp
 *
 * `HeatMap` renders magnitude on the one validated sequential ramp, which is
 * right for "how much" but wrong here. A sequential ramp puts low scores at the
 * *pale* end, so the worst area of the organisation renders as near-empty space
 * and the eye skips it — the exact cell a reader opened the page to find. Score
 * against a target is not a magnitude, it is a **polarity**: above, on, below.
 * Diverging is the form that matches, with a neutral gray midpoint so "on target"
 * reads as neither good nor bad rather than as weakly good.
 *
 * This is a third case beside the locked "lines fit their domain, bars anchored at
 * zero" rule, not a re-litigation of it.
 *
 * ## How a score becomes a polarity
 *
 * `divergingPair` takes -1..1. The mapping is
 * `(score - target) / (2 * extremeAt)`, which places the band edges exactly where
 * the design puts them: the neutral band at ±`deadBandAt` points, and the
 * saturated ends at ±`extremeAt` points. Written as a division rather than a
 * chain of comparisons so the fill and its ink can never come from different
 * steps — `divergingPair` returns them together for that reason.
 *
 * ## Suppression is part of the chart, not a filter over it
 *
 * A group under the anonymity floor keeps its row and renders every cell as a
 * `ProtectedCell`. Dropping the row would misreport the organisation's shape —
 * the reader would not know the group exists — and blanking the cells would read
 * as missing data. See `ProtectedCell` for why the count is never shown.
 *
 * ## Rendered as a real table
 *
 * Same decision, and same reasoning, as `HeatMap`: a heatmap *is* a table of
 * numbers, so table semantics give row and column headers and announced cell
 * context for free, and the colour becomes redundant encoding rather than the only
 * encoding.
 */
export interface ClimateMapDimension {
  /** Stable key, used as the React key. */
  key: string
  /** Already-translated column heading — kept short; the grid is dense. */
  label: string
  /**
   * Already-translated full name, used in each cell's accessible label where the
   * abbreviation would be unreadable ("Recogn." announced as "Recognition").
   * Falls back to `label`.
   */
  fullLabel?: string
}

export interface ClimateMapRow {
  /** Stable id, used as the React key. */
  id: string
  /** Already-translated row label — typically a department. */
  label: string
  /**
   * Responses behind this row. Decides suppression for the whole row, and is
   * never rendered. A row is suppressed as a unit because the dimensions share
   * the same respondents.
   */
  responses: number
  /** Score per dimension, in the same order as `dimensions`. */
  scores: readonly number[]
}

export interface ClimateMapProps {
  dimensions: readonly ClimateMapDimension[]
  rows: readonly ClimateMapRow[]
  /** The score every cell is measured against. */
  target: number
  /** Points either side of the target that still read as "on target". */
  deadBandAt?: number
  /** Points from the target at which the scale saturates. */
  extremeAt?: number
  /** The anonymity floor. Per-company; see `ProtectedCell`. */
  threshold?: number
  /** Already-translated heading for the figure. */
  title?: string
}

export default function ClimateMap({
  dimensions,
  rows,
  target,
  deadBandAt = 2,
  extremeAt = 10,
  threshold = 5,
  title,
}: ClimateMapProps) {
  const { t } = useTranslation()

  const polarity = (score: number) => (score - target) / (2 * extremeAt)
  const deadBand = deadBandAt / (2 * extremeAt)

  return (
    <figure className="m-0 flex flex-col gap-2">
      {title ? (
        <figcaption className="text-lg font-medium text-fg-primary">{title}</figcaption>
      ) : null}

      {/* `w-auto` for the reason HeatMap documents: Table defaults to w-full, which
          strands the coloured cells against the right edge and leaves a grid you
          cannot read a row off. It also scrolls a wide map inside itself rather
          than pushing the page sideways. */}
      <Table className="w-auto text-sm">
        <caption className="sr-only">{t('charts.tableCaption')}</caption>
        <thead>
          <tr>
            {/* Heads the row-label column, which has no column name of its own. */}
            <td />
            {dimensions.map((dimension) => (
              <th
                key={dimension.key}
                scope="col"
                className="px-1 pb-1.5 text-left text-2xs font-semibold uppercase tracking-label text-fg-tertiary"
              >
                {dimension.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const suppressed = isSuppressed(row.responses, threshold)
            return (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="whitespace-nowrap pr-2 text-left text-xs font-medium text-fg-secondary"
                >
                  {row.label}
                </th>
                {dimensions.map((dimension, index) => {
                  const name = dimension.fullLabel ?? dimension.label
                  const description = `${row.label}, ${name}`

                  if (suppressed) {
                    return (
                      <td key={dimension.key} className="p-px">
                        <ProtectedCell
                          responses={row.responses}
                          threshold={threshold}
                          description={description}
                          suppressedClassName="h-7 w-full"
                        >
                          {null}
                        </ProtectedCell>
                      </td>
                    )
                  }

                  const score = row.scores[index]
                  const { fill, ink } = divergingPair(polarity(score), deadBand)
                  // The ring marks the cells worth acting on. It is a second
                  // channel on top of the fill, not a substitute for it, and the
                  // accessible label says "below target" in words either way.
                  const severelyBelow = score - target <= -extremeAt

                  return (
                    <td key={dimension.key} className="p-px">
                      <div
                        className="flex h-7 items-center justify-center rounded font-mono text-xs tabular-nums"
                        style={{
                          backgroundColor: fill,
                          color: ink,
                          ...(severelyBelow
                            ? { boxShadow: `0 0 0 2px var(--admin-bg-panel), 0 0 0 3.5px ${DIVERGING_COLORS[0]}` }
                            : {}),
                        }}
                      >
                        <span className="sr-only">{`${description}: `}</span>
                        {score}
                        <span className="sr-only">
                          {` — ${t(
                            score - target > deadBandAt
                              ? 'charts.aboveTarget'
                              : score - target < -deadBandAt
                                ? 'charts.belowTarget'
                                : 'charts.onTarget',
                            { target },
                          )}`}
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-secondary">
        <span className="text-fg-tertiary">{t('charts.belowTargetLegend')}</span>
        <span className="flex gap-0.5" aria-hidden="true">
          {DIVERGING_COLORS.map((color) => (
            <span
              key={color}
              className="inline-block h-2 w-5 rounded-xs"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <span className="text-fg-tertiary">{t('charts.aboveTargetLegend')}</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-5 rounded-xs border border-dashed border-line-default bg-surface-icon-box [background-image:repeating-linear-gradient(135deg,var(--admin-border-light)_0_5px,transparent_5px_10px)]"
          />
          {t('charts.protectedLegend', { threshold })}
        </span>
      </div>
    </figure>
  )
}
