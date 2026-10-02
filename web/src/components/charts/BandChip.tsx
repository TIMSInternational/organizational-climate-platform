import { Chip } from '../ui'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import BandGlyph from './BandGlyph'
import { BAND_TONE, bandName, bandShortName, type ResultBandKey, type ResultBands } from './resultBands'

/**
 * A band named in a chip: the tone's fill and ink, the band's glyph, and its name —
 * the company's own when it chose one. `short` prints the one-word form ("Crítica") where
 * the full name ("Área crítica") does not fit; the full name stays in the title.
 */
export default function BandChip({
  band,
  bands,
  short = false,
  className,
}: {
  band: ResultBandKey
  bands: ResultBands
  short?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const full = bandName(band, bands, t)
  return (
    <Chip
      tone={BAND_TONE[band]}
      icon={<BandGlyph band={band} />}
      label={short ? bandShortName(band, bands, t) : full}
      title={full}
      data-band={band}
      className={cn('max-w-full', className)}
    />
  )
}
