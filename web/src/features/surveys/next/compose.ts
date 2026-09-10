import type { ActionPlan } from '../../action-plans/api/actionPlans'
import { isSuppressed } from '../../../components/charts/suppression'
import { waveCode } from '../../dashboard/next/compose'
import { WHOLE_COMPANY_KEY, type ClimateTrendSurvey, type ClimateTrendsResponse } from '../api/climateTrends'
import type { SurveyAnalyticsResponse, SurveyBreakdown } from '../api/surveyResults'
import { buildClimateMap, dimensionKeyOf } from '../surveyResultsMap'
import type { ResultsPrevious, SurveyResultsNextModel } from './model'
import { sampleWave } from './sampleModel'

/**
 * What the hook fetched about the previous wave, before it is reduced: the trends window
 * that named it, the wave itself, and its own analytics — or why there is nothing.
 * `none` is a first wave (nothing closed before it); `failed` is a request that failed,
 * which the page says rather than printing a comparison it could not make.
 */
export type PreviousPayloads =
  | {
      status: 'loaded'
      trends: ClimateTrendsResponse
      survey: ClimateTrendSurvey
      analytics: SurveyAnalyticsResponse
    }
  | { status: 'none' }
  | { status: 'failed' }

/** The breakdown a map is drawn from: the department one, or the first when none is. */
function departmentBreakdown(payload: SurveyAnalyticsResponse): SurveyBreakdown | null {
  return payload.breakdowns.find((candidate) => candidate.dimension === 'department') ?? payload.breakdowns[0] ?? null
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * The waves a comparison can be made against, oldest first, as indexes into
 * `trends.surveys` (which every group's `points` is aligned to): closed and disclosed —
 * the Panel de Control's own rule (`dashboard/next/compose.ts` `composeDimensions`), so
 * the two screens name the same previous wave and count the same rises.
 */
function comparableWaves(trends: ClimateTrendsResponse): number[] {
  return trends.surveys
    .map((survey, index) => ({ survey, index }))
    .filter(({ survey }) => survey.status === 'closed' && !survey.isSuppressed)
    .sort((left, right) => Date.parse(left.survey.endDate) - Date.parse(right.survey.endDate))
    .map(({ index }) => index)
}

/**
 * The survey this one is compared against: the comparable wave just before it in the
 * trends window. When this survey is not in the window (still open, or withheld as a
 * whole), the latest comparable wave that closed before it. `null` for a first wave —
 * never a guess.
 */
export function previousSurveyOf(
  trends: ClimateTrendsResponse,
  surveyId: string,
  closesAt: string | null,
): ClimateTrendSurvey | null {
  const waves = comparableWaves(trends)
  const at = waves.findIndex((index) => trends.surveys[index].surveyId === surveyId)
  if (at >= 0) return at > 0 ? trends.surveys[waves[at - 1]] : null
  if (closesAt === null) return null
  const closes = Date.parse(closesAt)
  const earlier = waves.filter((index) => Date.parse(trends.surveys[index].endDate) < closes)
  const last = earlier[earlier.length - 1]
  return last === undefined ? null : trends.surveys[last]
}

/**
 * Consecutive wave-over-wave rises of the whole company's climate, ending at this
 * survey — the Panel de Control's `risesInARow` (`dashboard/next/derive.ts`), over the
 * same series: the trends window's whole-company group, one average per comparable wave.
 * 0 when this survey is not in the window: a count of rises it cannot see is not made.
 */
export function risesInARow(trends: ClimateTrendsResponse, surveyId: string): number {
  const group = trends.groups.find((candidate) => candidate.key === WHOLE_COMPANY_KEY) ?? trends.groups[0]
  if (group === undefined) return 0
  const waves = comparableWaves(trends)
  const end = waves.findIndex((index) => trends.surveys[index].surveyId === surveyId)
  const average = (index: number) =>
    mean((group.points[index]?.scores ?? []).filter((score): score is number => typeof score === 'number'))
  let rises = 0
  for (let at = end; at >= 1; at -= 1) {
    const current = average(waves[at])
    const earlier = average(waves[at - 1])
    if (current === null || earlier === null || current <= earlier) break
    rises += 1
  }
  return rises
}

/** The unrounded mean of the scale questions' means, per dimension key. */
function dimensionMeans(payload: SurveyAnalyticsResponse): Record<string, number> {
  const byKey = new Map<string, number[]>()
  for (const question of payload.questions) {
    if (question.average === null) continue
    const key = dimensionKeyOf(question)
    byKey.set(key, [...(byKey.get(key) ?? []), question.average])
  }
  return Object.fromEntries([...byKey].map(([key, values]) => [key, mean(values) as number]))
}

/**
 * Per DISCLOSED group of the previous wave's department breakdown, the unrounded mean of
 * its question means per dimension key. A group the server withheld (`isSuppressed`,
 * `respondentCount` 0) or that sits under the floor gets NO entry — never a zero —
 * so the grid says "sin Q2" for it and no arithmetic ever sees it.
 */
function groupDimensionMeans(payload: SurveyAnalyticsResponse): Record<string, Record<string, number>> {
  const breakdown = departmentBreakdown(payload)
  if (breakdown === null) return {}
  const keyOf = new Map(
    payload.questions
      .filter((question) => question.average !== null)
      .map((question) => [question.questionId, dimensionKeyOf(question)]),
  )
  const floor = Math.max(1, payload.minimumGroupSize)
  const groups: Record<string, Record<string, number>> = {}
  for (const segment of breakdown.segments) {
    if (segment.isSuppressed || isSuppressed(segment.respondentCount, floor)) continue
    const byKey = new Map<string, number[]>()
    for (const entry of segment.questions) {
      const key = keyOf.get(entry.questionId)
      if (key === undefined || entry.average === null) continue
      byKey.set(key, [...(byKey.get(key) ?? []), entry.average])
    }
    if (byKey.size === 0) continue
    groups[segment.key] = Object.fromEntries([...byKey].map(([key, values]) => [key, mean(values) as number]))
  }
  return groups
}

/**
 * The previous wave as the page compares against it — every figure measured, from the
 * previous survey's own analytics by the same rules this survey's figures are read by
 * (`derive.ts`), so a "+0,3" is the difference of two readings taken the same way.
 * A previous wave withheld as a whole carries no reading at all.
 */
export function composePrevious(input: PreviousPayloads, surveyId: string): ResultsPrevious {
  if (input.status !== 'loaded') return input
  const { trends, survey, analytics } = input
  const withheld = analytics.isSuppressed
  return {
    status: 'loaded',
    wave: {
      surveyId: survey.surveyId,
      code: waveCode(analytics.title ?? survey.title, survey.surveyId.slice(0, 8)),
      dimensionScores: withheld ? {} : dimensionMeans(analytics),
      groupScores: withheld ? {} : groupDimensionMeans(analytics),
      hasGroupBreakdown: departmentBreakdown(analytics) !== null,
      risesInARow: risesInARow(trends, surveyId),
    },
  }
}

/**
 * The results model, from the payloads the hook fetches — pure, so the tests can build
 * exactly what the page builds from the tenant's real payloads
 * (`scripts/shot-fixtures/survey-results-meridiano.json`) without a second copy of it.
 *
 * The map is `buildClimateMap` over the department breakdown, as the previous page
 * built it, so withheld rows arrive hatched and never as a number. `plans: null` means
 * the plans request failed — not "no plans"; `closesAt: null` means the survey request
 * failed and the header falls back to the last response's day; `previous` says whether
 * there is a wave to compare with, and when there is not, why.
 */
export function composeResultsModel(
  payload: SurveyAnalyticsResponse,
  plans: readonly ActionPlan[] | null,
  closesAt: string | null,
  previous: PreviousPayloads,
): SurveyResultsNextModel {
  const breakdown = departmentBreakdown(payload)
  const climate = breakdown
    ? buildClimateMap(breakdown, payload.questions, payload.minimumGroupSize, (segment) => segment.label ?? segment.key)
    : null
  return {
    surveyId: payload.surveyId,
    name: payload.title,
    // "Q3" out of "Encuesta de Clima Q3"; a survey named without a wave code is
    // discussed by the first part of its id rather than by nothing.
    code: waveCode(payload.title, payload.surveyId.slice(0, 8)),
    status: payload.status,
    closesAt,
    language: payload.language,
    resolvedLocale: payload.resolvedLocale,
    fallbackFields: payload.fallbackFields,
    summary: payload.summary,
    isSuppressed: payload.isSuppressed,
    minimumGroupSize: payload.minimumGroupSize,
    questions: payload.questions,
    breakdown,
    breakdowns: payload.breakdowns,
    climate,
    plans,
    previous: composePrevious(previous, payload.surveyId),
    sample: sampleWave,
  }
}
