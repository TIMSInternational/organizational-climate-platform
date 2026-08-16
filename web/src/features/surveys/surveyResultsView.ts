import type { ChartDatum, WordFrequency } from '../../components/charts'
import type {
  SurveyBreakdown,
  SurveyDistributionBucket,
  SurveyQuestionResult,
  SurveySegmentResult,
} from './api/surveyResults'

/**
 * The pure shaping layer between `SurveyAnalyticsResponse` and the #79 chart
 * components.
 *
 * It lives in a `.ts` module rather than inside the page for two reasons. It is where
 * the privacy rule is actually enforced — "a withheld segment never becomes a data
 * point" is a property of a function, and a property of a function can be tested
 * exhaustively where a property of a rendered page can only be spot-checked. And it
 * keeps the page free of derivation, so what the page does read as layout.
 *
 * **Nothing here translates.** Callers pass already-translated labels in, exactly as
 * the chart components require, so this module holds no copy for the #217 guard to
 * find and no locale for it to get wrong.
 */

/**
 * The single series key every distribution chart uses.
 *
 * A stable key rather than the question id: `palette.seriesColorFor` assigns colour
 * from the key, so a per-question key would paint every question's bars a different
 * colour and imply a comparison between questions that does not exist. One key means
 * one colour, which is what "count of responses" deserves.
 */
export const RESPONSES_SERIES_KEY = 'responses'

/**
 * `QuestionTypes.OpenEnded`, mirrored.
 *
 * One name rather than a second vocabulary: this is the only question type the results
 * surface has to branch on, because it is the only one the server answers with word
 * frequencies instead of a distribution. Everything else is rendered by the same code
 * path, so listing the other six here would be a list that exists to be wrong.
 *
 * Branching on the type rather than on `distribution.length === 0` matters: a
 * multiple-choice question nobody answered also has an empty distribution, and it should
 * render as an empty *chart*, not as an empty word cloud.
 */
export const OPEN_ENDED_QUESTION_TYPE = 'open_ended'

export function isOpenEnded(question: Pick<SurveyQuestionResult, 'type'>): boolean {
  return question.type === OPEN_ENDED_QUESTION_TYPE
}

/** The two series of the drill-down comparison, in a fixed order so the colours are stable. */
export const SEGMENT_SERIES_KEY = 'segment'
export const OVERALL_SERIES_KEY = 'overall'

/**
 * What a bucket is called on screen.
 *
 * Falls back to the **stable value** when a locale carries no label, not to a
 * placeholder: the value is what the option actually is, and showing it lets an admin
 * recognise the option and go and translate it. It is also the only string here that
 * is guaranteed unique per bucket.
 */
export function bucketLabel(bucket: SurveyDistributionBucket): string {
  return bucket.label ?? bucket.value
}

/**
 * A question's distribution as bar-chart rows.
 *
 * Counts, not percentages. A bar chart is zero-anchored (the #79 lines-fit/bars-zero
 * rule, which `BarChart` implements by leaving recharts' default domain alone), and a
 * zero-anchored axis over counts is directly comparable between questions on the same
 * page — where percentages of differing answered counts are not.
 *
 * Bucket order is the server's, which is the question's configured option order.
 * Sorting by count here would reorder a Likert scale into a ranking and destroy the
 * only axis a scale question has.
 */
export function distributionChartData(question: SurveyQuestionResult): ChartDatum[] {
  return question.distribution.map((bucket) => ({
    label: bucketLabel(bucket),
    values: { [RESPONSES_SERIES_KEY]: bucket.count },
  }))
}

/**
 * Open-text words, as the word cloud wants them.
 *
 * `category` is the **language the word was written in**, and `colorBy="category"` is
 * what makes that visible. The server counts words per language on purpose — you
 * cannot write "the Spanish" of a sentence somebody typed in English — so merging the
 * two here would be a translation decision taken by a chart adapter. Two rows for a
 * word spelled identically in both languages is the correct, if surprising, answer.
 */
export function wordCloudData(question: SurveyQuestionResult): WordFrequency[] {
  return question.words.map((word) => ({
    text: word.word,
    value: word.count,
    category: word.language,
  }))
}

/** One segment of a question's distribution strip, scale-positioned. */
export interface DistributionStripBucket {
  /** The stable option value — the React key downstream. */
  key: string
  /** Where the bucket sits on the question's scale. Decides its colour. */
  position: number
  count: number
  /** The bucket's display text, `bucketLabel`'s fallback rule included. */
  label: string
}

export interface DistributionStripModel {
  /** In the server's bucket order, which is the question's own option order. */
  buckets: DistributionStripBucket[]
  /** The scale's ends: configured when the question carries them, otherwise the answered extremes. */
  min: number
  max: number
  total: number
}

