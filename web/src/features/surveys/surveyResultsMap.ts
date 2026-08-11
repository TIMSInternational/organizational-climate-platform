import type { ClimateMapRow, WordFrequency } from '../../components/charts'
import type {
  SurveyBreakdown,
  SurveyQuestionResult,
  SurveySegmentResult,
} from './api/surveyResults'

/**
 * The shaping layer behind the results page's headline figure: the climate map,
 * the findings it produces, the whole-survey dimension scores, and the open-text
 * themes.
 *
 * It is a `.ts` module beside `surveyResultsView.ts` for the reason that file
 * gives — the privacy and honesty rules are properties of functions, and a
 * property of a function can be tested exhaustively. **Nothing here translates**;
 * every label is passed in, so the module holds no copy.
 *
 * ## What a "dimension" is here
 *
 * `SurveyQuestionResult.category` — the construct a question measures
 * (psychological safety, workload, recognition). It is the only grouping the
 * payload carries above the individual question, and it is what an HR reader
 * means by a climate dimension. A scale question with no category falls into
 * `UNCATEGORISED_DIMENSION`, a sentinel the *page* renders with translated copy,
 * rather than being dropped — dropping it would shrink the map without saying so.
 *
 * ## Why only scale questions enter the map
 *
 * `SurveyAggregation.NumericStats` computes `average` for `QuestionTypes.NumericScale`
 * only — `likert` and `rating` — and returns null for everything else, including a
 * multiple-choice question whose option values happen to be "1".."4". So
 * `average !== null` is not a convenience filter, it is the server's own statement
 * that a mean is meaningful for this question. Averaging option codes would produce
 * a number with no meaning that the map would nonetheless colour.
 *
 * ## Why the target is the survey's own average, and not 70
 *
 * Nothing in `SurveyAnalyticsResponse` carries a target or a benchmark, and the
 * benchmark API is a separate round trip the page deliberately does not make (see
 * `SurveyResultsPage` on why this screen is one request). Inventing a fixed target
 * would colour every cell against a number nobody set.
 *
 * So the map measures the organisation against **itself**: the target is the mean
 * of the cells on screen, and a cell's colour is its polarity against that mean.
 * That is a real, stated comparison — "which group is worse than this
 * organisation's own average, and on what" — which is the question the screen is
 * opened to answer. The page prints the target beside the map so the reader is
 * never left guessing what the colour is relative to.
 *
 * The target is computed from the **rounded** cell values, not the raw ones, so
 * the number in the caption is exactly the mean of the numbers in the grid. A
 * target derived from unrounded cells can sit a tenth off what the visible figures
 * average to, which is the kind of discrepancy a careful reader checks by hand and
 * then stops trusting the page over.
 *
 * ## Why the scale bands are derived from the data
 *
 * `ClimateMap` takes `deadBandAt` and `extremeAt` in the same units as the scores.
 * Those units are the survey's own answer scale, and the payload does not say what
 * it is. `SurveyAggregation.SummariseQuestion` counts only the option values that
 * appear in the answers, and `OrderBuckets` labels and orders exactly those rows —
 * so a configured scale point nobody chose produces no bucket, and the question's
 * range cannot be recovered from the distribution. A 1-5 Likert and a 0-10 rating
 * would therefore share one hardcoded band width, and on one of them every cell
 * would saturate.
 *
 * `extremeAt` is instead the largest distance any cell sits from the target, so the
 * furthest cell always reaches the end of the ramp and the map uses its full range
 * whatever the scale. That also makes `ClimateMap`'s "severely below" ring land on
 * exactly the worst cell, which is the one the reader is being sent to.
 * `deadBandAt` is a fifth of that either side — the middle of the spread reads as
 * level with the organisation rather than as weakly good or weakly bad.
 */

/**
 * The dimension key a scale question with no category falls into.
 *
 * The empty string rather than a word, because every real category is a non-empty
 * trimmed string and so cannot collide with it, and because a word here would be
 * copy in a module that must hold none.
 */
export const UNCATEGORISED_DIMENSION = ''

/** Cells this far apart or closer are drawn as one colour. See the module note. */
const DEAD_BAND_FRACTION = 5

/**
 * The smallest usable `extremeAt`.
 *
 * When every cell is identical the largest deviation is 0, and `ClimateMap`
 * divides by `2 * extremeAt`. This floor keeps that division defined; every cell
 * then lands inside the dead band and the whole map draws neutral, which is the
 * honest picture of a survey where no group differs from any other.
 */
