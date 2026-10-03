import type { ReactNode } from 'react'
import { useTranslation } from '../../../../i18n'
import {
  BAND_PAINT,
  BandGlyph,
  BandLegend,
  CHART_AXIS,
  CHART_GRID,
  ProtectedCell,
  bandCellStyle,
  bandName,
  bandOf,
  bandShortName,
  formatMetric,
  type ResultBandKey,
  type ResultBands,
} from '../../../../components/charts'
import { PROTECTED_HATCH } from '../../../../components/charts/suppression'
import { Table } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'
import { dimensionLabel } from '../../../surveys/dimensionLabel'
import { SCALE_MAX, SCALE_MIN, onScale, type SharedGroupMap } from './derive'

/**
 * The drawn pieces of the SharedReport artboard (10 Sep), kept apart from the page so
 * that `SharedReportNextPage.tsx` reads as what it is: a token resolved once, one failure
 * state, and a document laid out. Every colour here is a token and every withheld reading
 * goes through `ProtectedCell`, the grammar the rest of the product already uses.
 */

/** The artboard's white card: 8px radius on the hairline, a serif heading, a quiet meta line. */
export function ReportCard({
  id,
  heading,
  meta,
  children,
}: {
  id: string
  /** Already-translated. Rendered as the card's `<h2>` — 20px serif, per `index.css`. */
  heading: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 py-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="m-0">
          {heading}
        </h2>
        {meta !== undefined && <span className="text-xs text-fg-tertiary">{meta}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * One of the three readings across the top: a label, a figure with its unit beside it,
 * and one line saying what the figure does not say.
 *
 * `value` is a string rather than a number because two of the three tiles on the artboard
 * hold a sentence — "No se calcula" — where a number would be. A tile that had to hold a
 * number would have printed `0` there, which is the reading this page must never give.
 */
export function ReadingCard({
  label,
  value,
  numeric = true,
  unit,
  note,
}: {
  label: string
  value: string
  /** Whether `value` is a figure (mono, tabular) or a sentence. */
  numeric?: boolean
  unit?: string
  note: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-line-default bg-surface-card px-4 py-3.5 shadow-sm">
      <span className="text-2xs font-bold uppercase tracking-label text-fg-tertiary">{label}</span>
      <span className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            'text-fg-primary',
            numeric ? 'font-mono text-kpi-hero tabular-nums' : 'text-2xl',
          )}
        >
          {value}
        </span>
        {unit !== undefined && <span className="text-sm text-fg-secondary">{unit}</span>}
      </span>
      <span className="text-xs leading-snug text-fg-tertiary">{note}</span>
    </div>
  )
}

/**
 * The 1-to-5 strip in the dimension table: the scale with the company's three areas laid
 * behind it in their tints, a dashed rule at each boundary, and the reading as one dot in
 * its area's colour.
 *
 * `aria-hidden`, and that is the rule this repository states about colour: the row prints
 * the figure in its own column and the reading in words beside it, so the strip adds a
 * shape to something already said twice. A screen reader that announced it would announce
 * a third copy.
 *
 * The dot takes the band's accent (`BAND_PAINT.line`), not its chip fill: the fills are
 * pale enough on the card surface that an 8px dot would disappear.
 */
export function ScaleStrip({
  value,
  bands,
  band,
}: {
  /** On the 1-to-5 scale. A reading off it has no strip at all — see `onScale`. */
  value: number
  bands: ResultBands
  band: ResultBandKey
}) {
  const width = 200
  const pad = 6
  const span = width - pad * 2
  // Clamped, so a reading the caller should not have sent cannot draw a dot outside the
  // strip. The caller's guard is `onScale`; this is the one that holds if it is ever
  // forgotten, because a dot at x = 340 in a 200px box is drawn over the next column.
  const at = (score: number) =>
    pad + (Math.min(Math.max(score, SCALE_MIN), SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * span
  const ticks = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, index) => SCALE_MIN + index)
  const zones: { key: ResultBandKey; from: number; to: number }[] = [
    { key: 'critical', from: SCALE_MIN, to: bands.opportunityMin },
    { key: 'opportunity', from: bands.opportunityMin, to: bands.strengthMin },
    { key: 'strength', from: bands.strengthMin, to: SCALE_MAX },
  ]

  return (
    <svg aria-hidden="true" focusable="false" width={width} height={14} viewBox={`0 0 ${width} 14`} data-band={band}>
      {zones.map((zone) => (
        <rect
          key={zone.key}
          x={at(zone.from)}
          y={2}
          width={Math.max(at(zone.to) - at(zone.from), 0)}
          height={10}
          fill={BAND_PAINT[zone.key].zone}
        />
      ))}
      <line x1={pad} y1={7} x2={width - pad} y2={7} stroke={CHART_GRID} strokeWidth={2} strokeLinecap="round" />
      {ticks.map((tick) => (
        <line key={tick} x1={at(tick)} y1={4} x2={at(tick)} y2={10} stroke={CHART_GRID} strokeWidth={1} />
      ))}
      {[bands.opportunityMin, bands.strengthMin].map((boundary) => (
        <line
          key={boundary}
          x1={at(boundary)}
          y1={1}
          x2={at(boundary)}
          y2={13}
          stroke={CHART_AXIS}
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ))}
      <circle cx={at(value)} cy={7} r={4} fill={BAND_PAINT[band].line} />
    </svg>
  )
}

/**
 * The climate map: one row per group, one column per dimension, hatched wherever the
 * floor withheld a group.
 *
 * ## The four rules it keeps
 *
 * - **A real table.** The axes are announced as headers and the colour is never alone:
 *   every disclosed cell prints its band's name and glyph under the figure, and says the
 *   name to a screen reader.
 * - **A protected row is hatched in every cell and prints no number anywhere.**
 *   `SharedGroupRow.scores` is all `null` for such a row (`derive.ts`), so there is no
 *   figure on the shape this component receives — it could not print one if it tried.
 * - **The cells are inert.** `ResultsClimateGrid` opens a cell into a question panel
 *   because its reader is inside the tenant; this reader is anonymous and there is
 *   nothing further to open, so nothing here is a button.
 * - **The tints are the band's chip pair**, the same three the authenticated results grid
 *   paints with. Without a scale on the payload (`bands === null`) a cell keeps its figure
 *   and is judged by nothing.
 */
export function ClimateMapGrid({
  map,
  floor,
  bands,
  caption,
  groupHeading,
}: {
  map: SharedGroupMap
  floor: number
  bands: ResultBands | null
  /** Already-translated table caption. */
  caption: string
  /** Already-translated name of the row axis, for the corner header. */
  groupHeading: string
}) {
  const { t, locale } = useTranslation()
  const score = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)

  return (
    // `w-auto`, not the primitive's `w-full`, and every column a fixed width: the
    // artboard's map cell is ~156px and a report's breakdown can carry as few as two
    // dimensions. Told to fill the card, two columns became two 515px bars of colour —
    // a heat map with nothing to compare across. Fixed widths keep a cell a cell; past
    // the card's width the primitive's own container scrolls, never the page.
    <Table className="w-auto table-fixed border-separate border-spacing-1 text-base">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col style={{ width: 150 }} />
        {map.columns.map((column) => (
          <col key={column} style={{ width: 156 }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="sr-only border-0 p-0">
            {groupHeading}
          </th>
          {map.columns.map((column) => (
            <th
              key={column}
              scope="col"
              className="border-0 p-0 text-center align-bottom text-2xs font-bold uppercase leading-tight tracking-label text-fg-tertiary [overflow-wrap:normal]"
            >
              {dimensionLabel(column, t)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {map.rows.map((row) => (
          <tr key={row.id} data-testid={`map-row-${row.id}`} className="hover:bg-transparent">
            <th
              scope="row"
              className="sticky left-0 z-10 border-0 bg-surface-card p-0 text-left text-base font-normal text-fg-primary"
            >
              {row.name}
            </th>
            {map.columns.map((column, index) => {
              const description = `${row.name}, ${dimensionLabel(column, t)}`
              if (row.protected) {
                return (
                  <td key={column} className="border-0 p-0">
                    <ProtectedCell
                      // 0, never a count off the row: there is none on the shape, the
                      // parser zeroed it and the server zeroed it first.
                      responses={0}
                      threshold={floor}
                      description={description}
                      // The legend under the grid states the hatch once for the whole
                      // map; a 34px cell has no room for the word.
                      showWord={false}
                      suppressedClassName="h-8.5 w-full"
                    >
                      {null}
                    </ProtectedCell>
                  </td>
                )
              }
              const value = row.scores[index] ?? null
              if (value === null) {
                return (
                  <td key={column} className="border-0 p-0 text-center text-fg-tertiary">
                    {t('surveyResults.notApplicable')}
                  </td>
                )
              }
              if (!onScale(value) || bands === null) {
                // A reading that is not on the 1-to-5 scale the bands belong to — an
                // eNPS average, say — or a payload with no scale at all. It keeps its
                // figure and loses its tint: painting it would state an area it was never
                // measured against. `derive.ts` `SCALE_MIN` records the whole argument.
                return (
                  <td key={column} className="border-0 p-0">
                    <span className="flex h-8.5 w-full items-center justify-center rounded-md bg-surface-icon-box font-mono text-sm tabular-nums text-fg-primary">
                      <span className="sr-only">{`${description}: `}</span>
                      {score(value)}
                    </span>
                  </td>
                )
              }
              // The product's own band function with the company's scale — not a second
              // copy of the thresholds. Two implementations of one rule is how a cell
              // reads critical on one screen and opportunity on another.
              const band = bandOf(value, bands)
              return (
                <td key={column} className="border-0 p-0">
                  <span
                    data-band={band}
                    className="flex h-10 w-full flex-col items-center justify-center gap-px overflow-hidden rounded-md border px-1"
                    style={bandCellStyle(band)}
                    title={bandName(band, bands, t)}
                  >
                    <span className="sr-only">{`${description}: `}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums">{score(value)}</span>
                    <span className="sr-only">{` — ${bandName(band, bands, t)}`}</span>
                    <span
                      aria-hidden="true"
                      className="inline-flex max-w-full items-center gap-0.75 text-3xs font-semibold uppercase tracking-label"
                    >
                      <BandGlyph band={band} />
                      <span className="truncate">{bandShortName(band, bands, t)}</span>
                    </span>
                  </span>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** The map's key: the company's three areas, then the hatch. */
export function ClimateMapLegend({ floor, bands }: { floor: number; bands: ResultBands | null }) {
  const { t } = useTranslation()
  const hatch = (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('inline-block size-4 rounded-xs bg-surface-icon-box', PROTECTED_HATCH)} />
      {t('surveyResults.next.legendProtected', { floor })}
    </span>
  )
  if (bands === null) return <div className="flex flex-wrap items-center gap-4 text-xs text-fg-tertiary">{hatch}</div>
  return (
    <BandLegend bands={bands} short className="text-fg-tertiary">
      {hatch}
    </BandLegend>
  )
}

/** One of the three standing promises at the foot of the report. */
export function PrivacyNote({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  /** Already-translated. */
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        <span className="text-sm leading-snug text-fg-secondary">{children}</span>
      </span>
    </div>
  )
}