/**
 * A question's distribution, shaped for `DistributionStrip` — or `null` when the
 * strip would be dishonest and the caller should fall back to the full card.
 *
 * ## `average !== null` is the gate, and it is the server's gate
 *
 * `SurveyAggregation.NumericStats` computes an average for `QuestionTypes.NumericScale`
 * only, and only when *every* answered value parses — so a non-null average is the
 * server's own statement that these bucket values are readings on one numeric scale.
 * A multiple-choice question whose option codes happen to be "1".."4" arrives with
 * `average: null` and must not be painted on a diverging ramp: its buckets are
 * categories, and red-to-blue over categories claims an order nobody authored.
 *
 * ## Why the bounds prefer the question's configured scale
 *
 * The buckets cannot recover the axis — a scale point nobody chose produces no
 * bucket — so `scaleMin`/`scaleMax` are the axis when the author set them. The
 * answered extremes are only the fallback, and a degenerate axis (`max <= min`,
 * one answered point) returns `null` rather than a strip whose midpoint is its
 * only point.
 */
export function distributionStripModel(
  question: SurveyQuestionResult,
): DistributionStripModel | null {
  if (question.average === null || question.distribution.length === 0) return null

  const buckets: DistributionStripBucket[] = []
  for (const bucket of question.distribution) {
    const position = Number.parseFloat(bucket.value)
    // NumericStats makes this unreachable for a question with an average, but a
    // guard beats a NaN painted mid-ramp if that invariant ever moves.
    if (!Number.isFinite(position)) return null
    buckets.push({ key: bucket.value, position, count: bucket.count, label: bucketLabel(bucket) })
  }

  const positions = buckets.map((bucket) => bucket.position)
  const min = question.scaleMin ?? Math.min(...positions)
  const max = question.scaleMax ?? Math.max(...positions)
  if (!(max > min)) return null

  return {
    buckets,
    min,
    max,
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
  }
}

/** Segments the server disclosed. */
export function disclosedSegments(breakdown: SurveyBreakdown): SurveySegmentResult[] {
  return breakdown.segments.filter((segment) => !segment.isSuppressed)
}

/**
 * Segments the server withheld.
 *
 * These are returned so a page can *show* them as withheld. They are separated from
 * the disclosed ones rather than filtered away because the table must render both and
 * the charts must render only the first — one predicate, used twice, instead of two
 * that can drift apart.
 */
export function withheldSegments(breakdown: SurveyBreakdown): SurveySegmentResult[] {
  return breakdown.segments.filter((segment) => segment.isSuppressed)
}

/**
 * One segment against the whole survey, question by question — the drill-down.
 *
 * Only questions the segment actually answered *and* the survey has an average for
 * appear: a missing average is a gap, and `BarChart` renders a missing series value as
 * a gap rather than as a zero, so a question the segment skipped shows one bar, not a
 * bar and a floor-level stub.
 */
export function segmentComparisonData(
  segment: SurveySegmentResult,
  questions: readonly SurveyQuestionResult[],
  questionLabel: (question: SurveyQuestionResult) => string,
): ChartDatum[] {
  const byQuestion = new Map(segment.questions.map((entry) => [entry.questionId, entry]))

  return questions
    .filter((question) => question.average !== null || byQuestion.get(question.questionId)?.average != null)
    .map((question) => ({
      label: questionLabel(question),
      values: {
        [SEGMENT_SERIES_KEY]: byQuestion.get(question.questionId)?.average ?? null,
        [OVERALL_SERIES_KEY]: question.average,
      },
    }))
}

/** Distinct question categories, in first-seen order. Blank and absent categories are not a category. */
export function questionCategories(questions: readonly SurveyQuestionResult[]): string[] {
  const seen: string[] = []
  for (const question of questions) {
    const category = question.category?.trim()
    if (category && !seen.includes(category)) seen.push(category)
  }
  return seen
}

/** Distinct question types, in first-seen order. */
export function questionTypes(questions: readonly SurveyQuestionResult[]): string[] {
  const seen: string[] = []
  for (const question of questions) {
    if (!seen.includes(question.type)) seen.push(question.type)
  }
  return seen
}

export interface QuestionFilter {
  /** Empty means every category. */
  category: string
  /** Empty means every type. */
  type: string
}

export const EMPTY_QUESTION_FILTER: QuestionFilter = { category: '', type: '' }

export function filterQuestions(
  questions: readonly SurveyQuestionResult[],
  filter: QuestionFilter,
): SurveyQuestionResult[] {
  return questions.filter(
    (question) =>
      (filter.category === '' || question.category?.trim() === filter.category) &&
      (filter.type === '' || question.type === filter.type),
  )
}

/**
 * Everyone the breakdown could not place in a visible segment.
 *
 * Withheld and unsegmented are added together for one purpose only: checking that the
 * breakdown accounts for every completed response. They are reported separately on
 * screen, because they mean different things — one group was measured and hidden, the
 * other was never in a group at all.
 */
export function breakdownAccountsForEveryone(
  breakdown: SurveyBreakdown,
  completedCount: number,
): boolean {
  const disclosed = disclosedSegments(breakdown).reduce(
    (total, segment) => total + segment.respondentCount,
    0,
  )
  return (
    disclosed + breakdown.suppressedRespondentCount + breakdown.unsegmentedRespondentCount ===
    completedCount
  )
}
