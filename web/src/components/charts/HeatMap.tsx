import { useTranslation } from '../../i18n'
import { Table } from '../ui'
import { SEQUENTIAL_COLORS, sequentialPair } from './palette'
import type { ChartStateProps } from './types'

export interface HeatMapCell {
  /** Column key. */
  x: string
  /** Row key. */
  y: string
  value: number
}

interface HeatMapProps extends ChartStateProps {
  data: readonly HeatMapCell[]
  /**
   * Render the number inside each cell.
   *
   * On by default since #208 added a paired ink token per ramp step. Turn it off
   * for a dense grid where the numbers would not fit; the value stays in the
   * cell's accessible name either way, so nothing is hidden from assistive tech.
   */
  showValues?: boolean
}

/**
 * Magnitude across two categorical dimensions — the standard form for
 * "score by department by dimension".
 *
 * Consolidates legacy `charts/HeatMap` and `widgets/heatmap`, which were two
 * implementations of the same thing (`{x, y, value}` in both; the widget added
 * optional labels and six per-instance colour schemes). One survives, and it uses
 * **the single validated sequential ramp** rather than a per-instance hue choice:
 * sequential means one hue, and letting each caller pick a different one makes two
 * heatmaps on the same page incomparable.
 *
 * ## Rendered as a real `<table>`
 *
 * The legacy versions built a grid of `<div>`s. A heatmap *is* a table of numbers,
 * so this uses table semantics — which gives row and column headers, navigation,
 * and announced cell context for free, and removes the need for a separate
 * table-view fallback. The colour is then genuinely redundant encoding rather than
 * the only encoding.
 */
export default function HeatMap({
  data,
  title,
  isLoading = false,
  showValues = true,
}: HeatMapProps) {
  const { t } = useTranslation()

  const usable = data.filter((cell) => Number.isFinite(cell.value))
  const isEmpty = usable.length === 0

  // Insertion order, not sorted: the caller decides the axis order, and sorting
  // here would silently reorder a deliberately-ordered axis such as months.
  const xLabels = [...new Set(usable.map((cell) => cell.x))]
  const yLabels = [...new Set(usable.map((cell) => cell.y))]

  // NUL joins the two axis labels into one map key. It is the right separator:
  // no label can contain it, so no two (x, y) pairs can collide. With a space,
  // ('a b', 'c') and ('a', 'b c') would both key to "a b c" and one cell would
  // silently take the other's value.
  //
  // It is written as a `\u0000` escape rather than as the raw byte. It *was*
  // the raw byte: two unprintable NULs in this file made it `data` instead of
  // text, so `git diff` reported "Binary files differ", GitHub would not render
  // it, and `grep` skipped it entirely. Same key, readable source.
  const cellKey = (x: string, y: string) => `${x}\u0000${y}`

  const byPosition = new Map(usable.map((cell) => [cellKey(cell.x, cell.y), cell.value]))

  const values = usable.map((cell) => cell.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat dataset has no range to normalise against; dividing by zero would put
  // every cell at NaN and blank the whole grid.
  const span = max - min

  return (
    <figure className="m-0 flex flex-col gap-2">
      {title ? <figcaption className="text-lg font-medium text-fg-primary">{title}</figcaption> : null}

      {isLoading ? (
        <div
          role="status"
          aria-label={t('charts.loadingChart')}
          className="h-40 animate-pulse rounded-md border border-line-default bg-surface-icon-box"
        />
      ) : isEmpty ? (
        <p role="status" className="text-fg-secondary">
          {t('charts.noData')}
        </p>
      ) : (
        <>
          {/* `w-auto` is load-bearing. `Table` defaults to `w-full`, which stretched
              the row-label column across the whole content width and stranded the
              coloured cells against the right edge -- a grid you cannot read a row
              off. Shrink-to-fit needs the wrapper as well: the `<figure>` above is a
              flex column, so a table that is a direct flex child is stretched again
              regardless. `Table`'s own `data-slot="table-container"` is that wrapper,
              which is why this is `<Table className="w-auto">` rather than a local
              one (#218) -- it also scrolls a many-column heatmap inside itself rather
              than pushing the page sideways.

              None of this is visible to happy-dom, which does no layout -- it was
              caught by rendering the chart gallery. */}
          <Table className="w-auto text-sm">
            {/* Generic on purpose: when a title is given the figcaption already names
                    this figure, and repeating it here makes a screen reader announce it
                    twice. */}
            <caption className="sr-only">{t('charts.tableCaption')}</caption>
            <thead>
              <tr>
                {/* Empty corner cell: it heads the row-label column, which has no
                    column name of its own. */}
                <td />
                {xLabels.map((x) => (
                  <th key={x} scope="col" className="px-2 text-left font-normal text-fg-secondary">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yLabels.map((y) => (
                <tr key={y}>
                  <th scope="row" className="pr-2 text-left font-normal text-fg-secondary">
                    {y}
                  </th>
                  {xLabels.map((x) => {
                    const value = byPosition.get(cellKey(x, y))
                    if (value === undefined) {
                      // A gap is a gap. An absent pair is not a zero score, and
                      // colouring it as one would invent data.
                      return <td key={x} className="h-8 w-12" />
                    }
                    const fraction = span === 0 ? 1 : (value - min) / span
                    // Fill and ink come out of one call so they cannot land on
                    // different ramp steps -- the ink is only measured against
                    // the fill it ships with (#208).
                    const { fill, ink } = sequentialPair(fraction)
                    return (
                      <td
                        key={x}
                        className="h-8 w-12 text-center"
                        // `color` is set even when the value is hidden: it is
                        // inherited, and a future child drawn in this cell should
                        // start from the ink that matches the fill rather than
                        // from the page's text colour.
                        style={{ backgroundColor: fill, color: ink }}
                        // The number reaches assistive tech and find-in-page even
                        // when it is not painted into the cell.
                        aria-label={`${y}, ${x}: ${value}`}
                      >
                        {showValues ? <span>{value}</span> : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </Table>

          <ScaleLegend min={min} max={max} />
        </>
      )}
    </figure>
  )
}

/**
 * The ramp with its endpoints labelled.
 *
 * Without endpoint labels a sequential ramp says "more" and "less" but not "more
 * than what" — the reader cannot tell a 2-point spread from a 40-point one.
 */
function ScaleLegend({ min, max }: { min: number; max: number }) {
  return (
    <div className="flex items-center gap-1 text-xs text-fg-secondary">
      <span>{min}</span>
      {SEQUENTIAL_COLORS.map((colour, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="h-2 w-4"
          style={{ backgroundColor: colour }}
        />
      ))}
      <span>{max}</span>
    </div>
  )
}
