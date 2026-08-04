import { useTranslation } from '../../i18n'
import { SEQUENTIAL_COLORS, sequentialColor } from './palette'
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
   * Off by default, and that is a considered default rather than laziness: the
   * sequential ramp runs light-to-dark in light mode and **dark-to-light in dark
   * mode**, so a single ink colour is legible against one end of the ramp and not
   * the other. Getting it right needs a paired ink token per ramp step, which is
   * not in the token layer yet. Until then the value is always in the cell's
   * accessible name, so nothing is hidden from assistive tech.
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
  showValues = false,
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
          className="h-40 animate-pulse rounded-md bg-surface-icon-box"
        />
      ) : isEmpty ? (
        <p role="status" className="text-fg-secondary">
          {t('charts.noData')}
        </p>
      ) : (
        <>
          {/* Both the wrapper and `w-auto` are load-bearing, and neither alone is
              enough. index.css sets `table { width: 100% }` for the app's data
              tables, which stretched the row-label column across the whole content
              width and stranded the coloured cells against the right edge -- a grid
              you cannot read a row off. `w-auto` restores shrink-to-fit, but the
              `<figure>` above is a flex column, so as a direct flex child the table
              was stretched again regardless. Inside a plain block wrapper it sizes to
              its content and sits at the left.

              The wrapper also earns its keep on its own: a heatmap with many columns
              has to scroll inside itself rather than push the page sideways.

              None of this is visible to happy-dom, which does no layout -- it was
              caught by rendering the chart gallery. */}
          <div className="overflow-x-auto">
            <table className="w-auto border-collapse text-sm">
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
                      return (
                        <td
                          key={x}
                          className="h-8 w-12 text-center"
                          style={{ backgroundColor: sequentialColor(fraction) }}
                          // The number reaches assistive tech and find-in-page even
                          // when it is not painted into the cell.
                          aria-label={`${y}, ${x}: ${value}`}
                        >
                          {showValues ? <span className="text-fg-primary">{value}</span> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
