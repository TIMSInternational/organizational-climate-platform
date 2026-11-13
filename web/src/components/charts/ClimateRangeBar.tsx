import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import BandChip from './BandChip'
import ClimateScaleAxis from './ClimateScaleAxis'
import ProtectedMark from './ProtectedMark'
import { CLIMATE_RANGE_COLUMNS, climateRangeOf, paintedSegments, scalePercent, type ClimateRangeGroup } from './climateRange'
import { bandOf, scoreText, type ResultBandKey, type ResultBands } from './resultBands'

/**
 * The climate range bar — the signature of the Apple design (canvas `.cb`/`.track`, on
 * Main, CompanyHome, TeamHome, Results and the ESPH boards). One row per dimension, read
 * like Weather's ten-day forecast:
 *
 * - **the track** is the 1–5 scale painted in the COMPANY's three result areas
 *   (`segmentsOf(bands)`), never a fixed 3,00 / 4,00 — bands are per company
 *   (`docs/decisions/result-bands.md`). A 2px seam in the card's colour separates the
 *   areas (HIG, Charts › Color: "add visual separation between contiguous areas of
 *   color");
 * - **the range** is the stretch between the lowest and the highest DISCLOSED group; the
 *   track outside it is dimmed to the track grey. With fewer than two visible groups the
 *   areas are painted whole but muted to 40 %: the ESPH board paints them at full strength,
 *   but in a list beside ranged rows a full-strength track reads as a range from 1 to 5;
 * - **the dot** is the row's own mean as the server served it (white, ringed in the label
 *   ink, so it reads on every area in both themes);
 * - **the tick**, when there is a comparison (the organization on a team view), is a thin
 *   line at the comparison's mean;
 * - **both marks wear a 2px halo in the card's colour.** The label ink alone fails on the
 *   areas in dark (#f1f3f8 on the amber #e59a14 is 2.11:1, measured), and the card colour
 *   alone fails on the track; one of the two always clears 3:1 against what is beside it
 *   (WCAG 1.4.11; HIG, Charts › Color, on separating contiguous colour);
 * - **the end** is the band chip — glyph and name, colour never alone — and the value at
 *   two decimals in the reader's locale ("3,74"; "74,8" on a company that reads 0–100).
 *
 * ## Privacy
 *
 * Groups arrive as served: `{ name, mean, protected }`. A protected group, or one with no
 * mean, never enters the range, the caption or the accessible label (`climateRangeOf`), so
 * a withheld department with the lowest score moves nothing and is named nowhere. Fewer
 * than two visible groups draw no range and print no low/high: a single disclosed group
 * beside the organization's mean is one subtraction away from what the floor hid. When the
 * row's OWN mean is withheld, the end shows the padlock and "Menos de {floor}", the track
 * is dimmed whole and carries no dot — no number, and never a 0. The component never
 * computes a mean from groups.
 *
 * ## Layout
 *
 * A list whose rows share one grid (`grid-cols-subgrid`), so the tracks of every row and
 * the axis under them start and end on the same x even when one row's chip is wider. On
 * a narrow container (`@max-xl`, under 36rem) the track drops to its own line under the
 * name and the value, as the canvas does under 640px.
 */
export interface ClimateRangeComparison {
  /** Already-translated name of what the row is compared with: "Meridiano", "Organización". */
  label: string
  /** Its 1–5 mean as served; `null` draws nothing. */
  mean: number | null
  /** Withheld by the server: nothing of it is drawn. */
  protected?: boolean
}

export interface ClimateRangeRow {
  /** Stable key, used as the React key. */
  key: string
  /** Already-translated dimension name. */
  label: string
  /** The row's own 1–5 mean (organization, team) as served. `null` or `protected` → withheld. */
  mean: number | null
  /** The server withheld the row's own mean. */
  protected?: boolean
  /** The groups the range is drawn over, as served. Absent or fewer than two visible → no range. */
  groups?: readonly ClimateRangeGroup[]
  /** A second mean to tick on the track and name in the caption (the organization on a team view). */
  comparison?: ClimateRangeComparison
  /**
   * The caption under the name, already translated, in place of the one the bar composes
   * (the comparison, else the lowest and highest group). The caller answers for it.
   */
  caption?: string
}

export interface ClimateRangeBarProps {
  rows: readonly ClimateRangeRow[]
  /** The company's result bands — they paint the track and judge the chip. */
  bands: ResultBands
  /** The floor the server applied to this payload, printed on a withheld row ("Menos de 3"). */
  floor: number
  /** Decimals of the 1–5 value (two by default: "3,74"). The chip is judged at the same precision. */
  decimals?: number
  /** The shared 1…5 axis under the rows. On by default. */
  showAxis?: boolean
  className?: string
}

