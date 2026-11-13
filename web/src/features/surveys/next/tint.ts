import { shownDelta, type ResultScale } from '../../../components/charts'


/**
 * The ink of a signed change, judged at the precision it is printed at: the secondary ink
 * for a rise or a fall — the sign carries the direction, because green and red belong to the
 * three result areas only (Apple design ruling, 11 Nov; HIG `color.md`: "avoid using the same
 * color to mean different things") — and the quieter label ink for a change that prints as zero.
 */
export function deltaInkOf(value: number, decimals: number, scale: ResultScale = 'mean'): string {
  // Judged on the figure as printed on the company's scale (`shownDelta`), so ink and sign agree.
  const shown = shownDelta(value, scale, decimals)
  if (shown !== 0) return 'text-fg-secondary'
  return 'text-fg-label'
}
