import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { ClimateMapSelection, WordFrequency } from '../../../components/charts'
import type { SurveyDistributionBucket, SurveyQuestionResult, SurveySegmentResult } from '../api/surveyResults'
import { CLIMATE_TARGET } from '../../dashboard/next/compose'
import {
  climateDetail,
  openTextThemes,
  surveyDimensionScore,
  withheldWordCount,
  type ClimateDimension,
} from '../surveyResultsMap'
import { isOpenEnded } from '../surveyResultsView'
import type { ResultsGroupRow, ResultsPlanRef, SurveyResultsNextModel } from './model'

/**
 * Every number the redesigned results page prints, derived from the model.
 *
 * ## What every figure is measured against
 *
 * The **climate target**, `CLIMATE_TARGET` (3.7) — the same constant the Panel de
 * Control reads (`dashboard/next/compose.ts`), so the two screens cannot classify one
 * dimension two ways. Nothing on the wire carries a target yet; `surveyResultsMap.ts`
 * colours its own map against the survey's mean because it predates the target, and
 * this page deliberately does not: "bajo la meta" and "bajo la media" are different
 * claims, and the approved artboard makes the first one.
 *
 * ## Where the rows come from
 *
 * The map rows, the withheld rows and the opened cell all come from
 * `surveyResultsMap.ts` — `buildClimateMap` and `climateDetail` — the same functions
 * the previous page used, so the two cannot disagree about which groups are withheld.
 * A withheld row never reaches any arithmetic here: it carries `null` scores and a
 * `null` mean, never 0.
 *
 * The one thing this file computes that the map does not is a **mean across
 * dimensions** (per group, and for the whole company). It is taken over the
 * *unrounded* per-question means on the wire rather than over the rounded cells, for
 * the reason `compose.ts` gives for the dashboard's CLIMA figure: that tile is the mean
 * of the raw trends scores, and this page has to print the same number for the same
 * survey — a reader moving between the two screens must not see 3,65 become 3,67.
 *
 * ## What every change is measured against
 *
 * The previous wave, measured (`compose.ts` `composePrevious`): the same means, read off
 * that survey's own analytics by the same rules. A change is always like for like
 * (`likeForLike`) — over the dimensions both waves carry — and a group the previous wave
 * withheld has no change at all, never a 0.
 */

export { CLIMATE_TARGET }

/** One decimal, the precision `surveyResultsMap.ts` rounds every cell to. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Two decimals, the precision the CLIMA tile and the whole-company mean print at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Where a one-decimal reading sits against the target: the five steps the map tints.
 *
 * The target is a floor to reach, not a point to hover around, which is why the band
 * is not symmetric: a reading over it is *above* the goal (blue), a reading at it or
 * within `ON_TARGET_TOLERANCE` under it is *on* the goal (grey — the width of two
 * rounding steps on a one-decimal figure), and anything further under is *below*
 * (red). The far steps saturate at `FAR_BELOW_AT` under and `FAR_ABOVE_AT` over. The
 * thresholds are what the approved artboards tint — 3,5 to 3,7 grey, 3,8 to 4,1 light
 * blue, 4,2 and up dark blue, 3,4 down to 2,8 light red, 2,7 and under dark red — and
 * the whole test of this function is that table (`derive.test.ts`).
 */
export type TargetBand = 'far-below' | 'below' | 'on' | 'above' | 'far-above'

export const ON_TARGET_TOLERANCE = 0.2
export const FAR_BELOW_AT = 1
export const FAR_ABOVE_AT = 0.5

export function targetBand(score: number, target: number = CLIMATE_TARGET): TargetBand {
  // Rounded first: `3.5 - 3.7` is `-0.20000000000000018` in floating point, which is
  // not `-0.2` and would tip a grey cell into red.
  const delta = round1(score - target)
  if (delta <= -FAR_BELOW_AT) return 'far-below'
  if (delta < -ON_TARGET_TOLERANCE) return 'below'
  if (delta <= 0) return 'on'
  if (delta < FAR_ABOVE_AT) return 'above'
  return 'far-above'
}

/** The index of each band in `DIVERGING_COLORS` / `DIVERGING_INKS` — one ramp, one meaning per colour. */
export const BAND_STEP: Readonly<Record<TargetBand, 0 | 1 | 2 | 3 | 4>> = {
  'far-below': 0,
  below: 1,
  on: 2,
  above: 3,
  'far-above': 4,
}

