import { QUALITY_SCORE_FORMAT } from '../benchmarkReadings'
import { useTranslation } from '../../../i18n'
import { formatMetric } from '../../../components/charts'

/** Stands in for a score nobody has computed. Punctuation, so it needs no locale. */
const EM_DASH = '—'

export interface QualityScoreReadingProps {
  /** `null` when the quality rule has never run on the benchmark — see `BenchmarkListItem`. */
  value: number | null
}

/**
 * A benchmark's quality score, wherever one is printed.
 *
 * The one place "no score" and "a score of 0" are told apart on screen. `qualityScore` is
 * `null` until an administrator validates the benchmark; the rule scores a benchmark that
 * measures nothing at exactly 0, so 0 is a verdict and renders as `0,00` like any other
 * number. The list used to hand the API's old default straight to `formatMetric` and
 * printed "0,00" under every reference nobody had validated yet — a failing grade on a row
 * whose own panel said "not assessed yet".
 *
 * A dash for the eye and a sentence for the ear. `formatMetric` already answers a
 * non-finite value with the same dash, but silently, and an unlabelled dash in a column of
 * readings is read out as nothing at all. The visible glyph is `aria-hidden` and the
 * `sr-only` text beside it is what a screen reader gets, in the reader's language.
 * `KpiTile` renders its dash bare because the tile's own label sits beside it; here the
 * dash is a cell on its own.
 *
 * A fragment rather than a wrapper, so the reading takes the mono/tabular typography of
 * the cell or `<dd>` it sits in instead of carrying its own.
 */
export default function QualityScoreReading({ value }: QualityScoreReadingProps) {
  const { t, locale } = useTranslation()

  if (value === null) {
    return (
      <>
        <span aria-hidden="true">{EM_DASH}</span>
        <span className="sr-only">{t('benchmarks.qualityScoreNotAssessed')}</span>
      </>
    )
  }

  return <>{formatMetric(value, QUALITY_SCORE_FORMAT, locale)}</>
}