const SEGMENT_FILL: Readonly<Record<ResultBandKey, string>> = {
  critical: 'bg-band-crit-fill',
  opportunity: 'bg-band-opp-fill',
  strength: 'bg-band-str-fill',
}

function disclosed(mean: number | null, withheld: boolean | undefined): mean is number {
  return !withheld && mean !== null && Number.isFinite(mean)
}

export default function ClimateRangeBar({ rows, bands, floor, decimals = 2, showAxis = true, className }: ClimateRangeBarProps) {
  return (
    // `@container` on a wrapper, not on the grid: a container cannot query itself, and the
    // grid's own column template is what changes at the narrow size.
    <div className={cn('@container', className)} data-climate-range="">
      <ul className={cn('m-0 grid list-none gap-x-4 p-0', CLIMATE_RANGE_COLUMNS)}>
        {rows.map((row) => (
          <RangeRow key={row.key} row={row} bands={bands} floor={floor} decimals={decimals} />
        ))}
        {showAxis && (
          <li aria-hidden="true" className="col-span-full mb-0 grid grid-cols-subgrid pt-1.5">
            <ClimateScaleAxis scale={bands.scale} className="col-start-2 @max-xl:col-span-full @max-xl:col-start-1" />
          </li>
        )}
      </ul>
    </div>
  )
}

function RangeRow({ row, bands, floor, decimals }: { row: ClimateRangeRow; bands: ResultBands; floor: number; decimals: number }) {
  const { t, locale } = useTranslation()
  const value = (mean: number) => scoreText(mean, bands.scale, locale, decimals)

  const meanShown = disclosed(row.mean, row.protected)
  const mean = meanShown ? row.mean : null
  // No range over a withheld row: its groups are smaller than it is.
  const range = mean !== null ? climateRangeOf(row.groups ?? []) : null
  const comparison = row.comparison && disclosed(row.comparison.mean, row.comparison.protected) ? { label: row.comparison.label, mean: row.comparison.mean } : null

  const reading =
    mean === null
      ? t('charts.range.ariaProtected', { floor })
      : range
        ? t('charts.range.aria', { low: value(range.low.mean), high: value(range.high.mean), mean: value(mean) })
        : t('charts.range.ariaMean', { mean: value(mean) })
  const label = comparison ? t('charts.range.ariaComparison', { reading, label: comparison.label, value: value(comparison.mean) }) : reading

  const caption =
    row.caption ??
    (comparison
      ? t('charts.range.comparison', { label: comparison.label, value: value(comparison.mean) })
      : range
        ? t('charts.range.groups', {
            low: t('charts.range.group', { name: range.low.name, value: value(range.low.mean) }),
            high: t('charts.range.group', { name: range.high.name, value: value(range.high.mean) }),
          })
        : null)

  const band = mean !== null ? bandOf(mean, bands, decimals) : null
  // A withheld row paints no area at all: a grey track, no dot.
  const segments = mean === null ? [] : paintedSegments(bands, range)

  return (
    <li
      data-dimension={row.key}
      data-range={mean === null ? 'withheld' : range ? 'range' : 'mean'}
      className="col-span-full mb-0 grid grid-cols-subgrid items-center gap-y-2 border-t border-line-default py-2.75 first:border-t-0"
    >
      <div className="min-w-0">
        <span className="block text-base font-medium text-fg-primary">{row.label}</span>
        {caption && <span className="block text-sm text-fg-tertiary">{caption}</span>}
      </div>

      <div role="img" aria-label={label} data-track="" className="relative h-4 @max-xl:order-3 @max-xl:col-span-full">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-band-track">
          {segments.map((segment) => (
            <span
              key={segment.key}
              data-segment={segment.key}
              className={cn(
                'absolute inset-y-0',
                SEGMENT_FILL[segment.key],
                segment.seam && 'border-l-2 border-surface-card',
                // No range: the areas are the scale's context, not data, so they are muted —
                // painted whole at full strength they read as a range from 1 to 5.
                !range && 'opacity-40',
              )}
              style={{ left: `${segment.from}%`, width: `${segment.width}%` }}
            />
          ))}
        </div>
        {comparison && (
          <span
            data-comparison=""
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-primary ring-2 ring-surface-card"
            style={{ left: `${scalePercent(comparison.mean)}%` }}
          />
        )}
        {mean !== null && (
          <span
            data-mean=""
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-3 border-fg-primary bg-surface-card shadow-sm ring-2 ring-surface-card"
            style={{ left: `${scalePercent(mean)}%` }}
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        {mean === null || band === null ? (
          <ProtectedMark floor={floor} />
        ) : (
          <>
            <BandChip band={band} bands={bands} />
            <span className="text-lg font-semibold text-fg-primary tabular-nums">{value(mean)}</span>
          </>
        )}
      </div>
    </li>
  )
}
