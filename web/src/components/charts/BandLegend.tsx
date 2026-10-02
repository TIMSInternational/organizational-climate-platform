import type { ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import BandGlyph from './BandGlyph'
import { BAND_PAINT, RESULT_BAND_ORDER, bandName, bandRangeText, bandShortName, type ResultBands } from './resultBands'

/**
 * The key to the three bands, as every banded screen prints it: a swatch in the band's
 * fill carrying its glyph, the band's name, and its range ("4,00 a 5,00"). `short` uses
 * the one-word names where the legend shares a narrow card. Extra entries (the hatch, the
 * open cell) are the caller's, passed as children so one legend line holds them all.
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
    <div data-testid={testId} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-label', className)}>
      {RESULT_BAND_ORDER.map((band) => {
        const paint = BAND_PAINT[band]
        return (
          <span key={band} data-band={band} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-flex size-4 items-center justify-center rounded-xs border"
              style={{ backgroundColor: paint.fill, color: paint.ink, borderColor: paint.ring }}
            >
              <BandGlyph band={band} />
            </span>
            <span className="font-semibold text-fg-primary">{short ? bandShortName(band, bands, t) : bandName(band, bands, t)}</span>
            <span>{bandRangeText(band, bands, t, locale)}</span>
          </span>
        )
      })}
      {children}
    </div>
  )
}
