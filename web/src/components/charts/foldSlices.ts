import { MAX_SERIES } from './palette'

export interface PieSlice {
  /** Stable identity. Colour is assigned from this, not from sorted position. */
  key: string
  /** Already-translated display name. */
  name: string
  value: number
}

/** The synthetic slice the tail folds into. Exported so callers can recognise it. */
export const OTHER_SLICE_KEY = '__other__'

/**
 * Keeps the largest slices and sums the rest into one "Other".
 *
 * Lives in its own module rather than beside `PieChart` because a file that
 * exports both a component and a helper breaks React Fast Refresh — the
 * `only-export-components` lint rule catches it, and it is right to.
 *
 * ## Why fold instead of cycling
 *
 * Legacy `AnimatedPieChart` did `colors[index % colors.length]` over eight
 * hardcoded hexes, so a ninth slice silently reused the first colour and the reader
 * had two identically-coloured wedges with no way to tell them apart. Folding is
 * the honest behaviour: "these are the rest" instead of a lie about identity.
 *
 * The *smallest* slices fold, keeping the largest named, because a reader cares
 * about the big contributors and "Other" is a legitimate answer for the tail.
 */
export function foldExtraSlices(
  data: readonly PieSlice[],
  labelOther: (foldedCount: number) => string,
  max = MAX_SERIES,
): PieSlice[] {
  if (data.length <= max) {
    return [...data]
  }

  // Sorted by value so the fold boundary is "the smallest ones", and so the
  // returned order reads largest-first — a pie with wedges in arbitrary order is
  // harder to compare than one that is ordered.
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const kept = sorted.slice(0, max - 1)
  const folded = sorted.slice(max - 1)

  return [
    ...kept,
    {
      key: OTHER_SLICE_KEY,
      name: labelOther(folded.length),
      value: folded.reduce((sum, slice) => sum + slice.value, 0),
    },
  ]
}