const MIN_EXTREME = 0.1

/** One decimal place — the precision the cells, the target and the caption share. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function dimensionKeyOf(question: Pick<SurveyQuestionResult, 'category'>): string {
  return question.category?.trim() ?? UNCATEGORISED_DIMENSION
}

export interface ClimateDimension {
  /** The category, or `UNCATEGORISED_DIMENSION`. */
  key: string
  /** The scale questions inside it, in the survey's own question order. */
  questionIds: string[]
}

/**
 * The dimensions a map could be drawn over, in first-seen question order.
 *
 * Question order, not alphabetical: the survey author grouped the questions, and
 * re-sorting the columns would put the constructs in an order nobody chose.
 */
export function climateDimensions(
  questions: readonly SurveyQuestionResult[],
): ClimateDimension[] {
  const byKey = new Map<string, ClimateDimension>()
  for (const question of questions) {
    if (question.average === null) continue
    const key = dimensionKeyOf(question)
    const existing = byKey.get(key)
    if (existing) existing.questionIds.push(question.questionId)
    else byKey.set(key, { key, questionIds: [question.questionId] })
  }
  return [...byKey.values()]
}

/**
 * One group's score on one dimension: the unweighted mean of its question means.
 *
 * Unweighted on purpose. `SurveySegmentQuestionResult` carries `answeredCount`, so
 * a respondent-weighted mean is available — but a dimension score is a construct
 * index, and weighting it would let the question most people happened to answer
 * define the construct. Every question the author put in the dimension gets an
 * equal say instead.
 *
 * `null` when the group has no mean for any question in the dimension. Never 0: a
 * missing measurement is not a measurement of zero, and this is the value that
 * would otherwise be coloured at the bottom of the ramp.
 */
export function segmentDimensionScore(
  segment: SurveySegmentResult,
  dimension: ClimateDimension,
): number | null {
  const wanted = new Set(dimension.questionIds)
  let total = 0
  let count = 0
  for (const entry of segment.questions) {
    if (!wanted.has(entry.questionId) || entry.average === null) continue
    total += entry.average
    count += 1
  }
  return count === 0 ? null : round1(total / count)
}

/** The whole survey's score on one dimension, on the same unweighted basis. */
export function surveyDimensionScore(
  questions: readonly SurveyQuestionResult[],
  dimension: ClimateDimension,
): number | null {
  const wanted = new Set(dimension.questionIds)
  let total = 0
  let count = 0
  for (const question of questions) {
    if (!wanted.has(question.questionId) || question.average === null) continue
    total += question.average
    count += 1
  }
  return count === 0 ? null : round1(total / count)
}

export interface DimensionStanding {
  key: string
  /** How many scale questions the score is the mean of. */
  questionCount: number
  score: number
}

export interface DimensionStandings {
  /** Worst first — the line a reader needs is the first one. */
  rows: DimensionStanding[]
  /** The mean of the dimension scores. What each row is measured against. */
  overall: number
  deadBandAt: number
  extremeAt: number
}

/**
 * The whole survey's dimensions, worst first, against the mean of themselves.
 *
 * ## Why this has its own baseline instead of reusing the map's target
 *
 * They are means over different populations and would silently disagree. The
 * climate map's target is the mean of the **group × dimension** cells, so a group
 * with a handful of respondents counts as much as one with two hundred; this
 * table's baseline is the mean of the **dimension** scores. A dimension can sit
 * above one and below the other with both figures correct, and a reader comparing
 * the two panels would be right to conclude the page contradicts itself. Each
 * panel therefore states the baseline it uses and uses only its own.
 *
 * Sorted ascending by score rather than kept in question order: the columns of a
 * grid must stay in a stable, author-chosen order so rows can be compared down
 * them, but this is a ranking with one number per line and the useful line is the
 * lowest one. Ties break on the key so the order is stable across renders.
 */
export function surveyDimensionStandings(
  questions: readonly SurveyQuestionResult[],
): DimensionStandings | null {
  const rows: DimensionStanding[] = []
  for (const dimension of climateDimensions(questions)) {
    const score = surveyDimensionScore(questions, dimension)
    if (score === null) continue
    rows.push({ key: dimension.key, questionCount: dimension.questionIds.length, score })
  }
  if (rows.length === 0) return null

  rows.sort((left, right) => left.score - right.score || left.key.localeCompare(right.key))
  const overall = round1(rows.reduce((sum, row) => sum + row.score, 0) / rows.length)
  const extremeAt = Math.max(
    ...rows.map((row) => Math.abs(row.score - overall)),
    MIN_EXTREME,
  )

  return { rows, overall, extremeAt, deadBandAt: extremeAt / DEAD_BAND_FRACTION }
}

