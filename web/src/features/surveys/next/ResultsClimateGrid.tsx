import { useTranslation } from '../../../i18n'
import {
  DIVERGING_COLORS,
  ProtectedCell,
  formatMetric,
  type ClimateMapSelection,
} from '../../../components/charts'
import { PROTECTED_HATCH } from '../../../components/charts/suppression'
import { Table } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { CLIMATE_TARGET, targetBand, type TargetBand } from './derive'
import type { ResultsGroupRow, ResultsSampleWave } from './model'
import { tintOf } from './tint'

/**
 * The open cell's ring, from the OUTSIDE: a 2px gap in the card's own surface and a
 * 2px ring in the primary ink, which is what the artboard draws
 * (`box-shadow: 0 0 0 2px #fff, 0 0 0 4px #110a29`). The gap is painted rather than
 * left transparent because a 4px grid gap is exactly where the ring lands, and the
 * surface behind it is this card's. `outline` is left free for the focus ring.
 */
const OPEN_RING = '0 0 0 2px var(--admin-bg-card), 0 0 0 4px var(--admin-font-primary)'

/**
 * Every `th`/`td` of the grid: no padding and no hairline. `index.css` gives every
 * table cell a 10px pad and a bottom border, which on this grid would draw a rule
 * under every tinted cell; the gaps between cells are the table's `border-spacing`.
 */
const CELL = 'border-0 p-0'
/** The artboard's `.label`: 10px, bold, uppercase, 0.06em, the tertiary ink. */
// `[overflow-wrap:normal]`: `index.css` lets a cell break an unbreakable run anywhere,
// which on a narrow column split "RECONOCIMIENTO" mid-word (measured at 1024). A label
// wraps between words here, and the grid's minimum width keeps every word on a line.
const HEAD = cn(
  CELL,
  'text-center align-bottom text-2xs font-bold uppercase leading-tight tracking-label text-fg-label [overflow-wrap:normal]',
)
/** The row labels stay put while a narrow viewport scrolls the grid under them. */
const STICKY = 'sticky left-0 z-10 bg-surface-card'
/** `index.css` tints every body row on hover; a grid of coloured cells must not flash. */
const ROW = 'hover:bg-transparent'

/** Which of the three target sentences a band announces, for the screen reader. */
function bandKey(band: TargetBand): string {
  if (band === 'far-below' || band === 'below') return 'charts.belowTarget'
  if (band === 'on') return 'charts.onTarget'
  return 'charts.aboveTarget'
}

export interface ResultsClimateGridProps {
  /** The columns, in the survey author's order, with their display names. */
  dimensions: readonly { key: string; name: string }[]
  rows: readonly ResultsGroupRow[]
  /** The whole survey's rounded reading per column, and its two-decimal mean. */
  company: { scores: readonly (number | null)[]; mean: number | null }
  /** The wave-over-wave deltas, sample until phase 2 — the chip says so. */
  sample: ResultsSampleWave
  /** The anonymity floor, per company. */
  threshold: number
  selection: ClimateMapSelection | null
  /** The id of the opened-cell panel, for `aria-controls` on the open cell. */
  panelId: string
  onSelectCell: (rowId: string, dimensionKey: string) => void
}

/**
 * The climate map of the redesigned results page: ONE grid, as the `SurveyResults`
 * artboard draws it — a label column, one column per dimension, "Media del grupo"
 * and "Frente a Q2"; the whole company first (a mean and a delta per cell), then the
 * groups, then the legend.
 *
 * ## Why this is not `ClimateMap`
 *
 * `ClimateMap` is a group × dimension grid and nothing else: it cannot carry a leading
 * whole-company row, two trailing reading columns, or the artboard's asymmetric target
 * band (`targetBand`: grey down to 0,2 under the target, blue from 0,1 over it), and
 * giving it all three would change the dashboard's map on the way. So the artboard's
 * grid is drawn here, with the same building blocks and the same rules the map has:
 *
 * - **A real table**, so the axes are announced as headers and the colour is a second
 *   encoding, never the only one — every cell says "below the target of 3,7" in words.
 * - **`ProtectedCell` for every withheld reading**, and the four-layer privacy rule: a
 *   protected row is hatched in every cell, its mean and its delta included, and never
 *   prints a number anywhere. Its cells are inert — never a button — so a reader who
 *   tabs across the row learns nothing the hatch does not already say.
 * - **Keyboard operable**: a disclosed cell is a `<button>` wrapping the painted box,
 *   with the base `button` rule turned off (`index.css` styles every bare `button` as
 *   a carded control) and no `outline` of its own, so the app's one focus ring
 *   survives (`keyboardOperable.test.tsx`).
 * - **The tints** are the five diverging tokens (`tint.ts`), the ramp the dashboard's
 *   map and the distribution strips read, so red means the same thing on every screen.
 *
 * ## The geometry
 *
 * The artboard's `grid-template-columns: 140px repeat(6, minmax(0, 1fr)) 96px 96px`
 * with 4px gaps, as a fixed-layout table: a `<colgroup>` pins the label and the two
 * trailing columns, the dimension columns share the rest, and `border-spacing` is the
 * gap. Group cells are 40px tall (`h-10`), the artboard's map row height. Below the
 * grid's minimum width `Table`'s own container scrolls it, never the page, and the
 * row labels stay pinned so a scrolled cell still says whose it is.
 */
