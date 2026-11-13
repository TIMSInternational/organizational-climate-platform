import type { ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import BandGlyph from './BandGlyph'
import { RESULT_BAND_ORDER, bandName, bandRangeText, bandShortName, type ResultBandKey, type ResultBands } from './resultBands'

/** The band's ink as a utility, so the glyph wears the same colour as the cells it keys. */
const GLYPH_INK: Readonly<Record<ResultBandKey, string>> = {
  strength: 'text-band-str-ink',
  opportunity: 'text-band-opp-ink',
  critical: 'text-band-crit-ink',
}

/**
 * The key to the three bands, as every banded screen prints it: the band's glyph in its
 * ink, the band's name, and its range from the COMPANY's boundaries ("4,00 a 5,00",
 * `bandRangeText`). The Apple canvas's `.legend`: 12px, the secondary ink, 14px between
 * entries, no swatch box — the glyph in its ink is the same mark the cells and chips carry.
 * `short` uses the one-word names where the legend shares a narrow card. Extra entries (the
 * hatch, the open cell) are the caller's, passed as children so one legend line holds them
 * all.
 */
export default function BandLegend({
  bands,
  short = false,
  className,
  testId = 'band-legend',
  children,
}: {
  bands: ResultBands
  short?: boolean
  className?: string
  testId?: string
  children?: ReactNode
}) {
  const { t, locale } = useTranslation()
  return (
    <div data-testid={testId} className={cn('flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-fg-tertiary', className)}>
      {RESULT_BAND_ORDER.map((band) => (
        <span key={band} data-band={band} className="inline-flex items-center gap-1.25">
          <span aria-hidden="true" className={cn('inline-flex', GLYPH_INK[band])}>
            <BandGlyph band={band} />
          </span>
          <span className="font-medium text-fg-secondary">{short ? bandShortName(band, bands, t) : bandName(band, bands, t)}</span>
          <span>{bandRangeText(band, bands, t, locale)}</span>
        </span>
      ))}
      {children}
    </div>
  )
}
