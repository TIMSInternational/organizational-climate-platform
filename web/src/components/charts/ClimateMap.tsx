import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { Table } from '../ui'
import { formatMetric } from './formatMetric'
import { DIVERGING_COLORS, divergingPair } from './palette'
import ProtectedCell from './ProtectedCell'
import { PROTECTED_HATCH, isSuppressed } from './suppression'

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
 *
 * ## Opening a cell, and the one cell that never opens
 *
 * `onSelectCell` turns each disclosed reading into a `<button>` inside its `<td>`,
 * which is why the interactive grid is still the table described above: the cell
 * keeps its row and column headers, and the button carries the same accessible
 * name the static cell had.
 *
 * **A protected cell is never a button, and the legend says so.** This is not a
 * styling choice, it is the anonymity floor: a control that can be focused,
 * hovered and clicked answers "is there anything behind this cell" for a group
 * whose reading is withheld, and a reader who tabs across a row learns which
 * groups are small without one number being published. `ProtectedCell` withholds
 * the count; an inert cell withholds the invitation. The caller is not trusted to
 * check either — this component decides from the same `suppressed` flag that
 * decides the hatch, so a caller that passes a handler cannot make a withheld
 * cell clickable by mistake.
 *
 * The same rule governs the row header: a withheld row's label is text, not a
 * button, for exactly the reason its cells are.
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

/** What the grid is currently showing detail for. */
export interface ClimateMapSelection {
  rowId: string
  /** The dimension, or `null` when the whole row is open. */
  dimensionKey: string | null
}

/**
 * The two densities, as whole sets rather than as a height.
 *
 * The reading box and the protected box must be the *same* height or the rows
 * jitter where a withheld group sits between two disclosed ones, so both read
 * `box` from here rather than each spelling a height out. `large` is `h-11`
 * (44px), which is WCAG 2.5.5's minimum target size — the density that makes the
 * grid comfortable to read is the same one that makes a cell safe to aim at, so
 * an interactive map is a large map.
 */
