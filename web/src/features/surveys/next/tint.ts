import type { CSSProperties } from 'react'
import { DIVERGING_COLORS, DIVERGING_INKS } from '../../../components/charts'
import { BAND_STEP, type TargetBand } from './derive'

/**
 * The fill and the ink of a cell in one of the five target bands.
 *
 * One ramp, one meaning per colour: the results grid, the finding chips and the
 * "other groups" cells all paint from `DIVERGING_COLORS`, the tokens the climate map
 * and the distribution strips already read, so red means "under the target" wherever
 * it appears on the page and the tint follows the theme. The fill and its ink are
 * returned together, for the reason `divergingPair` gives — a label painted from a
 * different step than its background is the unreadable cell #208 fixed.
 */
export function tintOf(band: TargetBand): CSSProperties {
  const step = BAND_STEP[band]
  return { backgroundColor: DIVERGING_COLORS[step], color: DIVERGING_INKS[step] }
}

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
