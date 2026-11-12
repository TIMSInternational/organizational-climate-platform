import { cn } from '../../lib/cn'
import { formatMetric } from './formatMetric'
import { neutralPair } from './palette'

/**
 * One question's answer distribution as a single stacked strip — the compact form
 * the survey-results redesign draws instead of a full `BarChart` per question.
 *
 * ## Why the ramp is NEUTRAL
 *
 * A Likert answer is ordered — disagree, neutral, agree — so the strip needs a ramp a reader
 * can follow from one end to the other. It painted the climate map's diverging ramp until
 * 12 Nov, red through grey to blue, and the review measured what that cost: red is the
 * Crítica area and blue is the action, the selection and the live state, so a share of
 * answers borrowed two meanings it does not have. The fills now come from `neutralPair`, a
 * grey ramp light→dark, and the end captions under the strip name which end is which.
 *
 * ## How a scale point becomes a colour
 *
 * `(position - min) / (max - min)`: on a 1-5 scale the five points land exactly on the five
 * grey steps, 1 on the lightest and 5 on the darkest. The position comes from the
 * segment, **never from its render index**: a scale point nobody chose produces
 * no segment, and colouring by index would then shift every answer after it onto the next
 * step. Written as one division so the fill and its ink cannot come from different steps.
 *
 * ## Counts live inside the segments
 *
 * The reading is printed on the mark it measures, in the ink `neutralPair`
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
   *
   * Both optional, together: the SurveyResults artboard stacks two strips of the
   * same question (the group's, the company's) over ONE shared axis, so a caller
   * drawing that pair leaves both off and prints the axis once itself. One end
   * without the other is the unlabelled-axis defect this row exists to prevent,
   * so the pair is all-or-nothing.
   */
  minEnd?: string
  maxEnd?: string
  /**
   * What the number inside a segment is: its `count` (default), or its share of
   * the strip as a whole percent — the SurveyResults drill-in reads "20 · 40 ·
   * 25 · 10 · 5", which is the form a reader compares two strips in.
   */
  labels?: 'count' | 'share'
  /**
   * `compact` is the artboard's 18px strip with no gaps between segments and a
   * 3px radius — the drill-in's form, where the strip sits under a heading and
   * the reading. `default` keeps the 24px strip the question list draws.
   */
  size?: 'default' | 'compact'
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
  labels = 'count',
  size = 'default',
  locale,
  className,
}: DistributionStripProps) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  // A scale with no width, or a strip with no answers, has no honest rendering:
  // every polarity would be 0/0 or the whole strip one segment of nothing. The
  // caller decides what stands in for the question — same contract as
  // `buildClimateMap` returning null.
  if (total === 0 || !(max > min)) return null

  const compact = size === 'compact'

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        className={cn(
          'flex w-full overflow-hidden',
          compact ? 'h-4.5 rounded-sm' : 'h-6 gap-0.5 rounded-md',
        )}
      >
        {segments.map((segment) => {
          if (segment.count === 0) return null
          const { fill, ink } = neutralPair((segment.position - min) / (max - min))
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
              className={cn(
                'flex items-center justify-center overflow-hidden text-2xs tabular-nums',
                !compact && 'font-semibold',
              )}
            >
              {share >= LABEL_MIN_SHARE &&
                (labels === 'share'
                  ? formatMetric(Math.round(share * 100), { kind: 'number' }, locale)
                  : formatMetric(segment.count, { kind: 'number' }, locale))}
            </span>
          )
        })}
      </div>
      {/* The axis in words. Both ends render whenever the caller gave them — an
          unlabelled axis is the defect the walk measured (bare 1-5 with no words
          anywhere); a caller stacking two strips over one axis prints it once. */}
      {minEnd !== undefined && maxEnd !== undefined && (
        <div className="flex justify-between gap-2 text-xs text-fg-secondary">
          <span>{minEnd}</span>
          <span>{maxEnd}</span>
        </div>
      )}
    </div>
  )
}
