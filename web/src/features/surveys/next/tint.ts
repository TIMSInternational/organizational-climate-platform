/**
 * The ink of a signed change, judged at the precision it is printed at: green up, red
 * down, and the label ink for a change that prints as zero — a green "0,0" would claim
 * a rise the reader cannot see in the figure.
 */
export function deltaInkOf(value: number, decimals: number): string {
  const scale = 10 ** decimals
  const shown = Math.round(value * scale) / scale
  if (shown > 0) return 'text-accent-green-ink'
  if (shown < 0) return 'text-accent-red-ink'
  return 'text-fg-label'
}
