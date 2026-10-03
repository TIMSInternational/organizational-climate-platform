import { useTranslation } from '../../../i18n'
import {
  BAND_PAINT,
  BandGlyph,
  BandLegend,
  ProtectedCell,
  bandCellStyle,
  bandName,
  bandOf,
  bandShortName,
  formatMetric,
  type ClimateMapSelection,
  type ResultBands,
} from '../../../components/charts'
import { PROTECTED_HATCH } from '../../../components/charts/suppression'
import { Table } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import type { ResultsGroupRow, ResultsPrevious } from './model'
import { deltaInkOf } from './tint'

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

export interface ResultsClimateGridProps {
  /** The company's result bands: every cell is painted and named by the one it falls in. */
  bands: ResultBands
  /** The columns, in the survey author's order, with their display names. */
  dimensions: readonly { key: string; name: string }[]
  rows: readonly ResultsGroupRow[]
  /** The whole survey's rounded reading per column, and its two-decimal mean. */
  company: { scores: readonly (number | null)[]; mean: number | null }
  /**
   * The previous wave, measured (`compose.ts` `composePrevious`). Without one — a first
   * wave, or a request that failed — the grid draws no "Frente a" column at all rather
   * than a column of dashes, and the note under it says why.
   */
  previous: ResultsPrevious
  /** The whole company's change since the previous wave, unrounded; `null` without one. */
  companyDelta: number | null
  /** Each column's change since the previous wave, unrounded, aligned to `dimensions`. */
  dimensionDeltas: readonly (number | null)[]
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
 * - **A real table**, so the axes are announced as headers and the colour is a third
 *   encoding, never the only one — every cell prints its band's name under the number,
 *   carries the band's glyph, and says the band in its accessible label.
 * - **`ProtectedCell` for every withheld reading**, and the four-layer privacy rule: a
 *   protected row is hatched in every cell, its mean and its delta included, and never
 *   prints a number anywhere. Its cells are inert — never a button — so a reader who
 *   tabs across the row learns nothing the hatch does not already say.
 * - **Keyboard operable**: a disclosed cell is a `<button>` wrapping the painted box,
 *   with the base `button` rule turned off (`index.css` styles every bare `button` as
 *   a carded control) and no `outline` of its own, so the app's one focus ring
 *   survives (`keyboardOperable.test.tsx`).
 * - **The tints** are the band's chip pair (`bandCellStyle`): green, amber and red from
 *   the product palette, the same three every banded screen paints with.
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
  bands,
  dimensions,
  rows,
  company,
  previous,
  companyDelta,
  dimensionDeltas,
  threshold,
  selection,
  panelId,
  onSelectCell,
}: ResultsClimateGridProps) {
  const { t, locale } = useTranslation()
  const score = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)
  const score2 = (value: number) => formatMetric(value, { kind: 'number', decimals: 2 }, locale)
  // Rounded to what is printed first, so the sign and the ink agree with the figure.
  const signed = (value: number) => {
    const shown = Math.round(value * 10) / 10 || 0
    return `${shown > 0 ? '+' : ''}${score(shown)}`
  }
  const compare = previous.status === 'loaded' ? previous.wave : null
  const columns = dimensions.length + (compare ? 3 : 2)

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
        <caption className="sr-only">{t('resultBands.results.gridCaption')}</caption>
        <colgroup>
          <col style={{ width: 140 }} />
          {dimensions.map((dimension) => (
            <col key={dimension.key} />
          ))}
          <col style={{ width: 96 }} />
          {compare && <col style={{ width: 96 }} />}
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
            {compare && (
              <th scope="col" className={HEAD}>
                {t('surveyResults.next.vsWave', { wave: compare.code })}
              </th>
            )}
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
              const delta = compare ? (dimensionDeltas[index] ?? null) : null
              const band = value === null ? null : bandOf(value, bands)
              return (
                <td key={dimension.key} className={cn(CELL, 'text-center')}>
                  <span className="flex flex-col items-center gap-px">
                    <span className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-fg-primary">
                      {band && (
                        <span style={{ color: BAND_PAINT[band].ink }} className="inline-flex">
                          <BandGlyph band={band} />
                        </span>
                      )}
                      {value === null ? '—' : score(value)}
                      {band && <span className="sr-only">{` — ${bandName(band, bands, t)}`}</span>}
                    </span>
                    {value !== null && delta !== null && (
                      <span className={cn('font-mono text-2xs tabular-nums', deltaInkOf(delta, 1))}>{signed(delta)}</span>
                    )}
                  </span>
                </td>
              )
            })}
            <td className={cn(CELL, 'text-center')}>
              {company.mean === null ? (
                <span className="font-mono text-sm text-fg-primary">—</span>
              ) : (
                // The mean is printed at two decimals, so it is judged at two.
                <MeanChip mean={company.mean} bands={bands} text={score2(company.mean)} />
              )}
            </td>
            {compare && (
              <td
                className={cn(
                  CELL,
                  'text-center font-mono text-xs font-semibold tabular-nums',
                  companyDelta === null ? 'text-fg-label' : deltaInkOf(companyDelta, 1),
                )}
              >
                {company.mean === null || companyDelta === null ? '—' : signed(companyDelta)}
              </td>
            )}
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
                          suppressedClassName="h-11 w-full"
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
                  const band = bandOf(value, bands)
                  const short = bandShortName(band, bands, t)
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
                          data-band={band}
                          className="flex h-11 w-full flex-col items-center justify-center gap-px overflow-hidden rounded border px-1"
                          style={{ ...bandCellStyle(band), ...(cellOpen ? { boxShadow: OPEN_RING } : {}) }}
                          title={bandName(band, bands, t)}
                        >
                          <span className="sr-only">{`${description}: `}</span>
                          <span className="font-mono text-sm font-semibold tabular-nums">{score(value)}</span>
                          <span className="sr-only">{` — ${bandName(band, bands, t)}`}</span>
                          {/* The band's word under the number, so the cell never speaks in
                              colour alone; hidden from AT, which already heard the name. */}
                          <span
                            aria-hidden="true"
                            className="inline-flex max-w-full items-center gap-0.75 text-3xs font-semibold uppercase tracking-label"
                          >
                            <BandGlyph band={band} />
                            <span className="truncate">{short}</span>
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
                  ) : row.mean === null ? (
                    <span className="font-mono text-base tabular-nums text-fg-primary">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-mono text-base tabular-nums text-fg-primary">
                      <span style={{ color: BAND_PAINT[bandOf(row.mean, bands)].ink }} className="inline-flex">
                        <BandGlyph band={bandOf(row.mean, bands)} />
                      </span>
                      {score(row.mean)}
                      <span className="sr-only">{` — ${bandName(bandOf(row.mean, bands), bands, t)}`}</span>
                    </span>
                  )}
                </td>
                {compare && (
                  <td className={cn(CELL, 'text-center text-xs text-fg-label')}>
                    {row.isProtected ? (
                      // Hatched too: a withheld group's change is as withheld as its
                      // level, and a dash would read as "no previous wave".
                      <ProtectedCell
                        responses={0}
                        threshold={threshold}
                        description={`${row.name}, ${t('surveyResults.next.vsWave', { wave: compare.code })}`}
                        showWord={false}
                        suppressedClassName="mx-auto h-8.5 w-12"
                      >
                        {null}
                      </ProtectedCell>
                    ) : row.vsPrevious === null ? (
                      // The previous wave withheld this group, or did not have it: there
                      // is nothing to compare with, said in words and never as a 0.
                      t('surveyResults.next.noPrevious', { wave: compare.code })
                    ) : (
                      <span className={cn('font-mono tabular-nums', deltaInkOf(row.vsPrevious, 1))}>
                        {signed(row.vsPrevious)}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </Table>

      <BandLegend bands={bands} testId="grid-legend">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('inline-block size-4 rounded-xs bg-surface-icon-box', PROTECTED_HATCH)} />
          {t('surveyResults.next.legendProtected', { floor: threshold })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3 rounded-xs border-2 border-fg-primary" />
          {t('surveyResults.next.legendOpen')}
        </span>
      </BandLegend>
    </div>
  )
}

/**
 * The whole company's two-decimal mean with its band's glyph, as the group means below it
 * are drawn. The artboard put the band's word in a chip here, which does not fit the 96px
 * column beside "Frente a Q2"; the word is in the CLIMA tile above, in the title, and
 * said to a screen reader.
 */
function MeanChip({ mean, bands, text }: { mean: number; bands: ResultBands; text: string }) {
  const { t } = useTranslation()
  const band = bandOf(mean, bands, 2)
  return (
    <span
      data-band={band}
      title={bandName(band, bands, t)}
      className="inline-flex items-center gap-1.5 font-mono text-sm tabular-nums text-fg-primary"
    >
      <span style={{ color: BAND_PAINT[band].ink }} className="inline-flex">
        <BandGlyph band={band} />
      </span>
      {text}
      <span className="sr-only">{` — ${bandName(band, bands, t)}`}</span>
    </span>
  )
}
