import { shownDelta, type ResultScale } from '../../../components/charts'


/**
 * The ink of a signed change, judged at the precision it is printed at: green up, red
 * down, and the label ink for a change that prints as zero — a green "0,0" would claim
 * a rise the reader cannot see in the figure.
 */
export function deltaInkOf(value: number, decimals: number, scale: ResultScale = 'mean'): string {
  // Judged on the figure as printed on the company's scale (`shownDelta`), so ink and sign agree.
  const shown = shownDelta(value, scale, decimals)
  if (shown > 0) return 'text-accent-green-ink'
  if (shown < 0) return 'text-accent-red-ink'
  return 'text-fg-label'
}