const DENSITY = {
  default: { box: 'h-7', reading: 'text-xs', header: 'text-2xs', label: 'text-xs' },
  large: { box: 'h-11', reading: 'text-sm', header: 'text-xs', label: 'text-sm' },
} as const

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
  /**
   * How large the cells are drawn. `large` when the map is the screen's subject,
   * `default` when it is one reading among several.
   */
  size?: keyof typeof DENSITY
  /**
   * Opens one disclosed cell. Omitted leaves the grid inert, which is what a
   * mount with nothing to drill into wants.
   *
   * Never called for a withheld cell — see the module note. The caller is handed
   * the row id and dimension key it supplied rather than an index, so it can look
   * the selection back up without depending on the order the grid drew.
   */
  onSelectCell?: (rowId: string, dimensionKey: string) => void
  /** Opens a whole disclosed group. Same rule about withheld rows. */
  onSelectRow?: (rowId: string) => void
  /** What is open now, so the grid can mark it. */
  selection?: ClimateMapSelection | null
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
  size = 'default',
  onSelectCell,
  onSelectRow,
  selection = null,
}: ClimateMapProps) {
  const { t, locale } = useTranslation()
  const density = DENSITY[size]

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
                // `text-fg-secondary`, not `text-fg-tertiary`. These are `text-2xs`
                // dimension names, so WCAG AA wants 4.5:1, and `--admin-font-tertiary`
                // (#818181, the same value in both palettes) gives 3.90:1 on
                // `--admin-bg-panel` and 3.42:1 on `--admin-bg-icon-box` — this map
                // appears on both surfaces. `--admin-font-secondary` clears it
                // everywhere (9.29 / 8.15 light, 8.55 / 6.85 dark). Same correction
                // `KpiTile` already took for its label; `resultsContrast.test.ts`
                // measures the pair and bans the utility by name in this file.
                className={cn(
                  'px-1 pb-1.5 text-left font-semibold uppercase tracking-label text-fg-secondary',
                  density.header,
                )}
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
            // Whether the whole group is open, versus one of its cells. They are
            // marked differently on purpose: a row tint for the group, an inset
            // edge for the cell, so a reader can see which of the two questions
            // the panel below is answering.
            const rowOpen = selection?.rowId === row.id && selection.dimensionKey === null
            // The row header opens the group — but never for a withheld one, for
            // the reason the module note gives about its cells.
            const rowInteractive = onSelectRow !== undefined && !suppressed
            return (
              <tr
                key={row.id}
                // Only the label column and the 1px cell gutters take this tint —
                // every reading is painted opaque over it — so it reads as a
                // highlight on the row rather than as a wash over the readings.
                className={rowOpen ? 'bg-surface-icon-box' : undefined}
              >
                <th
                  scope="row"
                  className={cn(
                    'w-px whitespace-nowrap pr-2 text-left font-medium text-fg-secondary',
                    density.label,
                  )}
                >
                  {rowInteractive ? (
                    <button
                      type="button"
                      onClick={() => onSelectRow(row.id)}
                      aria-expanded={rowOpen}
                      // `index.css` styles every bare `button` in `@layer base`
                      // as the admin control — 32px tall, carded, bordered,
                      // padded, in its own font and ink. A row label is a label,
                      // so all seven of those are turned off here. Utilities win
                      // over that rule whatever its specificity, because
                      // Tailwind's utilities layer is declared after base.
                      //
                      // No focus classes: `index.css` also rings every
                      // `:focus-visible` globally, and this element sets no
                      // `outline` of its own to override it with.
                      className={cn(
                        'inline h-auto cursor-pointer rounded border-0 bg-transparent p-0 text-left font-medium text-fg-secondary underline-offset-2 hover:bg-transparent hover:underline',
                        density.label,
                      )}
                    >
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )}
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
                          // The one honest opt-out. `charts.protectedLegend` under
                          // this matrix makes the statement for every cell at once,
                          // and an `h-7` cell has no room for a word anyway — a
                          // dense grid repeating "protected" is noise, not clarity.
                          showWord={false}
                          // The same `box` the disclosed reading uses. A withheld
                          // row between two disclosed ones must not be a different
                          // height, or the grid steps where the floor bites.
                          suppressedClassName={cn(density.box, 'w-full')}
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

                  const cellOpen =
                    selection?.rowId === row.id && selection.dimensionKey === dimension.key

                  const box = (
                    <div
                      className={cn(
                        'flex w-full items-center justify-center rounded font-mono tabular-nums',
                        density.box,
                        density.reading,
                      )}
                      style={{
                        backgroundColor: fill,
                        color: ink,
                          // `outline` + `outlineOffset`, NOT a two-step box-shadow.
                          // The gap an offset outline leaves is not painted at all,
                          // so whatever surface the chart is standing on shows
                          // through it. The previous spelling painted that gap with
                          // `--admin-bg-panel`, which is only correct when the map
                          // sits directly on the page panel; on the dashboard it
                          // stands on `--admin-bg-icon-box`, and the mismatch drew a
                          // white halo in light and a near-black one in dark around
                          // the one cell this ring exists to draw the eye to.
                        ...(severelyBelow
                          ? {
                              outline: `1.5px solid ${DIVERGING_COLORS[0]}`,
                              outlineOffset: '2px',
                            }
                          : {}),
                        // The open cell, marked from the INSIDE. `ink` is the one
                        // colour guaranteed to read against this exact `fill` —
                        // `divergingPair` returns the two together for that reason
                        // — and an inset shadow paints over the cell's own fill, so
                        // unlike the ring above it needs no gap and therefore no
                        // opinion about the surface underneath. It also leaves
                        // `outline` free, which is what the focus ring uses.
                        //
                        // TWO stops, not one. A single ink ring flush to the edge
                        // is invisible on exactly the cells a reader opens most: at
                        // the bottom of the ramp `ink` is white, and a white ring
                        // against the white gap the severely-below outline leaves
                        // reads as part of that gap. The first stop lays 2px of the
                        // cell's own fill back over the edge so the second floats
                        // the ink ring inside the colour, where its contrast is the
                        // guaranteed one. Measured at 1440 on the extreme red cell,
                        // which is where the single ring failed.
                        ...(cellOpen
                          ? { boxShadow: `inset 0 0 0 2px ${fill}, inset 0 0 0 4px ${ink}` }
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
                  )

                  return (
                    <td key={dimension.key} className="p-px">
                      {onSelectCell ? (
                        // The button WRAPS the painted cell rather than being it.
                        // `severelyBelow` sets `outline` inline, and an inline
                        // style beats the global `:focus-visible { outline: … }`
                        // rule in `index.css` — so a button carrying that style
                        // would be the one cell on the grid that could be focused
                        // without showing it, which is precisely the cell the ring
                        // exists to send the reader to. Focus lands on the wrapper,
                        // whose outline nothing else touches.
                        <button
                          type="button"
                          onClick={() => onSelectCell(row.id, dimension.key)}
                          aria-expanded={cellOpen}
                          // Same neutralisation as the row label above: without
                          // it the base rule's 32px height cropped the 44px cell,
                          // its 12px padding inset the fill, and its card
                          // background and border drew a white box around every
                          // reading on the grid.
                          className="block h-auto w-full cursor-pointer rounded border-0 bg-transparent p-0 hover:bg-transparent hover:outline-2 hover:outline-offset-2 hover:outline-fg-primary"
                        >
                          {box}
                        </button>
                      ) : (
                        box
                      )}
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
            {/* No ink override: the wrapper's `text-fg-secondary` already reads at
                AA on both surfaces, where `text-fg-tertiary` measured 3.90:1. */}
            <span>{t('charts.belowTargetLegend')}</span>
            <span className="flex gap-0.5" aria-hidden="true">
              {DIVERGING_COLORS.map((color) => (
                <span
                  key={color}
                  className="inline-block h-2 w-5 rounded-xs"
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
            <span>{t('charts.aboveTargetLegend')}</span>
          </>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-5 rounded-xs border border-dashed border-line-default bg-surface-icon-box ${PROTECTED_HATCH}`}
          />
          {/* The interactive grid says the extra half of the rule: these cells
              are not merely uncoloured, they are the ones that do not open. A
              reader who did not know that would read an inert cell as a bug and
              click it again. Stated once for the whole matrix, like the hatch. */}
          {onSelectCell || onSelectRow
            ? t('charts.protectedLegendInert', { threshold })
            : t('charts.protectedLegend', { threshold })}
        </span>
      </div>
    </figure>
  )
}
