import { useTranslation } from '../../i18n'
import { Table } from '../ui'
import { formatMetric } from './formatMetric'
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
 *
 * The grid **fills its container**, which is what the approved design does
 * (`.heat { grid-template-columns: 98px repeat(6, minmax(52px,1fr)) }` — the value
 * columns are `1fr`). A shrink-wrapped table left a 439px grid stranded in the
 * top-left of a 769px panel, measured in Chromium at 1440. The row-label column is
 * `w-px whitespace-nowrap` so the slack goes to the readings rather than to the
 * labels, and `Table`'s own container is what scrolls when the grid no longer fits.
 *
 * ## Every reading goes through `formatMetric`
 *
 * A bare `{score}` prints JavaScript's own number formatting, which is `1.9` in
 * every locale — so a Spanish page showed `1.9` in the grid next to `1,9` in the
 * findings card beside it and `3,3` in the caption above it. It also put `4` and
 * `3.8` in the same column, two rows apart. `decimals` and the reader's locale,
 * through `Intl`, fix both: the figures line up and the decimal separator is the
 * one the rest of the page uses.
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
  /**
   * The score every cell is measured against.
   *
   * `null` means nothing on this grid was disclosed, so there is no target for a
   * colour to mean anything against and every cell renders protected. That is the
   * shape `buildClimateMap` produces when the anonymity floor takes every group:
   * the rows stay, because the groups exist and were measured, and the section
   * says so instead of disappearing.
   */
  target: number | null
  /** Points either side of the target that still read as "on target". */
  deadBandAt?: number
  /** Points from the target at which the scale saturates. */
  extremeAt?: number
  /** The anonymity floor. Per-company; see `ProtectedCell`. */
  threshold?: number
  /**
   * Decimal places every reading is printed to.
   *
   * The caller knows the scale and this component does not: a 0-100 climate index
   * is whole numbers, a 1-5 Likert mean is one decimal. Left unset, `formatMetric`
   * prints however many the number needs capped at one — which is right for the
   * first and wrong for the second, where it puts `4` in the column above `3.8`
   * and breaks the tabular alignment the readings exist to have.
   */
  decimals?: number
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
  decimals,
  title,
}: ClimateMapProps) {
  const { t, locale } = useTranslation()

  const deadBand = deadBandAt / (2 * extremeAt)
  const reading = (value: number) => formatMetric(value, { kind: 'number', decimals }, locale)

  return (
    <figure className="m-0 flex flex-col gap-2">
      {title ? (
        <figcaption className="text-lg font-medium text-fg-primary">{title}</figcaption>
      ) : null}

      {/* `Table` supplies `w-full` and the container that scrolls a wide grid
          inside itself rather than pushing the page sideways. */}
      <Table className="text-sm">
        <caption className="sr-only">{t('charts.tableCaption')}</caption>
        <thead>
          <tr>
            {/* Heads the row-label column, which has no column name of its own.
                `w-px` with the labels set `whitespace-nowrap` below is the
                shrink-to-content column: the table's surplus width then goes to
                the reading columns, which is where the design puts it. */}
            <td className="w-px" />
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
            // The row-level decision. `target === null` suppresses the whole grid
            // for the reason the prop documents: with nothing disclosed there is
            // no reading to draw and no target to draw it against.
            const suppressed = target === null || isSuppressed(row.responses, threshold)
            return (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="w-px whitespace-nowrap pr-2 text-left text-xs font-medium text-fg-secondary"
                >
                  {row.label}
                </th>
                {dimensions.map((dimension, index) => {
                  const name = dimension.fullLabel ?? dimension.label
                  const description = `${row.label}, ${name}`

                  // `target === null` is restated rather than left to `suppressed`
                  // so the narrowing below is the compiler's, not a comment's: no
                  // colour can be computed against a target that does not exist.
                  if (target === null || suppressed) {
                    return (
                      <td key={dimension.key} className="p-px">
                        <ProtectedCell
                          // 0, not `row.responses`: the row-level decision above
                          // is the one that governs, and the withheld count has no
                          // business travelling any further down than it must.
                          responses={0}
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
                  const { fill, ink } = divergingPair((score - target) / (2 * extremeAt), deadBand)
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
                        {reading(score)}
                        <span className="sr-only">
                          {` — ${t(
                            score - target > deadBandAt
                              ? 'charts.aboveTarget'
                              : score - target < -deadBandAt
                                ? 'charts.belowTarget'
                                : 'charts.onTarget',
                            { target: reading(target) },
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
        {/* The scale is dropped when there is no target: not one cell on the grid
            carries a colour from it, and a key to colours that appear nowhere is
            the reader's time spent looking for them. The protected key stays,
            because that is what every cell is. */}
        {target !== null && (
          <>
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
          </>
        )}
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