/** A red cell: under the target by more than the on-target tolerance. */
export function isRed(band: TargetBand): boolean {
  return band === 'far-below' || band === 'below'
}

/**
 * "Bajo la meta", the way the Panel de Control says it: a printed reading under the
 * target. Strict, over the one-decimal figure the page prints, so the tile and the
 * dashboard chip agree about a dimension whose reading is exactly 3,7.
 */
export function isBelowTarget(score: number, target: number = CLIMATE_TARGET): boolean {
  return round1(score) < target
}

/** The unrounded mean of a group's per-question means inside one dimension. */
function rawSegmentScore(segment: SurveySegmentResult, dimension: ClimateDimension): number | null {
  const wanted = new Set(dimension.questionIds)
  return mean(
    segment.questions
      .filter((entry) => wanted.has(entry.questionId) && entry.average !== null)
      .map((entry) => entry.average as number),
  )
}

/** The unrounded mean of the whole survey's per-question means inside one dimension. */
function rawSurveyScore(questions: readonly SurveyQuestionResult[], dimension: ClimateDimension): number | null {
  const wanted = new Set(dimension.questionIds)
  return mean(
    questions
      .filter((question) => wanted.has(question.questionId) && question.average !== null)
      .map((question) => question.average as number),
  )
}

/**
 * The map's rows with a per-group mean, protected rows first-class.
 *
 * A protected row arrives from `buildClimateMap` with no scores and must read the same
 * way in every panel, so it carries `null` scores and a `null` mean here — never 0,
 * which would be a claim. A disclosed row's `scores` are the map's rounded cells;
 * its `mean` is over the raw per-question means (see the module note).
 */
export function groupRows(model: SurveyResultsNextModel): ResultsGroupRow[] {
  const climate = model.climate
  if (!climate) return []
  const segments = new Map((model.breakdown?.segments ?? []).map((segment) => [segment.key, segment]))
  const keys = climate.dimensions.map((dimension) => dimension.key)
  const before = model.previous.status === 'loaded' ? model.previous.wave.groupScores : {}
  return climate.rows.map((row) => {
    const isProtected = climate.target === null || row.responses < climate.threshold
    const scores = climate.dimensions.map((_, index) => (isProtected ? null : (row.scores[index] ?? null)))
    let rowMean: number | null = null
    let vsPrevious: number | null = null
    if (!isProtected) {
      const segment = segments.get(row.id)
      const raw = segment ? climate.dimensions.map((dimension) => rawSegmentScore(segment, dimension)) : scores
      const all = mean(raw.filter((score): score is number => score !== null))
      rowMean = all === null ? null : round1(all)
      // Only a group the previous wave DISCLOSED has an entry there. A withheld one has
      // none, so its change stays `null` — "sin Q2" on the grid, never a 0.
      const previous = before[row.id] as Readonly<Record<string, number>> | undefined
      vsPrevious = previous === undefined ? null : likeForLike(keys, raw, previous)
    }
    return { id: row.id, name: row.label, responses: row.responses, isProtected, scores, mean: rowMean, vsPrevious }
  })
}

/** The whole survey's rounded mean per map column, in column order — the company row's cells. */
export function companyScores(model: SurveyResultsNextModel): (number | null)[] {
  if (!model.climate) return []
  return model.climate.dimensions.map((dimension) => surveyDimensionScore(model.questions, dimension))
}

/**
 * The whole survey's climate: the mean of its dimension scores, unrounded until the
 * end and printed to two decimals — the CLIMA tile, and the company row's own mean.
 */
export function companyMean(model: SurveyResultsNextModel): number | null {
  if (!model.climate) return null
  const raw = mean(
    model.climate.dimensions
      .map((dimension) => rawSurveyScore(model.questions, dimension))
      .filter((score): score is number => score !== null),
  )
  return raw === null ? null : round2(raw)
}

/**
 * The change between two readings of the same construct: the mean of `now` minus the
 * mean of `before`, over exactly the dimension keys BOTH carry — so a dimension one
 * wave asked and the other did not cannot move the average. `null` when they share none.
 */
function likeForLike(
  keys: readonly string[],
  now: readonly (number | null)[],
  before: Readonly<Record<string, number>>,
): number | null {
  const current: number[] = []
  const earlier: number[] = []
  keys.forEach((key, index) => {
    const reading = now[index]
    const previous = before[key] as number | undefined
    if (reading === null || reading === undefined || previous === undefined) return
    current.push(reading)
    earlier.push(previous)
  })
  const nowMean = mean(current)
  const beforeMean = mean(earlier)
  return nowMean === null || beforeMean === null ? null : nowMean - beforeMean
}

