import { Chip } from '../../../components/ui'

/**
 * A score's standing against a stated baseline: the word — Above, Level, Below — on the gray
 * status chip.
 *
 * It used to wear a diverging swatch (light blue, gray, solid red), which made it a second
 * verdict language beside the three result areas: a 3,3 read as red "Below" here and as amber
 * "● Oportunidad" in the climate map beside it. One colour, one meaning (the user's ruling of
 * 11 Nov): green, amber and red belong to Fortaleza, Oportunidad and Crítica only, so the
 * standing is told by its word alone. The band of a value is `charts/BandChip`'s job.
 *
 * The props are unchanged so no caller moves; `score`, `target`, `deadBandAt` and `extremeAt`
 * stay in the signature because the caller still chooses the word from them.
 */
export default function StandingChip({
  label,
}: {
  score: number
  target: number
  deadBandAt: number
  extremeAt: number
  /** Already-translated standing word — Above, Below or Level. */
  label: string
}) {
  return <Chip tone="neutral" label={label} data-slot="standing-chip" />
}
