import { useTranslation } from '../../../i18n'
import {
  BarChart,
  WordCloud,
  type ChartDatum,
  type ChartSeries,
  type WordFrequency,
} from '../../../components/charts'
import { Alert, AlertDescription, AlertTitle, EmptyState } from '../../../components/ui'
import type { WordCloudEntry } from '../api/microclimates'
import { MINIMUM_RESPONDENTS, suppressWordCloud } from '../microclimatePrivacy'
import { languageLabel } from '../microclimateVocabulary'

/** How many words the bar form shows. Beyond this the labels stop being readable. */
const MAX_BARS = 10

interface MicroclimateWordPanelProps {
  words: readonly WordCloudEntry[]
  /** The session's own response total. The suppression floor is about people, not words. */
  responseCount: number
  /**
   * Already-translated heading, passed to the chart for its accessible name.
   *
   * Optional, because a caller that already renders its own section heading above
   * this panel must be able to leave it off. Passing it in that case drew the same
   * words twice — once as the page's `<H2>` and again as the chart's `<figcaption>`.
   * The live view has no heading of its own and does pass one.
   */
  title?: string
  /**
   * `cloud` while the session is running — the ranking is glanceable and the panel
   * does not change height as words arrive. `bars` on the results page, where the
   * job is comparing frequencies rather than reading a shape, and length is easier
   * to judge than type size.
   */
  variant?: 'cloud' | 'bars'
  isLoading?: boolean
  /** Test-only explicit width — `ResponsiveContainer` measures 0 under happy-dom. */
  width?: number
}

/**
 * What people wrote, with the disclosure control applied and *stated*.
 *
 * Shared by the live view and the results page so the two cannot disagree about what
 * is safe to show — which they would, since one of them polls and one of them does
 * not, and a floor applied in two places is a floor applied at two different values
 * eventually.
 *
 * ## Three states, all designed
 *
 * - **Withheld.** Below `MINIMUM_RESPONDENTS` the words are replaced by a notice that
 *   says so. Blanking the panel instead would read as "nobody wrote anything", which
 *   is a different fact and sends an admin looking for the raw data.
 * - **Empty.** Above the floor with no words at all: the session has no open-ended
 *   question, or nobody has written into one yet. Said in those words rather than as
 *   an empty box.
 * - **Shown**, with the count of rare words withheld underneath. Reported rather than
 *   silently dropped, so the totals still reconcile against the response counter.
 *
 * See `microclimatePrivacy.ts` for the floors and for the one thing this control
 * cannot do — the server counts word *occurrences*, not respondents, so a per-word
 * floor of 2 is clearable by one person repeating themselves.
 *
 * ## Colour encodes language, and only when there is more than one
 *
 * `CountWordFrequencies` keys on `(language, word)` precisely so "work" and "trabajo"
 * are not one entry. Passing `language` as the chart's `category` makes that visible
 * instead of merely true. With a single language every word would land in one
 * category and the legend would be a colour key with one row, so `colorBy` stays
 * `none` there — `WordCloud` already encodes frequency in size, and a second encoding
 * of nothing is worse than no second encoding.
 */
export default function MicroclimateWordPanel({
  words,
  responseCount,
  title,
  variant = 'cloud',
  isLoading = false,
  width,
}: MicroclimateWordPanelProps) {
  const { t } = useTranslation()
  const { words: visible, withheldCount, isSuppressed } = suppressWordCloud(words, responseCount)

  if (isSuppressed) {
    return (
      <Alert variant="warning" role="status">
        <AlertTitle>{t('microclimates.wordCloudSuppressedTitle')}</AlertTitle>
        <AlertDescription>
          {t('microclimates.wordCloudSuppressedDescription', { minimum: MINIMUM_RESPONDENTS })}
        </AlertDescription>
      </Alert>
    )
  }

  if (!isLoading && visible.length === 0) {
    return (
      <EmptyState
        title={t('microclimates.wordCloudEmpty')}
        description={t('microclimates.wordCloudEmptyDescription')}
      />
    )
  }

  const languages = [...new Set(visible.map((word) => word.language))]

  return (
    <div className="flex flex-col gap-inline">
      {variant === 'bars' ? (
        // One series per language, so "work" and "trabajo" sit in their own bars
        // instead of being summed into a number that is about neither. Bars start at
        // zero -- `BarChart` simply omits a `domain`, which is recharts' default and
        // the documented rule for a magnitude comparison.
        <BarChart
          title={title}
          width={width}
          isLoading={isLoading}
          // Sorted here rather than trusted: the endpoint returns whatever order the
          // stored JSON happens to hold, and "top 10" taken off an unsorted list is
          // ten arbitrary words under a heading that claims otherwise.
          data={barData(visible.toSorted((a, b) => b.value - a.value).slice(0, MAX_BARS), languages)}
          series={barSeries(languages, (language) => languageLabel(t, language))}
        />
      ) : (
        <WordCloud
          data={cloudData(visible, (language) => languageLabel(t, language))}
          title={title}
          isLoading={isLoading}
          colorBy={languages.length > 1 ? 'category' : 'none'}
        />
      )}
      {withheldCount > 0 && (
        <p className="m-0 text-sm text-fg-secondary">
          {t('microclimates.wordCloudWithheld', { count: withheldCount })}
        </p>
      )}
    </div>
  )
}

function cloudData(
  words: readonly WordCloudEntry[],
  label: (language: string) => string,
): WordFrequency[] {
  return words.map((word) => ({
    text: word.text,
    value: word.value,
    category: label(word.language),
  }))
}

function barSeries(languages: readonly string[], label: (language: string) => string): ChartSeries[] {
  // `key` is the wire language code, not the translated name: `seriesColorFor`
  // assigns colour from the key, so a series must not change colour when the reader
  // switches the UI language.
  return languages.map((language) => ({ key: language, name: label(language) }))
}

function barData(words: readonly WordCloudEntry[], languages: readonly string[]): ChartDatum[] {
  return words.map((word) => ({
    label: word.text,
    // A language this word was not written in is `null`, not `0`. `ChartDatum`
    // documents the difference and `BarChart` renders a gap rather than a zero-height
    // bar, so a Spanish-only word does not look like an English word nobody used.
    values: Object.fromEntries(
      languages.map((language) => [language, language === word.language ? word.value : null]),
    ),
  }))
}
