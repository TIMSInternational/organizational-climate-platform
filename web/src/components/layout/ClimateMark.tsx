import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'

/**
 * The product mark: a 3×3 heat grid with one alert cell.
 *
 * It is the Panel de Control's own "Por grupo" matrix reduced to a logo — a pale-to-deep
 * ramp over nine cells, with the worst one in alert red. Chosen by Federico on 2026-09-23
 * from five directions, and it is the first logo asset this product has ever had:
 * `SidebarBrand` and `BrandLockup` both drew the lucide `Waves` glyph as a stand-in, and
 * `public/favicon.svg` was still the stock Vite lightning bolt.
 *
 * ## Why the cells name no colour
 *
 * `tokenDiscipline.test.ts` sweeps `components/layout/` for hex, `rgb()`, stock-palette
 * classes and arbitrary values, and it is right to: a hardcoded colour here would look
 * correct in light and wrong in dark, on every screen at once. The ramp is therefore six
 * custom properties set by `.climate-mark` in `index.css`, which is also where the
 * measurement that produced the second ramp is written down.
 *
 * ## `tone`
 *
 * - `auto` — follows the reader's theme. For anything on the page surface: the respond
 *   header, the shared-report header.
 * - `shell` — the dark ramp whatever the theme, for the navy surfaces that do not follow
 *   it: the rail (`--admin-bg-shell` is navy in light mode too) and the auth stage, which
 *   sits on a navy-washed photograph.
 *
 * Getting this wrong is not subtle. The light ramp's two darkest cells measure 1.13:1 and
 * 1.25:1 on the rail — they do not dim, they disappear, and the mark loses a third of
 * itself while every test stays green.
 *
 * ## Geometry
 *
 * A 100×100 box: cells 29.2 on a 6.2 gutter, corner radius 7.2. Those are not invented —
 * they are the proportions of the chosen artwork, measured off it (gap/cell 0.212, radius
 * 0.247 of the cell) and redrawn exactly so the shape is crisp at 16px, which a trace of
 * the original was not.
 */
export interface ClimateMarkProps {
  /** Which ramp to paint. See the note above; `shell` is for navy grounds. */
  tone?: 'auto' | 'shell'
  /** Sized by the caller — the svg has no intrinsic size of its own. */
  className?: string
  /** For the rail, which expresses its density as inline styles rather than classes. */
  style?: CSSProperties
}

/** Column and row origins: 0, 29.2 + 6.2, and twice that. */
const POS = [0, 35.4, 70.8] as const

/** Which ramp step each cell takes, reading left to right, top to bottom. */
const CELLS = [1, 1, 2, 3, 3, 4, 5, 5, 0] as const

export function ClimateMark({ tone = 'auto', className, style }: ClimateMarkProps = {}) {
  return (
    <svg
      data-slot="climate-mark"
      data-tone={tone}
      className={cn('climate-mark', className)}
      style={style}
      viewBox="0 0 100 100"
      // Decorative in every caller: the wordmark beside it names the product, and where
      // there is no wordmark the surrounding landmark is labelled. An announced "Climate"
      // here would be the product's name said twice.
      aria-hidden="true"
      focusable="false"
    >
      {CELLS.map((step, index) => (
        <rect
          key={index}
          x={POS[index % 3]}
          y={POS[Math.floor(index / 3)]}
          width={29.2}
          height={29.2}
          rx={7.2}
          fill={step === 0 ? 'var(--climate-mark-alert)' : `var(--climate-mark-${step})`}
        />
      ))}
    </svg>
  )
}
