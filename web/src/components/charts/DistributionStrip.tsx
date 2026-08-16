import { cn } from '../../lib/cn'
import { formatMetric } from './formatMetric'
import { divergingPair } from './palette'

/**
 * One question's answer distribution as a single stacked strip — the compact form
 * the survey-results redesign draws instead of a full `BarChart` per question.
 *
 * ## Why this is DIVERGING, and on the climate map's own ramp
 *
 * A Likert answer is not a magnitude, it is a **polarity**: disagree, neutral,
 * agree. The shipped page painted every distribution in the series teal, whose
 * colour said nothing, on the same screen as a climate map where red already
 * meant "below" and blue "above". One page, one meaning per colour: the strip
 * reads its fills from `divergingPair`, the exact function the map's cells use,
 * so red here is the red the reader has already learned. This is the third
 * diverging case beside `ClimateMap` and the standing chips, not a new encoding.
 *
 * ## How a scale point becomes a colour
 *
 * `(position - midpoint) / (max - min)`, with the midpoint halfway between the
 * scale's configured ends. On a 1-5 scale that lands the five points exactly on
 * the five ramp steps — 1 on saturated red, 3 on the neutral gray, 5 on
 * saturated blue — which is the drawn design. The position comes from the
 * segment, **never from its render index**: a scale point nobody chose produces
 * no segment, and colouring by index would then paint "neutral" in disagree's
 * red. Written as one division, like the map, so the fill and its ink cannot
 * come from different steps.
 *
 * ## Counts live inside the segments
 *
 * The reading is printed on the mark it measures, in the ink `divergingPair`
 * pairs with that fill — the same #208 rule the map follows. A segment too thin
 * to hold its number keeps its tooltip and its accessible label, so the count is
 * reachable, just not painted where it cannot fit.
 *
 * ## This component never translates
 *
 * Same contract as `KpiTile`: every string arrives already translated —
 * per-segment labels, and the two scale-end captions printed under the strip.
 * The captions are the author's own anchor words ("Strongly disagree"), which
 * are content rather than copy, and the catalogue must not be asked to invent
 * them.
 */
export interface DistributionStripSegment {
  /** Stable option value — the React key. */
  key: string
  /**
   * Where this answer sits on the question's scale. Decides the colour; see the
   * component note on why the render index must not.
   */
  position: number
  count: number
  /**
   * Already-translated accessible name and tooltip for the segment, e.g.
   * "Agree (4): 91 of 210". This is the only surface that names a thin segment.
   */
  label: string
}

export interface DistributionStripProps {
  /** In the question's own option order — never sorted by count here. */
  segments: readonly DistributionStripSegment[]
  /** The scale's configured ends. `max` must exceed `min`. */
  min: number
  max: number
  /**
   * Already-translated captions for the two ends, printed under the strip —
   * e.g. "1 · Strongly disagree". The caller owns the composition because the
   * anchor words are survey content, not catalogue copy.
   */
  minEnd: string
  maxEnd: string
  /** BCP-47 locale for the counts printed inside the segments. */
  locale?: string
  className?: string
}

/**
 * A segment narrower than this share of the strip does not print its count.
 *
 * At the 0.07 threshold a labelled segment is at least ~80px in a 1200px strip —
 * room for a two-digit figure at `text-2xs`. The number is a share rather than
 * an absolute count so the rule holds whether 24 people answered or 2,400.
 */
const LABEL_MIN_SHARE = 0.07

export default function DistributionStrip({
  segments,
  min,
  max,
  minEnd,
  maxEnd,
  locale,
  className,
}: DistributionStripProps) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  // A scale with no width, or a strip with no answers, has no honest rendering:
  // every polarity would be 0/0 or the whole strip one segment of nothing. The
  // caller decides what stands in for the question — same contract as
  // `buildClimateMap` returning null.
  if (total === 0 || !(max > min)) return null

  const midpoint = (min + max) / 2

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md">
        {segments.map((segment) => {
          if (segment.count === 0) return null
          const { fill, ink } = divergingPair((segment.position - midpoint) / (max - min))
          const share = segment.count / total
          return (
            <span
              key={segment.key}
              role="img"
              aria-label={segment.label}
              title={segment.label}
              // `flexGrow` carries the distribution; the 3px floor keeps a lone
              // dissenting answer visible rather than rounding it to nothing. It
              // rides in `style` beside the other per-segment values because the
              // charts/ token discipline forbids arbitrary Tailwind values — and
              // rightly: this is a visibility floor, not a design token.
              style={{ flexGrow: segment.count, minWidth: 3, backgroundColor: fill, color: ink }}
              className="flex items-center justify-center overflow-hidden font-mono text-2xs font-semibold tabular-nums"
            >
              {share >= LABEL_MIN_SHARE && formatMetric(segment.count, { kind: 'number' }, locale)}
            </span>
          )
        })}
      </div>
      {/* The axis in words. Both ends always render — an unlabelled axis is the
          defect the walk measured (bare 1-5 with no words anywhere). */}
      <div className="flex justify-between gap-2 text-xs text-fg-secondary">
        <span>{minEnd}</span>
        <span>{maxEnd}</span>
      </div>
    </div>
  )
}