/**
 * How far the whole company's climate moved since the previous wave, unrounded — the
 * CLIMA tile's "+0,29 frente a Q2" and the company row's "Frente a Q2". `null` without a
 * previous wave, or when the two share no dimension.
 */
export function companyDelta(model: SurveyResultsNextModel): number | null {
  const climate = model.climate
  if (!climate || model.previous.status !== 'loaded') return null
  return likeForLike(
    climate.dimensions.map((dimension) => dimension.key),
    climate.dimensions.map((dimension) => rawSurveyScore(model.questions, dimension)),
    model.previous.wave.dimensionScores,
  )
}

/** Each map column's change since the previous wave, unrounded; `null` where that wave has no reading. */
export function dimensionDeltas(model: SurveyResultsNextModel): (number | null)[] {
  const climate = model.climate
  if (!climate) return []
  const before = model.previous.status === 'loaded' ? model.previous.wave.dimensionScores : null
  return climate.dimensions.map((dimension) => {
    const now = rawSurveyScore(model.questions, dimension)
    const earlier = before === null ? undefined : (before[dimension.key] as number | undefined)
    return now === null || earlier === undefined ? null : now - earlier
  })
}

/** Column keys whose whole-survey reading sits under the target, worst first. */
export function belowTarget(model: SurveyResultsNextModel): { key: string; score: number }[] {
  const climate = model.climate
  if (!climate) return []
  const scores = companyScores(model)
  return climate.dimensions
    .map((dimension, index) => ({ key: dimension.key, score: scores[index] }))
    .filter((entry): entry is { key: string; score: number } => entry.score !== null && isBelowTarget(entry.score))
    .sort((a, b) => a.score - b.score)
}

/** How many groups the map discloses, and how many it has. */
export function legibleGroups(model: SurveyResultsNextModel): { legible: number; total: number } {
  const rows = groupRows(model)
  return { legible: rows.filter((row) => !row.isProtected).length, total: rows.length }
}

/**
 * The plan that covers a group: the action plan on that department with the earliest
 * due date, a cancelled one excepted — a cancelled plan attends nothing. `ActionPlan`
 * carries a `departmentId` but no dimension, so coverage is per group, and the copy
 * says so. `null` when there is none — and the caller must not call this with
 * `plans === null`, which means "the request failed", not "no plan".
 */
export function planFor(plans: readonly ActionPlan[], departmentId: string): ResultsPlanRef | null {
  const matching = plans
    .filter((plan) => plan.departmentId === departmentId && plan.status !== 'cancelled')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const first = matching[0]
  return first ? { id: first.id, name: first.title, dueAt: first.dueDate, status: first.status } : null
}

/** Why a cell is on the "where to look first" list — the one-line reason under its name. */
export type FindingReason =
  | 'lowest'
  | 'second-same-group'
  | 'third-same-group'
  | 'only-red-outside'
  | 'lowest-outside'
  | 'shortfall'

export interface ResultsFinding {
  rowId: string
  rowName: string
  dimensionKey: string
  score: number
  /** How far under the target, one decimal, always positive. */
  shortfall: number
  band: TargetBand
  reason: FindingReason
  /** The group the two "outside" reasons refer to — the lowest cell's group. */
  outsideOf: string | null
  /** `undefined` when plans could not be loaded; `null` when none covers the group. */
  plan: ResultsPlanRef | null | undefined
}

interface Candidate {
  rowId: string
  rowName: string
  dimensionKey: string
  score: number
  shortfall: number
  band: TargetBand
}

/**
 * The cells to look at first, worst first — withheld rows produce none.
 *
 * ## The breadth rule
 *
 * The first two slots are the two cells furthest under the target. The third is too —
 * unless all three would be the same group, in which case it goes to the lowest cell
 * *outside* that group, and its reason line says so. One group can be so far under
 * that its whole row fills the list, and a reader then learns nothing about the rest
 * of the organisation from the section whose job is to say where to look; the artboard
 * makes this substitution (Ventas · Carga de trabajo beside two Operaciones cells) and
 * names the reason. The subtitle still counts three cells; it does not claim they are
 * the three lowest.
 *
 * ## The reasons
 *
 * Derived, never typed: the lowest cell says how far under it is; a later cell in the
 * lowest cell's group says which rank it holds; a cell in another group is "the only
 * red cell outside …" when it is exactly that (red: `isRed`), otherwise the lowest
 * outside the group when the breadth rule put it there, otherwise its plain shortfall.
 */
