import { SCALE_MAX, SCALE_MIN, segmentsOf, type ResultBandKey, type ResultBands } from './resultBands'

/**
 * The arithmetic behind `ClimateRangeBar`, on its own so the component file exports
 * components and nothing else (`react(only-export-components)`; the lint budget is a hard
 * ceiling shared by every lane).
 *
 * ## What may enter a range
 *
 * Only what the server disclosed. A group arrives exactly as served —
 * `{ name, mean, protected }` — and it takes part in the low/high reading only when it is
 * NOT protected AND carries a finite mean. A protected group is dropped before anything
 * is compared, so it cannot move the range, cannot be named in a caption and cannot reach
 * an accessible label, whatever number the payload happened to carry beside the flag.
 * A `null` mean is "nobody in this group answered this dimension", which is not a 0 and
 * not a reading, so it is dropped the same way.
 *
 * Nothing here ever computes a mean. The row's own mean (the organization's, the team's)
 * is the server's figure; averaging the visible groups would be an aggregate over rows the
 * server partly withheld — a number nobody published, and by subtraction a way back to the
 * withheld group.
 */

/** A group as the API serves it: a department, a team, a demographic value. */
export interface ClimateRangeGroup {
  /** Already-translated name. */
  name: string
  /** The group's 1–5 mean for this dimension; `null` when the server sent none. */
  mean: number | null
  /** The server withheld this group (under the floor). Its name and mean are never shown. */
  protected: boolean
}

/** One end of the range: a disclosed group and its mean. */
export interface ClimateRangeEnd {
  name: string
  mean: number
}

export interface ClimateRange {
  low: ClimateRangeEnd
  high: ClimateRangeEnd
}

/** The groups that may be drawn: disclosed, with a finite mean. Order kept. */
export function visibleGroups(groups: readonly ClimateRangeGroup[]): ClimateRangeEnd[] {
  return groups.flatMap((group) =>
    !group.protected && group.mean !== null && Number.isFinite(group.mean) ? [{ name: group.name, mean: group.mean }] : [],
  )
}

/**
 * The lowest and highest disclosed group, or `null` when fewer than two groups are
 * visible. One group is not a range: drawing it as one would print a "from X to X" that
 * says nothing, and its single name beside the row's own mean would let a reader take the
 * difference to whatever the floor hid. On a tie the first in the caller's order wins, so
 * the caption is stable across renders.
 */
export function climateRangeOf(groups: readonly ClimateRangeGroup[]): ClimateRange | null {
  const visible = visibleGroups(groups)
  if (visible.length < 2) return null
  let low = visible[0]
  let high = visible[0]
  for (const group of visible) {
    if (group.mean < low.mean) low = group
    if (group.mean > high.mean) high = group
  }
  return { low, high }
}

/**
 * Where a 1–5 value sits on the track, in percent of its width: `(v − 1) / 4`, clamped to
 * the scale and rounded to a thousandth so a style string never carries float noise
 * (2,42 / 4 is 60.49999… in binary).
 */
export function scalePercent(value: number): number {
  const fraction = (value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)
  const clamped = Math.min(1, Math.max(0, fraction))
  return Math.round(clamped * 100_000) / 1000
}

/** Percent arithmetic, rounded to a thousandth like `scalePercent`. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * The stretch of the track a range lights, in percent: from the lowest group to the
 * highest. Everything outside it stays the track grey — "dimmed".
 */
export function rangeWindow(range: ClimateRange): { from: number; to: number } {
  return { from: scalePercent(range.low.mean), to: scalePercent(range.high.mean) }
}

/** A stretch of one result area as the track paints it, in percent of the track. */
export interface PaintedSegment {
  key: ResultBandKey
  /** Left edge, percent. */
  from: number
  /** Width, percent. */
  width: number
  /** Starts on a boundary between two areas, so it carries the 2px seam. */
  seam: boolean
}

/**
 * The company's areas as the track paints them. With a range, each area is CUT to the
 * range's window rather than painted whole and covered by a grey mask: two shapes
 * antialiased over each other at the rounded ends left a pink fringe at the start of every
 * track (measured on the gallery shot), and a cut paints nothing that is not shown. Without
 * a range (one visible group, or none) the whole scale is painted and the caller mutes it.
 * A seam marks an area that begins on a boundary inside what is painted — never the cut
 * edge of the window.
 */
export function paintedSegments(bands: ResultBands, range: ClimateRange | null): PaintedSegment[] {
  const window = range ? rangeWindow(range) : { from: 0, to: 100 }
  return segmentsOf(bands).flatMap((segment) => {
    const start = scalePercent(segment.from)
    const end = scalePercent(segment.to)
    const from = Math.max(start, window.from)
    const to = Math.min(end, window.to)
    if (to <= from) return []
    return [{ key: segment.key as ResultBandKey, from, width: round(to - from), seam: start > 0 && start >= window.from }]
  })
}

/**
 * The columns every row of the bar and its axis share: the dimension's name, the track,
 * and the band chip with the value. In 4px steps of the spacing token (150px, 180px and
 * 128px at minimum, the canvas's `.cb`); on a narrow container the track drops to a line
 * of its own under the other two (`ClimateRangeBar`). One string, so a row and the axis
 * under it cannot disagree about where the track starts.
 */
export const CLIMATE_RANGE_COLUMNS =
  'grid-cols-[minmax(--spacing(37.5),1.2fr)_minmax(--spacing(45),2.2fr)_minmax(--spacing(32),auto)] @max-xl:grid-cols-[minmax(0,1fr)_auto]'
