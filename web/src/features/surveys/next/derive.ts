import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { SurveyDistributionBucket, SurveyQuestionResult } from '../api/surveyResults'
import type { ClimateMapSelection, WordFrequency } from '../../../components/charts'
import {
  climateDetail,
  climateFindings,
  openTextThemes,
  surveyDimensionScore,
  withheldWordCount,
} from '../surveyResultsMap'
import { isOpenEnded } from '../surveyResultsView'
import type { ResultsGroupRow, ResultsPlanRef, SurveyResultsNextModel } from './model'

/**
 * Every number the redesigned results page prints, derived from the model.
 *
 * Nothing here aggregates a second time: the map rows, the findings and the opened
 * cell all come from `surveyResultsMap.ts`, the same functions the current page uses,
 * so the two pages cannot disagree about a score or about which rows are withheld.
 * The one arithmetic this file adds — a group's mean across its dimensions — is over
 * scores the map already disclosed, and a withheld row never reaches it.
 */

/** One decimal, the precision `surveyResultsMap.ts` rounds every mean to. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * The map's rows with a per-group mean, protected rows first-class.
 *
 * A protected row arrives from `buildClimateMap` with no scores; it is rendered
 * hatched by `ClimateMap` and must read the same way in every other panel, so it
 * carries `null` scores and a `null` mean here — never 0, which would be a claim.
 */
export function groupRows(model: SurveyResultsNextModel): ResultsGroupRow[] {
  const climate = model.climate
  if (!climate) return []
  return climate.rows.map((row) => {
    const isProtected = climate.target === null || row.responses < climate.threshold
    const scores = climate.dimensions.map((_, index) =>
      isProtected ? null : (row.scores[index] ?? null),
    )
    const disclosed = scores.filter((score): score is number => score !== null)
    return {
      id: row.id,
      name: row.label,
      responses: row.responses,
      isProtected,
      scores,
      mean: disclosed.length === 0 ? null : round1(disclosed.reduce((a, b) => a + b, 0) / disclosed.length),
    }
  })
}

/** The whole survey's mean per map column, in column order. */
export function companyScores(model: SurveyResultsNextModel): (number | null)[] {
  if (!model.climate) return []
  return model.climate.dimensions.map((dimension) => surveyDimensionScore(model.questions, dimension))
}

/** Column keys whose whole-survey mean sits under the map's reference, worst first. */
export function belowReference(model: SurveyResultsNextModel): { key: string; score: number }[] {
  const climate = model.climate
  if (!climate || climate.target === null) return []
  const reference = climate.target
  const scores = companyScores(model)
  return climate.dimensions
    .map((dimension, index) => ({ key: dimension.key, score: scores[index] }))
    .filter((entry): entry is { key: string; score: number } => entry.score !== null && entry.score < reference)
    .sort((a, b) => a.score - b.score)
}

/** How many groups the map discloses, and how many it has. */
export function legibleGroups(model: SurveyResultsNextModel): { legible: number; total: number } {
  const rows = groupRows(model)
  return { legible: rows.filter((row) => !row.isProtected).length, total: rows.length }
}

/**
 * The plan that covers a group: the action plan on that department with the earliest
 * due date. `ActionPlan` carries a `departmentId` but no dimension, so coverage is per
 * group, and the copy says so. `null` when there is none — and the caller must not
 * call this with `plans === null`, which means "the request failed", not "no plan".
 */
export function planFor(plans: readonly ActionPlan[], departmentId: string): ResultsPlanRef | null {
  const matching = plans
    .filter((plan) => plan.departmentId === departmentId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const first = matching[0]
  return first ? { id: first.id, name: first.title, dueAt: first.dueDate, status: first.status } : null
}

export interface ResultsFinding {
  rowId: string
  rowName: string
  dimensionKey: string
  score: number
  shortfall: number
  /** `undefined` when plans could not be loaded; `null` when none covers the group. */
  plan: ResultsPlanRef | null | undefined
}

/** The three cells furthest under the reference, worst first — withheld rows produce none. */
export function whereToLookFirst(model: SurveyResultsNextModel, limit = 3): ResultsFinding[] {
  if (!model.climate) return []
  return climateFindings(model.climate, limit).map((finding) => ({
    rowId: finding.rowId,
    rowName: finding.rowLabel,
    dimensionKey: finding.dimensionKey,
    score: finding.score,
    shortfall: finding.shortfall,
    plan: model.plans === null ? undefined : planFor(model.plans, finding.rowId),
  }))
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
  scaleLabelMin: string | null
  scaleLabelMax: string | null
}

export interface ResultsCellDetail {
  rowId: string
  rowName: string
  dimensionKey: string
  score: number | null
  questions: ResultsCellQuestion[]
  /** Every other row's score on this dimension — protected rows carry `null`. */
  others: { id: string; name: string; isProtected: boolean; score: number | null }[]
  plan: ResultsPlanRef | null | undefined
}

/**
 * What one opened cell has to say. `null` for anything `climateDetail` declines —
 * a withheld row, a stale selection — so the view renders nothing rather than an
 * empty shell that would still be a statement about the group.
 */
export function cellDetail(model: SurveyResultsNextModel, selection: ClimateMapSelection): ResultsCellDetail | null {
  const { climate, breakdown } = model
  if (!climate || !breakdown || selection.dimensionKey === null) return null
  const detail = climateDetail(climate, breakdown, model.questions, selection)
  const dimension = detail?.dimensions[0]
  if (!detail || !dimension) return null
  const dimensionKey = selection.dimensionKey
  const columnIndex = climate.dimensions.findIndex((entry) => entry.key === dimensionKey)
  const byId = new Map(model.questions.map((question) => [question.questionId, question]))
  return {
    rowId: detail.rowId,
    rowName: detail.rowLabel,
    dimensionKey,
    score: dimension.score,
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
        scaleLabelMin: question?.scaleLabelMin ?? null,
        scaleLabelMax: question?.scaleLabelMax ?? null,
      }
    }),
    others: groupRows(model)
      .filter((row) => row.id !== detail.rowId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        isProtected: row.isProtected,
        score: row.isProtected ? null : (row.scores[columnIndex] ?? null),
      })),
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
