import { ANONYMITY_FLOOR, isSuppressed } from '../../../components/charts'
import { WHOLE_COMPANY_KEY, type ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import { daysBetween, isBelowTarget } from '../../dashboard/next/derive'
import { waveCode } from '../../dashboard/next/compose'

/**
 * The pure readings behind the redesigned action plan (`/action-plans/:id`), asserted in
 * `derive.test.ts`.
 */

/** A plan's due date as the calendar day the list prints it on — read in UTC (`actionPlans.ts`). */
export function dueDay(dueIso: string): string {
  return new Date(dueIso).toISOString().slice(0, 10)
}

/** Whole days from `asOf` to the due day; negative once it has passed. */
export function daysToDue(asOf: string, dueIso: string): number {
  return daysBetween(asOf, dueDay(dueIso))
}

/**
 * How much of the plan's time has run, 0–1: from the day it was created to its due day,
 * with today somewhere between. A plan created today sits at 0 — the board's "10 sept ·
 * hoy" at the left end — and a plan past due at 1.
 */
export function elapsedShare(createdIso: string | null, asOf: string, dueIso: string): number {
  if (!createdIso) return 0
  const total = daysBetween(dueDay(createdIso), dueDay(dueIso))
  if (total <= 0) return 1
  const gone = daysBetween(dueDay(createdIso), asOf)
  return Math.max(0, Math.min(1, gone / total))
}

/**
 * The finding a plan answers, as the screen can read it: the lowest dimension of the plan's
 * own row — its department, or the whole company for a plan with none — in the latest
 * closed wave of the climate map.
 *
 * ## Why this is inferred and the board marks it "Propuesta"
 *
 * `ActionPlanDetail` stores no link to a finding: a department, a title, a description, and
 * nothing else. So the screen reads the one thing it can — the map — and says which cell of
 * the plan's row is the lowest. The chip beside the heading keeps that honest: the screen
 * proposes the finding, nobody recorded it.
 *
 * ## The floor
 *
 * A row the server withheld (`isSuppressed`), or one under `floor` respondents, yields
 * `protected` and no number at all — never the lowest of an empty row, never a zero.
 */
export type PlanFinding =
  | {
      status: 'shown'
      surveyId: string
      surveyTitle: string
      code: string
      dimensionKey: string
      score: number
      belowTarget: boolean
      /** The plan's cell is also the lowest disclosed cell of the whole map for that wave. */
      lowestOfMap: boolean
    }
  | { status: 'protected'; surveyId: string; surveyTitle: string; code: string }
  | { status: 'none' }

export function planFinding(
  trends: ClimateTrendsResponse,
  surveyId: string | null,
  departmentId: string | null,
  target: number,
  floor: number = ANONYMITY_FLOOR,
): PlanFinding {
  const survey =
    (surveyId ? trends.surveys.find((candidate) => candidate.surveyId === surveyId) : undefined) ??
    [...trends.surveys].reverse().find((candidate) => candidate.status === 'closed')
  if (!survey) return { status: 'none' }

  const groupKey = departmentId ?? WHOLE_COMPANY_KEY
  const group =
    trends.groups.find((candidate) => candidate.key === groupKey) ??
    (departmentId === null ? trends.groups[0] : undefined)
  const point = group?.points.find((candidate) => candidate.surveyId === survey.surveyId)
  const surveyTitle = survey.title?.trim() || survey.surveyId
  const code = waveCode(survey.title, survey.surveyId.slice(0, 8))
  if (!point) return { status: 'none' }
  if (point.isSuppressed || isSuppressed(point.respondentCount, floor)) {
    return { status: 'protected', surveyId: survey.surveyId, surveyTitle, code }
  }

  const lowest = lowestOf(point.scores, trends)
  if (!lowest) return { status: 'none' }

  // The lowest disclosed cell across every row of the map at this wave.
  let mapLowest = Number.POSITIVE_INFINITY
  for (const candidate of trends.groups) {
    const cell = candidate.points.find((entry) => entry.surveyId === survey.surveyId)
    if (!cell || cell.isSuppressed || isSuppressed(cell.respondentCount, floor)) continue
    const found = lowestOf(cell.scores, trends)
    if (found && found.score < mapLowest) mapLowest = found.score
  }

  return {
    status: 'shown',
    surveyId: survey.surveyId,
    surveyTitle,
    code,
    dimensionKey: lowest.key,
    score: lowest.score,
    belowTarget: isBelowTarget(lowest.score, target),
    lowestOfMap: departmentId !== null && lowest.score <= mapLowest,
  }
}

function lowestOf(scores: readonly (number | null)[], trends: ClimateTrendsResponse): { key: string; score: number } | null {
  let lowest: { key: string; score: number } | null = null
  scores.forEach((score, index) => {
    const key = trends.dimensions[index]?.key
    if (typeof score !== 'number' || key === undefined) return
    if (lowest === null || score < lowest.score) lowest = { key, score }
  })
  return lowest
}
