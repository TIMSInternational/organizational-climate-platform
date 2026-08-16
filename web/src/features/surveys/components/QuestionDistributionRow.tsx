import { useTranslation } from '../../../i18n'
import { DistributionStrip, formatMetric, type MetricFormat } from '../../../components/charts'
import { cn } from '../../../lib/cn'
import type { SurveyQuestionResult } from '../api/surveyResults'
import type { DistributionStripModel } from '../surveyResultsView'
import type { QuestionStandings } from '../surveyResultsMap'
import StandingChip from './StandingChip'

/** One decimal — the precision of every score on the results page; see `SurveyResultsPage`. */
const SCORE_FORMAT: MetricFormat = { kind: 'number', decimals: 1 }

interface QuestionDistributionRowProps {
  question: SurveyQuestionResult
  /** Built by `distributionStripModel`; a caller with `null` renders the full card instead. */
  strip: DistributionStripModel
  /** The per-question baseline the standing chip reads. `null` renders no chip. */
  standings: QuestionStandings | null
  /** Already-translated short identifier, e.g. "Q3". */
  shortLabel: string
  /** Already-translated dimension display text — the category, or the uncategorised word. */
  dimensionName: string
  /** Whether the question actually carries a category, which decides the chip's tone. */
  uncategorised: boolean
}

/**
 * One scale question as one row: text, dimension chip, n, mean, standing, and the
 * stacked distribution strip — the drawn replacement for a full `BarChart` card
 * per question (decision 06 of the admin round).
 *
 * The walk measured the shipped alternative: six ~300px teal bar charts, 4,652px
 * of page for six Likert questions, the bars' colour carrying no meaning and the
 * axes bare numbers. This row holds the same facts in ~130px, and its colour
 * means what it means everywhere else on the page — `DistributionStrip` reads the
 * climate map's own diverging ramp.
 *
 * ## The readings are mono; the words are not
 *
 * `n` and the mean render in `font-mono tabular-nums` with the unit words in the
 * sans face — the instrument rule every reading on this page follows. The mean is
 * printed at the page's one-decimal precision, from the same `average` the
 * standing chip is computed from, so the two cannot disagree.
 *
 * ## The scale ends are the author's words, or the bare numbers
 *
 * `scaleLabelMin`/`scaleLabelMax` are survey content. When the author set them the
 * caption reads "1 · Strongly disagree"; when not, the bare bound — never an
 * invented anchor. The join is punctuation, not copy, so it needs no locale
 * (same reasoning as `KpiTile`'s em dash).
 */
export default function QuestionDistributionRow({
  question,
  strip,
  standings,
  shortLabel,
  dimensionName,
  uncategorised,
}: QuestionDistributionRowProps) {
  const { t, locale } = useTranslation()

  const heading = question.text ?? t('surveyResults.untranslatedQuestion')
  const standing = standings?.scores.get(question.questionId)

  const endCaption = (bound: number, label: string | null) =>
    label === null
      ? formatMetric(bound, { kind: 'number' }, locale)
      : `${formatMetric(bound, { kind: 'number' }, locale)} · ${label}`

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line-light bg-surface-panel p-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-2xs tabular-nums text-fg-secondary">{shortLabel}</span>
          <span className="text-sm font-semibold text-fg-primary">{heading}</span>
          {/* The dimension made visible where the aggregation happens. Tone follows
              the chip rule from `SurveyList`: the tint marks the chip, the word
              stays `text-fg-primary` — tinted text on the soft fill is the
              measured light-theme AA failure. An uncategorised question wears the
              neutral chip: it is a fact about the survey, not a warning here. */}
          <span
            className={cn(
              'inline-flex h-5 items-center rounded-full border px-2 text-xs font-semibold',
              uncategorised
                ? 'border-line-light bg-surface-icon-box text-fg-secondary'
                : 'border-accent-blue-ring bg-accent-blue-soft text-fg-primary',
            )}
          >
            {dimensionName}
          </span>
        </span>
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-secondary">
          <span>
            <span className="font-mono font-semibold tabular-nums text-fg-primary">
              {formatMetric(question.answeredCount, { kind: 'number' }, locale)}
            </span>{' '}
            {t('surveyResults.answersUnit')}
          </span>
          {question.average !== null && (
            <span>
              {t('surveyResults.averageLabel')}{' '}
              <span className="font-mono font-semibold tabular-nums text-fg-primary">
                {formatMetric(question.average, SCORE_FORMAT, locale)}
              </span>
            </span>
          )}
          {standings && standing !== undefined && (
            <StandingChip
              score={standing}
              target={standings.overall}
              deadBandAt={standings.deadBandAt}
              extremeAt={standings.extremeAt}
              label={t(
                standing - standings.overall > standings.deadBandAt
                  ? 'surveyResults.standingAbove'
                  : standing - standings.overall < -standings.deadBandAt
                    ? 'surveyResults.standingBelow'
                    : 'surveyResults.standingLevel',
              )}
            />
          )}
        </span>
      </div>

      <DistributionStrip
        segments={strip.buckets.map((bucket) => ({
          key: bucket.key,
          position: bucket.position,
          count: bucket.count,
          // The one surface that names a thin segment — count and total together
          // here are whole-survey figures, which the floor does not protect.
          label: t('surveyResults.stripSegment', {
            label: bucket.label,
            count: bucket.count,
            total: strip.total,
          }),
        }))}
        min={strip.min}
        max={strip.max}
        minEnd={endCaption(strip.min, question.scaleLabelMin)}
        maxEnd={endCaption(strip.max, question.scaleLabelMax)}
        locale={locale}
      />
    </div>
  )
}
