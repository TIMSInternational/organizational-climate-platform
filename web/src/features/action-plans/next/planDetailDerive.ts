import { ANONYMITY_FLOOR, isSuppressed } from '../../../components/charts'
import { WHOLE_COMPANY_KEY, type ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import { daysBetween } from '../../dashboard/next/derive'
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
 * What the plan recorded about itself when it was raised: the wave and the cell.
 *
 * Both are written by `ResultsCellPanel` on every plan raised from a cell — the survey as
 * `sourceSurveyId`, the dimension as a `dimension:<key>` tag — and both have been returned
 * by the read endpoints since #532. A plan created by hand has neither.
 */
export interface PlanProvenance {
  sourceSurveyId: string | null
  dimensionKey: string | null
}

/**
 * The finding a plan answers.
 *
 * ## It is READ from the plan, and only inferred when the plan does not say
 *
 * This used to be inferred always: the lowest dimension of the plan's row in the LATEST
 * closed wave, with a "Propuesta" chip beside it to keep that honest. The chip's own words
 * were "the plan does not store its finding", and since #532 that is false — it stores the
 * wave and the dimension, and the detail endpoint returns both.
 *
 * Inferring it was not merely stale, it printed the wrong cell. Measured on production,
 * 2026-10-10, on the demo tenant: a plan titled "… — Carga de trabajo", whose description
 * says "Seguimiento de Carga de trabajo … Puntaje 2,6", showed "Reconocimiento 2,6" as its
 * origin — because `lowestOf` returns the row's lowest and Ventanilla Única tied at 2,6
 * across two dimensions. One card, two different answers to "about what".
 *
 * So provenance wins where it exists. `proposed` is true only where the screen had to fall
 * back to the map, which is a plan raised by hand, and that is the only case that still
 * wears the chip.
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
      /** The plan's cell is also the lowest disclosed cell of the whole map for that wave. */
      lowestOfMap: boolean
      /** The screen chose this cell from the map because the plan recorded none. */
      proposed: boolean
    }
  | { status: 'protected'; surveyId: string; surveyTitle: string; code: string; proposed: boolean }
  | { status: 'none' }

export function planFinding(
  trends: ClimateTrendsResponse,
  latestClosedId: string | null,
  departmentId: string | null,
  provenance: PlanProvenance = { sourceSurveyId: null, dimensionKey: null },
  floor: number = ANONYMITY_FLOOR,
): PlanFinding {
  // The plan's own wave first. `latestClosedId` is the fallback for a plan that records
  // none, and a `sourceSurveyId` outside this window (an archived wave the trends call no
  // longer returns) falls back the same way rather than yielding nothing.
  const recorded = provenance.sourceSurveyId
    ? trends.surveys.find((candidate) => candidate.surveyId === provenance.sourceSurveyId)
    : undefined
  const survey =
    recorded ??
    (latestClosedId ? trends.surveys.find((candidate) => candidate.surveyId === latestClosedId) : undefined) ??
    [...trends.surveys].reverse().find((candidate) => candidate.status === 'closed')
  if (!survey) return { status: 'none' }

  const groupKey = departmentId ?? WHOLE_COMPANY_KEY
  const group =
    trends.groups.find((candidate) => candidate.key === groupKey) ??
    (departmentId === null ? trends.groups[0] : undefined)
  const point = group?.points.find((candidate) => candidate.surveyId === survey.surveyId)
  const surveyTitle = survey.title?.trim() || survey.surveyId
  const code = waveCode(survey.title, survey.surveyId.slice(0, 8))

  // The plan's own dimension, if it recorded one this wave actually asked about. A tag
  // naming a dimension the instrument dropped is not an error to hide behind a wrong
  // number — the screen falls back and says it proposed.
  const tagged =
    provenance.dimensionKey !== null && trends.dimensions.some((entry) => entry.key === provenance.dimensionKey)
      ? provenance.dimensionKey
      : null
  const proposed = recorded === undefined || tagged === null

  if (!point) return { status: 'none' }
  if (point.isSuppressed || isSuppressed(point.respondentCount, floor)) {
    return { status: 'protected', surveyId: survey.surveyId, surveyTitle, code, proposed }
  }

  const cell = tagged === null ? lowestOf(point.scores, trends) : scoreOf(point.scores, trends, tagged)
  if (!cell) return { status: 'none' }

  // The lowest disclosed cell across every row of the map at this wave.
  let mapLowest = Number.POSITIVE_INFINITY
  for (const candidate of trends.groups) {
    const entry = candidate.points.find((item) => item.surveyId === survey.surveyId)
    if (!entry || entry.isSuppressed || isSuppressed(entry.respondentCount, floor)) continue
    const found = lowestOf(entry.scores, trends)
    if (found && found.score < mapLowest) mapLowest = found.score
  }

  return {
    status: 'shown',
    surveyId: survey.surveyId,
    surveyTitle,
    code,
    dimensionKey: cell.key,
    score: cell.score,
    lowestOfMap: departmentId !== null && cell.score <= mapLowest,
    proposed,
  }
}

