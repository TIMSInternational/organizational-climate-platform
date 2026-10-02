import type { ResultBandKey } from './resultBands'

/**
 * The shape of a band, so the band is never told by colour alone (WCAG 1.4.1): a triangle
 * pointing up for strength, a circle for opportunity, a triangle pointing down for
 * critical. Drawn in `currentColor`, so it takes the ink of whatever holds it, and always
 * `aria-hidden` — the band's name travels beside it as text or in the accessible label.
 */
export default function BandGlyph({ band, className }: { band: ResultBandKey; className?: string }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false" data-band-glyph={band} className={className ?? 'size-2.25 shrink-0'} fill="currentColor">
      {band === 'strength' && <path d="M5 1 9.5 9h-9z" />}
      {band === 'opportunity' && <circle cx="5" cy="5" r="4" />}
      {band === 'critical' && <path d="M.5 1h9L5 9z" />}
    </svg>
  )
}
