import { divergingPair } from '../../../components/charts'

/**
 * A score's standing against a stated baseline: a diverging swatch **and the
 * word beside it**, never the colour alone.
 *
 * Extracted from `SurveyResultsPage` when the per-question rows gained the same
 * chip as the dimensions table — one component, so the two surfaces cannot
 * disagree about what "Above" looks like.
 *
 * The fill comes from `divergingPair` on the same -1..1 polarity `ClimateMap`
 * computes, from the same dead band. `divergingStep` calls a value neutral when
 * `-deadBand <= value <= deadBand`, and the word is chosen by the caller with the
 * complementary pair of comparisons on the unscaled score, so the swatch and the
 * word are one decision rather than two that can drift.
 */
export default function StandingChip({
  score,
  target,
  deadBandAt,
  extremeAt,
  label,
}: {
  score: number
  target: number
  deadBandAt: number
  extremeAt: number
  /** Already-translated standing word — Above, Below or Level. */
  label: string
}) {
  const { fill, ink } = divergingPair(
    (score - target) / (2 * extremeAt),
    deadBandAt / (2 * extremeAt),
  )
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: fill, color: ink }}
    >
      {label}
    </span>
  )
}