/**
 * Did the plan move the number?
 *
 * The plan knows the cell it was raised from; the waves that closed after it know what that
 * same cell reads now. Nothing joined them, and the join needs no new endpoint: a
 * department-grouped `climate-trends` is every wave x group x dimension already, with the
 * floor applied on the server.
 *
 * ## What counts as "after"
 *
 * `trends.surveys` is the closed-and-archived window, oldest first by the date each survey
 * CLOSED, so "after" is simply further along that list. The reading taken is the LATEST one
 * that discloses the cell, not the next one: a plan raised in Q1 should be measured against
 * the newest number there is, and a wave in between that withheld the group must not hide
 * the one that did not.
 *
 * ## What it refuses to say
 *
 * Every number here comes out of the already-floored payload, so a withheld group has no
 * score to find and `moved` cannot be reached for one. The three not-a-number cases are
 * kept apart on purpose, because "nothing has closed since" and "the group is too small to
 * say" are different sentences and only one of them is about privacy.
 */
export type PlanMove =
  | { status: 'moved'; fromCode: string; from: number; toCode: string; to: number; surveyId: string }
  /** Waves closed after this plan's, but none of them discloses the cell. */
  | { status: 'protected'; code: string }
  /** Nothing has closed since the plan was raised. */
  | { status: 'awaiting'; code: string }
  /** No baseline to measure from — the plan records no cell, or the map has none. */
  | { status: 'none' }

export function planMove(
  trends: ClimateTrendsResponse,
  finding: PlanFinding,
  departmentId: string | null,
  floor: number = ANONYMITY_FLOOR,
): PlanMove {
  // A proposed finding is the map's reading of today, not a baseline the plan committed
  // to, so differencing it against today would compare a number with itself.
  if (finding.status !== 'shown' || finding.proposed) return { status: 'none' }

  const fromIndex = trends.surveys.findIndex((candidate) => candidate.surveyId === finding.surveyId)
  if (fromIndex < 0) return { status: 'none' }
  const later = trends.surveys.slice(fromIndex + 1)
  if (later.length === 0) return { status: 'awaiting', code: finding.code }

  const groupKey = departmentId ?? WHOLE_COMPANY_KEY
  const group =
    trends.groups.find((candidate) => candidate.key === groupKey) ??
    (departmentId === null ? trends.groups[0] : undefined)
  if (!group) return { status: 'none' }

  for (const survey of [...later].reverse()) {
    const point = group.points.find((candidate) => candidate.surveyId === survey.surveyId)
    if (!point || point.isSuppressed || isSuppressed(point.respondentCount, floor)) continue
    const cell = scoreOf(point.scores, trends, finding.dimensionKey)
    if (!cell) continue
    return {
      status: 'moved',
      fromCode: finding.code,
      from: finding.score,
      toCode: waveCode(survey.title, survey.surveyId.slice(0, 8)),
      to: cell.score,
      surveyId: survey.surveyId,
    }
  }
  return { status: 'protected', code: finding.code }
}

/** One named dimension's score on a row, or null where the wave has no number for it. */
function scoreOf(
  scores: readonly (number | null)[],
  trends: ClimateTrendsResponse,
  key: string,
): { key: string; score: number } | null {
  const index = trends.dimensions.findIndex((entry) => entry.key === key)
  if (index < 0) return null
  const score = scores[index]
  return typeof score === 'number' ? { key, score } : null
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
