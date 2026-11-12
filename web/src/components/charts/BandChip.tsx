import { Chip } from '../ui'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import BandGlyph from './BandGlyph'
import { BAND_TONE, bandName, bandShortName, type ResultBandKey, type ResultBands } from './resultBands'

/**
 * A band named in a chip: the tone's fill and ink, the band's glyph, and its name —
 * the company's own when it chose one. `short` prints the one-word form ("Crítica") where
 * the full name ("Área crítica") does not fit; the full name stays in the title.
 *
 * Drawn as the Apple canvas's `.chip.s / .o / .c`: a 22px pill with no border, 12px
 * semibold, 5px between the glyph and the word. The fill and ink are the result-area pair
 * (`bg-chip-*-fill` / `text-chip-*-ink`, the same values as `--admin-band-*-bg` / `-ink`),
 * measured by `styles/chipVariantContrast.test.ts`. The glyph sits one span deeper than
 * `Chip` expects so `Chip`'s 13px icon rule does not reach it: the canvas sets the glyph at
 * 10px type, about 9px drawn, and a 13px triangle outweighed the word beside it.
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
      icon={
        <span className="inline-flex">
          <BandGlyph band={band} />
        </span>
      }
      label={short ? bandShortName(band, bands, t) : full}
      title={full}
      data-band={band}
      className={cn('max-w-full gap-1.25 rounded-full border-transparent font-semibold', className)}
    />
  )
}
