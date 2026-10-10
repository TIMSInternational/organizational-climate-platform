import { useTranslation } from '../../i18n'
import BandGlyph from './BandGlyph'
import {
  BAND_PAINT,
  SCALE_MAX,
  SCALE_MIN,
  bandName,
  boundaryText,
  segmentsOf,
  type BandScaleSegment,
  type ResultBandKey,
  type ResultBands,
} from './resultBands'

/**
 * The 1–5 scale drawn as the company's areas, each a segment as wide as the stretch of
 * the scale it covers, named inside and ticked at its edges. A `gap` segment is drawn as a
 * dashed red outline with nothing in it — the settings card's picture of a scale that
 * leaves a mean in no area. `role="img"` with the whole scale in its label: the segments'
 * words are the same sentence a screen reader hears once.
 */
export default function BandScaleBar({
  bands,
  segments,
  ticks,
  badTicks = [],
}: {
  bands: ResultBands
  /** Defaults to the valid scale of `bands`. */
  segments?: readonly BandScaleSegment[]
  /** The values ticked under the bar; defaults to every segment edge. */
  ticks?: readonly number[]
  /** Ticks printed in the critical ink — the two edges of a gap. */
  badTicks?: readonly number[]
}) {
  const { t, locale } = useTranslation()
  const drawn = segments ?? segmentsOf(bands)
  const marks = ticks ?? [...new Set(drawn.flatMap((segment) => [segment.from, segment.to]))]
  const at = (value: number) => ((value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
  // Two edges a hundredth or two apart (the two sides of a gap) would print over each
  // other: the second of a close pair drops to a second line.
  const sorted = [...marks].sort((a, b) => a - b)
  const rows: number[] = []
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1]
    rows.push(previous !== undefined && rows[index - 1] === 0 && at(value) - at(previous) < 8 ? 1 : 0)
  })
  const placed = sorted.map((value, index) => ({ value, row: rows[index] ?? 0 }))
  const label = drawn
    .filter((segment): segment is BandScaleSegment & { key: ResultBandKey } => segment.key !== 'gap')
    .map((segment) => `${bandName(segment.key, bands, t)} ${boundaryText(segment.from, locale)}–${boundaryText(segment.to, locale)}`)
    .join(' · ')

  return (
    // `@container`, not a viewport breakpoint: this bar is drawn in a report card, in a
    // settings card and anywhere else a caller puts it, so how much room a segment has
    // depends on its column and not on the window. A `md:` rule here would be a guess
    // about the page rather than a fact about the bar.
    <div className="@container flex flex-col gap-1" data-testid="band-scale">
      <div role="img" aria-label={label} className="flex h-7.5 gap-0.5">
        {drawn.map((segment) =>
          segment.key === 'gap' ? (
            <span
              key={`gap-${segment.from}`}
              data-segment="gap"
              className="rounded-sm border-2 border-dashed border-accent-red"
              style={{ width: `${at(segment.to) - at(segment.from)}%` }}
            />
          ) : (
            <span
              key={segment.key}
              data-segment={segment.key}
              className="flex min-w-0 items-center justify-center gap-1.25 overflow-hidden rounded-sm border border-t-3 px-1 text-xs font-semibold whitespace-nowrap"
              style={{
                width: `${at(segment.to) - at(segment.from)}%`,
                backgroundColor: BAND_PAINT[segment.key].fill,
                color: BAND_PAINT[segment.key].ink,
                borderColor: BAND_PAINT[segment.key].ring,
                borderTopColor: BAND_PAINT[segment.key].line,
              }}
            >
              <BandGlyph band={segment.key} />
              {/* Hidden rather than truncated once the narrowest segment cannot hold a
                  name. The opportunity and strength bands are a quarter of the scale
                  each, so on a phone they had room for about half a word: measured on
                  the shared report at 390px, "Área de oportunidad" and "Área de
                  fortaleza" both cut off — on the one surface that leaves the company.
                  Nothing is lost by dropping them. The glyph and the colour still tell
                  the bands apart, the `aria-label` above carries the whole scale in
                  words, and both callers name every band underneath: `BandLegend` in
                  the report, the colour/name/from/to table in settings. A truncated
                  word is worse than no word. */}
              <span className="truncate @max-[38rem]:hidden">{bandName(segment.key, bands, t)}</span>
            </span>
          ),
        )}
      </div>
      <div aria-hidden="true" className={`relative ${rows.some((row) => row === 1) ? 'h-7' : 'h-3.5'}`}>
        {placed.map(({ value, row }) => {
          const left = at(value)
          const shift = left <= 0 ? '0' : left >= 100 ? '-100%' : '-50%'
          return (
            <span
              key={value}
              className={`absolute font-mono text-xs tabular-nums ${badTicks.includes(value) ? 'text-accent-red-ink' : 'text-fg-tertiary'}`}
              style={{ left: `${left}%`, top: row * 14, transform: `translateX(${shift})` }}
            >
              {boundaryText(value, locale)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