export interface ClimateMapModel {
  /** The columns actually drawn. */
  dimensions: ClimateDimension[]
  /**
   * Every group the map accounts for, in the server's order — including the
   * withheld ones, which arrive with no scores and are rendered as protected.
   */
  rows: ClimateMapRow[]
  /**
   * The mean of every visible cell. What the colours are relative to.
   *
   * `null` when no group is disclosed: there is then no cell to average, and
   * nothing on the grid is measured against anything. Every row in that case is
   * a withheld one, which `ClimateMap` renders as protected — see below.
   */
  target: number | null
  deadBandAt: number
  extremeAt: number
  /** The anonymity floor to hand `ClimateMap`. */
  threshold: number
  /** Dimension keys left out because some disclosed group has no score for them. */
  omittedDimensions: string[]
  /** Labels of disclosed groups left out because they have no score at all. */
  omittedSegments: string[]
}

/**
 * The whole climate map, or `null` when there is nothing honest to draw.
 *
 * ## Why withheld groups are rows and disclosed-but-unscored groups are not
 *
 * They are different facts. A withheld group **was measured** and its reading is
 * being protected, so it keeps its row and every cell renders as a
 * `ProtectedCell` — `ClimateMap` does that itself once `responses` is under
 * `threshold`, which is why a suppressed segment is handed through with the
 * `respondentCount: 0` the server sent and an empty `scores` array it never reads.
 * A disclosed group with no scale answers at all was **not measured**; there is
 * nothing to protect and nothing to draw, and hatching it would claim a guarantee
 * was enforced when none was. It leaves the map and is named in `omittedSegments`
 * so the page can account for it.
 *
 * ## Why an incomplete column is dropped rather than gapped
 *
 * `ClimateMapRow.scores` is a dense array — the grid is rectangular by
 * construction and there is no representation for a missing cell. The three ways
 * to keep such a column are all worse than dropping it: a zero is a false
 * measurement, the survey-wide figure substituted for a group's is a fabrication
 * attributed to that group, and a hatched cell is the protection claim above. So
 * a dimension survives only if every group drawn has a score for it, and the count
 * of the ones that did not is reported.
 *
 * ## Why "every group is withheld" is a map and not a `null`
 *
 * When the floor takes every group there is nothing to *colour*, but there is a
 * great deal to *say*: these groups exist, they were measured, and their readings
 * are being protected. Returning `null` there would delete the whole section from
 * the page, and an absent section is worse than an empty cell — the reader cannot
 * even learn that group-level climate was measured, while the breakdown table
 * further down still lists every one of those groups as withheld. So the map is
 * still returned: every row present, every cell protected, and `target` `null`
 * because no cell was disclosed for a target to be the mean of.
 *
 * `null` is kept for the cases where there is genuinely nothing to show: no scale
 * question at all, or no group of any kind in the breakdown.
 */