export default function ResultsClimateGrid({
  dimensions,
  rows,
  company,
  sample,
  threshold,
  selection,
  panelId,
  onSelectCell,
}: ResultsClimateGridProps) {
  const { t, locale } = useTranslation()
  const score = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)
  const score2 = (value: number) => formatMetric(value, { kind: 'number', decimals: 2 }, locale)
  const signed = (value: number) => `${value > 0 ? '+' : ''}${score(value)}`
  const columns = dimensions.length + 3
  const deltaInk = (value: number) => (value >= 0 ? 'text-accent-green-ink' : 'text-accent-red-ink')

  return (
    <div className="flex flex-col gap-3">
      <Table
        data-testid="climate-grid"
        // `border-separate` + `border-spacing-1`: the artboard's 4px gaps between
        // cells, over the primitive's `border-collapse`. `table-fixed` so the
        // `<colgroup>` widths are honoured and the dimension columns share the rest.
        // 59rem is where it stops shrinking and scrolls instead: ~96px per dimension,
        // the narrowest a one-word label ("RECONOCIMIENTO") fits — met from 1280 up,
        // scrolled inside the card at 1024 (measured in the 1024 shot).
        className="min-w-[59rem] table-fixed border-separate border-spacing-1 text-base"
      >
        <caption className="sr-only">{t('surveyResults.next.gridCaption', { target: score(CLIMATE_TARGET) })}</caption>
        <colgroup>
          <col style={{ width: 140 }} />
          {dimensions.map((dimension) => (
            <col key={dimension.key} />
          ))}
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
        </colgroup>
        <thead>
          <tr className={ROW}>
            <td className={cn(CELL, STICKY)} />
            {dimensions.map((dimension) => (
              <th key={dimension.key} scope="col" className={HEAD}>
                {dimension.name}
              </th>
            ))}
            <th scope="col" className={HEAD}>
              {t('surveyResults.next.groupMean')}
            </th>
            {/* The deltas are the one sample on the grid; their chip sits on the note
                under the legend that explains them — a 96px header cannot hold it. */}
            <th scope="col" className={HEAD}>
              {t('surveyResults.next.vsWave', { wave: sample.previousCode })}
            </th>
          </tr>
        </thead>
        <tbody>
          {/* The whole company first, in bold: one rounded mean per column with the
              wave delta under it, then the two-decimal mean and its delta. Not a
              button — there is no cell to open for the company as a whole. */}
          <tr data-testid="company-row" className={ROW}>
            <th scope="row" className={cn(CELL, STICKY, 'text-left text-sm font-semibold text-fg-primary')}>
              {t('surveyResults.next.wholeCompany')}
            </th>
            {dimensions.map((dimension, index) => {
              const value = company.scores[index] ?? null
              const delta = sample.dimensionDeltas[dimension.key]
              return (
                <td key={dimension.key} className={cn(CELL, 'text-center')}>
                  <span className="flex flex-col items-center gap-px">
                    <span className="font-mono text-sm tabular-nums text-fg-primary">
                      {value === null ? '—' : score(value)}
                    </span>
                    {value !== null && delta !== undefined && (
                      <span className={cn('font-mono text-2xs tabular-nums', deltaInk(delta))}>{signed(delta)}</span>
                    )}
                  </span>
                </td>
              )
            })}
            <td className={cn(CELL, 'text-center font-mono text-sm tabular-nums text-fg-primary')}>
              {company.mean === null ? '—' : score2(company.mean)}
            </td>
            <td className={cn(CELL, 'text-center font-mono text-xs font-semibold tabular-nums', deltaInk(sample.averageDelta))}>
              {company.mean === null ? '—' : signed(sample.averageDelta)}
            </td>
          </tr>
          {/* The hairline under the company row, as its own row so it spans the gaps. */}
          <tr aria-hidden="true" className={ROW}>
            <td colSpan={columns} className={cn(CELL, 'pb-1')}>
              <span className="block h-px w-full bg-line-light" />
            </td>
          </tr>
          {rows.map((row) => {
            const rowOpen = selection?.rowId === row.id
            return (
              <tr key={row.id} data-testid={`group-row-${row.id}`} className={ROW}>
                <th
                  scope="row"
                  className={cn(
                    CELL,
                    STICKY,
                    'text-left text-base text-fg-primary',
                    rowOpen ? 'font-semibold' : 'font-normal',
                  )}
                >
                  {row.name}
                </th>
                {dimensions.map((dimension, index) => {
                  const description = `${row.name}, ${dimension.name}`
                  if (row.isProtected) {
                    return (
                      <td key={dimension.key} className={CELL}>
                        <ProtectedCell
                          // 0, not `row.responses`: the withheld count travels no
                          // further than the row decision (`ClimateMap` does the same).
                          responses={0}
                          threshold={threshold}
                          description={description}
                          // The legend under the grid states the hatch once for
                          // every cell; a 40px cell has no room for the word.
                          showWord={false}
                          suppressedClassName="h-10 w-full"
                        >
                          {null}
                        </ProtectedCell>
                      </td>
                    )
                  }
                  const value = row.scores[index]
                  if (value === null || value === undefined) {
                    return (
                      <td key={dimension.key} className={cn(CELL, 'text-center text-fg-label')}>
                        —
                      </td>
                    )
                  }
                  const band = targetBand(value)
                  const cellOpen = rowOpen && selection?.dimensionKey === dimension.key
                  return (
                    <td key={dimension.key} className={CELL}>
                      <button
                        type="button"
                        onClick={() => onSelectCell(row.id, dimension.key)}
                        aria-expanded={cellOpen}
                        aria-controls={cellOpen ? panelId : undefined}
                        // The base `button` rule's height, padding, card surface
                        // and border are all turned off; the focus ring is the
                        // global `:focus-visible` outline, untouched.
                        className="block h-auto w-full cursor-pointer rounded border-0 bg-transparent p-0 shadow-none hover:bg-transparent hover:outline-2 hover:outline-offset-2 hover:outline-fg-primary"
                      >
                        <span
                          className="flex h-10 w-full items-center justify-center rounded font-mono text-sm tabular-nums"
                          style={{ ...tintOf(band), ...(cellOpen ? { boxShadow: OPEN_RING } : {}) }}
                        >
                          <span className="sr-only">{`${description}: `}</span>
                          {score(value)}
                          <span className="sr-only">
                            {` — ${t(bandKey(band), { target: score(CLIMATE_TARGET) })}`}
                          </span>
                        </span>
                      </button>
                    </td>
                  )
                })}
                <td className={cn(CELL, 'text-center')}>
                  {row.isProtected ? (
                    <ProtectedCell
                      responses={0}
                      threshold={threshold}
                      description={`${row.name}, ${t('surveyResults.next.groupMean')}`}
                      // The artboard prints the word where the number would be.
                      mark="word"
                      suppressedClassName="h-8.5 w-full"
                    >
                      {null}
                    </ProtectedCell>
                  ) : (
                    <span className="font-mono text-base tabular-nums text-fg-primary">
                      {row.mean === null ? '—' : score(row.mean)}
                    </span>
                  )}
                </td>
                <td className={cn(CELL, 'text-center text-xs text-fg-label')}>
                  {row.isProtected ? (
                    // Hatched too: a withheld group's change is as withheld as its
                    // level, and a dash would read as "no previous wave".
                    <ProtectedCell
                      responses={0}
                      threshold={threshold}
                      description={`${row.name}, ${t('surveyResults.next.vsWave', { wave: sample.previousCode })}`}
                      showWord={false}
                      suppressedClassName="mx-auto h-8.5 w-12"
                    >
                      {null}
                    </ProtectedCell>
                  ) : (
                    t('surveyResults.next.noPrevious', { wave: sample.previousCode })
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-label" data-testid="grid-legend">
        <span className="inline-flex items-center gap-1">
          <Swatch step={0} />
          <Swatch step={1} />
          {t('surveyResults.next.legendBelow')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Swatch step={2} />
          {t('surveyResults.next.legendOn')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Swatch step={3} />
          <Swatch step={4} />
          {t('surveyResults.next.legendAbove')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className={cn('inline-block size-2.5 rounded-xs bg-surface-icon-box', PROTECTED_HATCH)} />
          {t('surveyResults.next.legendProtected', { floor: threshold })}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-3 rounded-xs border-2 border-fg-primary" />
          {t('surveyResults.next.legendOpen')}
        </span>
      </div>
    </div>
  )
}

/** One legend key, painted from the same token the cells of that band are. */
function Swatch({ step }: { step: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 rounded-xs"
      style={{ backgroundColor: DIVERGING_COLORS[step] }}
    />
  )
}
