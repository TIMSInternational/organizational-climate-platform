/**
 * The OCC brand: the mark on its own, and the mark with the wordmark.
 *
 * ## Where the artwork comes from
 *
 * Traced from the artwork TIMS supplied on 2026-10-05 — a 598×236 JPEG, in which the
 * mark itself is only 119×120px and carries WhatsApp's compression with it. A bigger
 * PNG of that file would only be a bigger picture of the artefacts, so the assets are
 * **vector**: the ink coverage was un-composited from the green channel (ink G≈23,
 * paper G=255), resampled 10×, thresholded at 50% coverage and traced with potrace.
 * The result is resolution-independent and has no JPEG ringing at any size.
 *
 * The three assets live in `public/brand/` rather than inline here, because the two
 * lockups are 35KB and 59KB of path data. As static files they are fetched once and
 * cached; inlined they would be in the bundle of every screen that draws a header.
 *
 * ## One colour, no `tone`
 *
 * `ClimateMark` needed a light ramp and a dark one, because its two deepest cells
 * measured 1.13:1 on the navy rail and simply vanished. This mark is a single ink,
 * the brand's own `#FB1724`, and it was measured against every surface it lands on
 * before that was relied upon: **3.70:1 on the light paper, 4.00:1 on a card, 4.68:1
 * on the navy shell, 4.43:1 on the dark page.** It reads on all four, so there is no
 * tone to choose and no way to choose it wrongly.
 *
 * The colour lives inside the SVG files, not in a class here — `tokenDiscipline`
 * sweeps this directory for hex and is right to, and a brand ink is not a theme token
 * anyway: it must not move when the reader switches to dark.
 *
 * ## The size floor, measured
 *
 * Six figures turning in a ring is a lot of detail for a small square. Rendered and
 * read at 16/24/32/48/64: **16px is an unreadable blob, 24px is muddy, 32px resolves,
 * 48px is clean.** That is the artwork's nature and not the trace's — no tracing of
 * six figures survives a 16px box. So nothing here draws the mark below 32px except
 * the favicon, which has no choice; at that size it reads as a red ring, which is
 * still the brand's silhouette.
 *
 * It is the same finding that sent the previous mark the other way: `ClimateMark`'s
 * own note records that its geometry was redrawn by hand "so the shape is crisp at
 * 16px, which a trace of the original was not".
 */

/** How wide the mark+wordmark is for a given height: the asset's own 4.185:1. */
export const OCC_LOGO_RATIO = 4984 / 1191

export interface OccMarkProps {
  /** Rendered size in px. Below 32 the figures stop resolving — see the note above. */
  size: number
  className?: string
}

/**
 * The mark alone, for a slot too narrow for the wordmark.
 *
 * `alt=""` and `aria-hidden`: every place this is drawn, the product is already named
 * beside it or by the landmark's own label, and a second announcement of "OCC" is
 * noise rather than help.
 */
export function OccMark({ size, className }: OccMarkProps) {
  return (
    <img
      data-slot="occ-mark"
      src="/brand/occ-mark.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  )
}

export interface OccLogoProps {
  /** Rendered height in px; the width follows from the artwork's ratio. */
  height: number
  className?: string
}

/**
 * The mark with the OCC wordmark, as one piece of artwork.
 *
 * One image rather than a mark beside styled text: the wordmark's letterforms are the
 * client's, and re-setting them in whichever geometric sans looks closest would be a
 * different logo that merely resembles theirs. It also keeps the mark's size tied to
 * the lockup's height, so the figures cannot quietly fall under the 32px floor.
 *
 * This one carries the accessible name, because it IS the product's name on the page.
 */
export function OccLogo({ height, className }: OccLogoProps) {
  const width = Math.round(height * OCC_LOGO_RATIO)
  return (
    <img
      data-slot="occ-logo"
      src="/brand/occ-logo.svg"
      alt="OCC"
      width={width}
      height={height}
      className={className}
      style={{ height, width, flexShrink: 0 }}
    />
  )
}