export function buildClimateMap(
  breakdown: SurveyBreakdown,
  questions: readonly SurveyQuestionResult[],
  minimumGroupSize: number,
  labelOf: (segment: SurveySegmentResult) => string,
): ClimateMapModel | null {
  const dimensions = climateDimensions(questions)
  if (dimensions.length === 0) return null

  const disclosed = breakdown.segments.filter((segment) => !segment.isSuppressed)
  const scored: SurveySegmentResult[] = []
  const omittedSegments: string[] = []
  for (const segment of disclosed) {
    const hasAny = dimensions.some(
      (dimension) => segmentDimensionScore(segment, dimension) !== null,
    )
    if (hasAny) scored.push(segment)
    else omittedSegments.push(labelOf(segment))
  }

  const kept: ClimateDimension[] = []
  const omittedDimensions: string[] = []
  for (const dimension of dimensions) {
    const complete = scored.every(
      (segment) => segmentDimensionScore(segment, dimension) !== null,
    )
    if (complete) kept.push(dimension)
    else omittedDimensions.push(dimension.key)
  }
  if (kept.length === 0) return null

  const scoredRows = scored.map((segment) => ({
    segment,
    scores: kept.map((dimension) => segmentDimensionScore(segment, dimension) as number),
  }))

  const cells = scoredRows.flatMap((row) => row.scores)
  // No disclosed cell means no mean to take. `reduce`-then-divide would return
  // NaN here and `Math.max()` over nothing returns -Infinity, and both would be
  // handed to the colour scale as if they were readings.
  const target =
    cells.length === 0 ? null : round1(cells.reduce((sum, cell) => sum + cell, 0) / cells.length)
  const extremeAt =
    target === null
      ? MIN_EXTREME
      : Math.max(Math.max(...cells.map((cell) => Math.abs(cell - target))), MIN_EXTREME)

  const scoresByKey = new Map(scoredRows.map((row) => [row.segment.key, row.scores]))
  const rows: ClimateMapRow[] = []
  for (const segment of breakdown.segments) {
    if (segment.isSuppressed) {
      rows.push({
        id: segment.key,
        label: labelOf(segment),
        responses: segment.respondentCount,
        scores: [],
      })
      continue
    }
    const scores = scoresByKey.get(segment.key)
    if (!scores) continue
    rows.push({
      id: segment.key,
      label: labelOf(segment),
      responses: segment.respondentCount,
      scores,
    })
  }
  // Nothing was measured and nothing is being protected — the breakdown holds no
  // group this map could account for. That is the one case where the section has
  // nothing to say and is right to be absent.
  if (rows.length === 0) return null

  return {
    dimensions: kept,
    rows,
    target,
    extremeAt,
    deadBandAt: extremeAt / DEAD_BAND_FRACTION,
    // A floor of 0 would make `isSuppressed` false for the `respondentCount: 0`
    // the server sends with a withheld group, and the row would try to read
    // scores it does not have.
    threshold: Math.max(1, minimumGroupSize),
    omittedDimensions,
    omittedSegments,
  }
}

export interface ClimateFinding {
  /** The segment key, so the page can drill into the group this came from. */
  rowId: string
  rowLabel: string
  dimensionKey: string
  score: number
  /** How far under the target this cell sits. Always positive. */
  shortfall: number
}

/**
 * The cells worth acting on, worst first.
 *
 * Only cells below the target: a cell above it is good news and is not a finding.
 * Withheld rows produce none — there is no reading to act on, and naming a group
 * as a problem on the strength of a reading nobody is allowed to see would leak
 * the very thing the floor protects.
 *
 * Ties are broken by label and then by dimension so the list is stable between
 * renders rather than reordering itself on data that did not change.
 *
 * A map with no target has no disclosed cell to compare against one, so it
 * produces no findings — the page says so in words rather than showing an empty
 * list.
 */
export function climateFindings(model: ClimateMapModel, limit = 4): ClimateFinding[] {
  const target = model.target
  if (target === null) return []

  const findings: ClimateFinding[] = []
  for (const row of model.rows) {
    if (row.responses < model.threshold) continue
    model.dimensions.forEach((dimension, index) => {
      const score = row.scores[index]
      if (score === undefined || score >= target) return
      findings.push({
        rowId: row.id,
        rowLabel: row.label,
        dimensionKey: dimension.key,
        score,
        shortfall: round1(target - score),
      })
    })
  }

  findings.sort(
    (left, right) =>
      right.shortfall - left.shortfall ||
      left.rowLabel.localeCompare(right.rowLabel) ||
      left.dimensionKey.localeCompare(right.dimensionKey),
  )
  return findings.slice(0, limit)
}

/**
 * Every open-text word the survey returned, merged across its open-ended
 * questions.
 *
 * Merged by word **and language**, never across languages: the server counts per
 * language because you cannot write "the Spanish" of a sentence somebody typed in
 * English, and collapsing the two here would be a translation decision taken by an
 * adapter. Two rows for a word spelled identically in both languages is the
 * correct, if surprising, answer — the same rule `wordCloudData` follows for a
 * single question.
 *
 * Verbatim response text is never in the payload, so nothing here can leak one.
 */
export function openTextThemes(questions: readonly SurveyQuestionResult[]): WordFrequency[] {
  const totals = new Map<string, WordFrequency>()
  for (const question of questions) {
    for (const word of question.words) {
      const key = `${word.language} ${word.word}`
      const existing = totals.get(key)
      if (existing) existing.value += word.count
      else totals.set(key, { text: word.word, value: word.count, category: word.language })
    }
  }
  return [...totals.values()].sort(
    (left, right) => right.value - left.value || left.text.localeCompare(right.text),
  )
}

/** Distinct words the server withheld, summed over every question. */
export function withheldWordCount(questions: readonly SurveyQuestionResult[]): number {
  return questions.reduce((total, question) => total + question.suppressedWordCount, 0)
}
