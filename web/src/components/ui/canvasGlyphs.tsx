import type { SVGProps } from 'react'

/**
 * The canvas's own button and chip glyphs, drawn from the artboards rather than from lucide
 * — the same call `navigation/railIcons.tsx` makes for the rail.
 *
 * The artboards of 10 Sep draw every button glyph in a 16-unit box stroked 2 wide with
 * round caps and joins, never filled (`MicroclimatesList.dc.html`,
 * `MicroclimateLive.dc.html`: `<svg style="width: 16px; height: 16px; stroke: …;
 * fill: none; stroke-width: 2; …" viewBox="0 0 16 16">`). Lucide draws in a 24-unit box
 * stroked 2, so at 16px its line is 1.33px against the canvas's 2px, and its nearest link
 * is a different picture: a two-loop chain where the canvas has one diagonal link. The
 * paths are copied verbatim from the artboards' sources.
 *
 * Outlined, measured: at the render's 1x a 2px stroke round a 4px interior looks solid
 * when zoomed without smoothing, but the page glyph of MicroclimateLive.png reads ink,
 * six pixels of paper, ink on each of its rows 121-127 — an outline, as the source says.
 *
 * Glyphs the canvas never drew (the copied tick) stay lucide, as the rail's do.
 */
function CanvasGlyph({ children, strokeWidth = 2, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

/** "Lanzar un microclima": a plus. */
export function CanvasPlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <path d="M8 3v10M3 8h10" />
    </CanvasGlyph>
  )
}

/** "Compartir": one diagonal link, its two ends open. */
export function CanvasLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <path d="M6.5 9.5l3-3M7 11l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5L3.5 7.5M9 5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L12.5 8.5" />
    </CanvasGlyph>
  )
}

/** "Ver en vivo": an arrow to the right. */
export function CanvasArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </CanvasGlyph>
  )
}

/** "Cerrar la sesión", and the empty past note: a clock face at a quarter past. */
export function CanvasClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </CanvasGlyph>
  )
}

/** "Resultados": a page with its corner folded. */
export function CanvasFileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </CanvasGlyph>
  )
}

/** "Copiar": the front sheet, and the open corner of the one behind it. */
export function CanvasCopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V3h8" />
    </CanvasGlyph>
  )
}

/** "Protegido hasta 5 respuestas", and the hatch's padlock. */
export function CanvasLockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CanvasGlyph {...props}>
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </CanvasGlyph>
  )
}
