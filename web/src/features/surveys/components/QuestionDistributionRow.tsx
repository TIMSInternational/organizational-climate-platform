import { useTranslation } from '../../../i18n'
import {
  BandChip,
  DistributionStrip,
  bandOf,
  formatMetric,
  scoreText,
  type MetricFormat,
  type ResultBands,
  type ResultScale,
} from '../../../components/charts'
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
  /** The company's result scale. Only a 1–5 question's average is read on it; default `mean`. */
  scale?: ResultScale
  /** Already-translated short identifier, e.g. "Q3". */
  shortLabel: string
  /** Already-translated dimension display text — the category, or the uncategorised word. */
  dimensionName: string
  /** Whether the question actually carries a category, which decides the chip's tone. */
  uncategorised: boolean
  /**
   * The company's result bands. Given, a 1–5 question's mean is named in its result area
   * (glyph + name, `BandChip`) and its standing against the survey is plain secondary text —
   * one verdict language on the page, the map's. Absent (the unrouted legacy page), the old
   * standing chip is kept.
   */
  bands?: ResultBands
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
 * ## The readings are tabular; the words are not
 *
 * `n` and the mean render in `tabular-nums` (the one sans face) with the unit words beside them — the instrument rule every reading on this page follows. The mean is
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
  scale = 'mean',
  bands,
}: QuestionDistributionRowProps) {
  const { t, locale } = useTranslation()

  const heading = question.text ?? t('surveyResults.untranslatedQuestion')
  const standing = standings?.scores.get(question.questionId)
  const onFive = question.scaleMin === 1 && question.scaleMax === 5
  // Judged at the one decimal it is printed at, so the chip and the figure agree.
  const band = bands && onFive && question.average !== null ? bandOf(question.average, bands, 1) : null
  const standingLabel =
    standings && standing !== undefined
      ? t(
          standing - standings.overall > standings.deadBandAt
            ? 'surveyResults.standingAbove'
            : standing - standings.overall < -standings.deadBandAt
              ? 'surveyResults.standingBelow'
              : 'surveyResults.standingLevel',
        )
      : null

  const endCaption = (bound: number, label: string | null) =>
    label === null
      ? formatMetric(bound, { kind: 'number' }, locale)
      : `${formatMetric(bound, { kind: 'number' }, locale)} · ${label}`

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line-panel bg-surface-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-fg-secondary">{shortLabel}</span>
          <span className="text-base font-semibold text-fg-primary">{heading}</span>
          {/* The dimension made visible where the aggregation happens. Tone follows
              the chip rule from `SurveyList`: the tint marks the chip, the word
              stays `text-fg-primary` — tinted text on the soft fill is the
              measured light-theme AA failure. An uncategorised question wears the
              neutral chip: it is a fact about the survey, not a warning here. */}
          <span
            className={cn(
              // Neutral either way: blue is action, selection and live, and a category is none.
              'inline-flex h-5.5 items-center rounded-full bg-chip-neutral-fill px-2.5 text-xs font-medium',
              uncategorised ? 'text-fg-secondary' : 'text-chip-neutral-ink',
            )}
          >
            {dimensionName}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-secondary">
          <span>
            <span className="font-semibold tabular-nums text-fg-primary">
              {formatMetric(question.answeredCount, { kind: 'number' }, locale)}
            </span>{' '}
            {t('surveyResults.answersUnit')}
          </span>
          {question.average !== null && (
            <span>
              {t('surveyResults.averageLabel')}{' '}
              <span className="font-semibold tabular-nums text-fg-primary">
                {onFive
                  ? scoreText(question.average, scale, locale, 1)
                  : formatMetric(question.average, SCORE_FORMAT, locale)}
              </span>
            </span>
          )}
          {band && bands && <BandChip band={band} bands={bands} />}
          {bands
            ? standingLabel !== null && <span className="text-fg-secondary">{standingLabel}</span>
            : standings &&
              standing !== undefined && (
            <StandingChip
              score={standing}
              target={standings.overall}
              deadBandAt={standings.deadBandAt}
              extremeAt={standings.extremeAt}
              label={standingLabel ?? ''}
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