export function whereToLookFirst(model: SurveyResultsNextModel, limit = 3): ResultsFinding[] {
  const climate = model.climate
  // `target === null` is `buildClimateMap`'s "nothing disclosed": no cell to rank.
  if (!climate || climate.target === null) return []

  const candidates: Candidate[] = []
  for (const row of groupRows(model)) {
    if (row.isProtected) continue
    climate.dimensions.forEach((dimension, index) => {
      const score = row.scores[index]
      if (score === null || score === undefined || !isBelowTarget(score)) return
      candidates.push({
        rowId: row.id,
        rowName: row.name,
        dimensionKey: dimension.key,
        score,
        shortfall: round1(CLIMATE_TARGET - score),
        band: targetBand(score),
      })
    })
  }
  candidates.sort(
    (left, right) =>
      right.shortfall - left.shortfall ||
      left.rowName.localeCompare(right.rowName) ||
      left.dimensionKey.localeCompare(right.dimensionKey),
  )

  const picked = candidates.slice(0, limit)
  const first = picked[0]
  if (!first) return []
  let substituted: Candidate | null = null
  if (limit >= 3 && picked.length === limit && picked.every((cell) => cell.rowId === first.rowId)) {
    const outside = candidates.find((cell) => cell.rowId !== first.rowId)
    if (outside) {
      picked[limit - 1] = outside
      substituted = outside
    }
  }

  const redOutside = candidates.filter((cell) => cell.rowId !== first.rowId && isRed(cell.band))
  return picked.map((cell, index) => {
    let reason: FindingReason = 'shortfall'
    let outsideOf: string | null = null
    if (index === 0) reason = 'lowest'
    else if (cell.rowId === first.rowId) reason = index === 1 ? 'second-same-group' : 'third-same-group'
    else if (redOutside.length === 1 && redOutside[0] === cell) {
      reason = 'only-red-outside'
      outsideOf = first.rowName
    } else if (cell === substituted) {
      reason = 'lowest-outside'
      outsideOf = first.rowName
    }
    return {
      ...cell,
      reason,
      outsideOf,
      plan: model.plans === null ? undefined : planFor(model.plans, cell.rowId),
    }
  })
}

export interface ResultsDistributionPoint {
  position: number
  percentage: number
}

/**
 * A scale question's answers as % per scale point, every point present.
 *
 * A scale point nobody chose produces no bucket on the wire, so the missing points
 * are filled with 0 here — a true zero for a disclosed question — bounded by the
 * question's own `scaleMin`/`scaleMax`, which is why those travel on the payload.
 */
export function distributionPoints(question: SurveyQuestionResult): ResultsDistributionPoint[] {
  const min = question.scaleMin ?? 1
  const max = question.scaleMax ?? 5
  const byPosition = new Map<number, SurveyDistributionBucket>()
  for (const bucket of question.distribution) {
    const position = Number.parseFloat(bucket.value)
    if (Number.isFinite(position)) byPosition.set(position, bucket)
  }
  const points: ResultsDistributionPoint[] = []
  for (let position = min; position <= max; position += 1) {
    points.push({ position, percentage: byPosition.get(position)?.percentage ?? 0 })
  }
  return points
}

/** The share of answers on the two lowest points, rounded to a whole percent. */
export function lowShare(points: readonly ResultsDistributionPoint[]): number {
  return Math.round(points.filter((point) => point.position <= 2).reduce((sum, point) => sum + point.percentage, 0))
}

export interface ResultsCellQuestion {
  questionId: string
  text: string | null
  groupScore: number | null
  groupAnswered: number
  surveyScore: number
  surveyAnswered: number
  surveyDistribution: ResultsDistributionPoint[]
  scaleMin: number
  scaleMax: number
  scaleLabelMin: string | null
  scaleLabelMax: string | null
}

export interface ResultsCellOther {
  id: string
  name: string
  isProtected: boolean
  /** `null` for a protected row — never 0. */
  score: number | null
  band: TargetBand | null
}

export interface ResultsCellDetail {
  rowId: string
  rowName: string
  dimensionKey: string
  score: number | null
  band: TargetBand | null
  /** How far under (positive) or over (negative) the target the cell sits; `null` without a score. */
  shortfall: number | null
  /** Whether this is the lowest disclosed cell on the map. */
  isLowest: boolean
  /** How many scale questions make up this dimension. */
  questionCount: number
  /** Whether every dimension the map draws is a single question. */
  oneQuestionPerDimension: boolean
  questions: ResultsCellQuestion[]
  /** Every other row's score on this dimension — protected rows carry `null`. */
  others: ResultsCellOther[]
  plan: ResultsPlanRef | null | undefined
}

/**
 * What one opened cell has to say. `null` for anything `climateDetail` declines —
 * a withheld row, a stale selection — so the view renders nothing rather than an
 * empty shell that would still be a statement about the group.
 *
 * Pinned against the demo tenant's real `GET /surveys/{id}/analytics` payload in
 * `derive.test.ts` (`survey-results-meridiano.json`): the lowest cell's selection
 * opens, with its question, the other groups and the plan.
 */
export function cellDetail(model: SurveyResultsNextModel, selection: ClimateMapSelection): ResultsCellDetail | null {
  const { climate, breakdown } = model
  if (!climate || !breakdown || selection.dimensionKey === null) return null
  const detail = climateDetail(climate, breakdown, model.questions, selection)
  const dimension = detail?.dimensions[0]
  if (!detail || !dimension) return null
  const dimensionKey = selection.dimensionKey
  const columnIndex = climate.dimensions.findIndex((entry) => entry.key === dimensionKey)
  const kept = climate.dimensions[columnIndex]
  const byId = new Map(model.questions.map((question) => [question.questionId, question]))
  const rows = groupRows(model)
  const disclosedScores = rows
    .filter((row) => !row.isProtected)
    .flatMap((row) => row.scores.filter((score): score is number => score !== null))
  const lowest = disclosedScores.length === 0 ? null : Math.min(...disclosedScores)
  return {
    rowId: detail.rowId,
    rowName: detail.rowLabel,
    dimensionKey,
    score: dimension.score,
    band: dimension.score === null ? null : targetBand(dimension.score),
    shortfall: dimension.score === null ? null : round1(CLIMATE_TARGET - dimension.score),
    isLowest: dimension.score !== null && lowest !== null && dimension.score === lowest,
    questionCount: kept?.questionIds.length ?? dimension.questions.length,
    oneQuestionPerDimension: climate.dimensions.every((entry) => entry.questionIds.length === 1),
    questions: dimension.questions.map((entry) => {
      const question = byId.get(entry.questionId)
      return {
        questionId: entry.questionId,
        text: question?.text ?? null,
        groupScore: entry.score,
        groupAnswered: entry.answeredCount,
        surveyScore: entry.surveyScore,
        surveyAnswered: question?.answeredCount ?? 0,
        surveyDistribution: question ? distributionPoints(question) : [],
        scaleMin: question?.scaleMin ?? 1,
        scaleMax: question?.scaleMax ?? 5,
        scaleLabelMin: question?.scaleLabelMin ?? null,
        scaleLabelMax: question?.scaleLabelMax ?? null,
      }
    }),
    others: rows
      .filter((row) => row.id !== detail.rowId)
      .map((row) => {
        const score = row.isProtected ? null : (row.scores[columnIndex] ?? null)
        return {
          id: row.id,
          name: row.name,
          isProtected: row.isProtected,
          score,
          band: score === null ? null : targetBand(score),
        }
      }),
    plan: model.plans === null ? undefined : planFor(model.plans, detail.rowId),
  }
}

/**
 * Whether the survey asked anything open-ended — the gate on the themes section.
 *
 * The gate is the question type, not the words being non-empty: a survey with no
 * open-text question gets no section (drawing one that would always be empty is
 * designing fiction), while a survey whose every word fell under the word floor
 * keeps its section and says the words are withheld. Withheld is not absent.
 */
export function hasOpenText(model: SurveyResultsNextModel): boolean {
  return model.questions.some(isOpenEnded)
}

/**
 * Every open-text word the survey returned, merged across its open-ended questions
 * and kept apart per language — `openTextThemes`, the current page's own function,
 * so the cloud here and the one it replaced cannot disagree. Verbatim response text
 * is never on the wire, so nothing here can leak one.
 */
export function openTextWords(model: SurveyResultsNextModel): WordFrequency[] {
  return openTextThemes(model.questions)
}

/** Distinct words the server withheld for appearing in too few answers, over every question. */
export function withheldWords(model: SurveyResultsNextModel): number {
  return withheldWordCount(model.questions)
}
