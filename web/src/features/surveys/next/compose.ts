import type { ActionPlan } from '../../action-plans/api/actionPlans'
import { waveCode } from '../../dashboard/next/compose'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'
import { buildClimateMap } from '../surveyResultsMap'
import type { SurveyResultsNextModel } from './model'
import { sampleWave } from './sampleModel'

/**
 * The results model, from the three payloads the hook fetches — pure, so the tests can
 * build exactly what the page builds from the tenant's real payloads
 * (`scripts/shot-fixtures/survey-results-meridiano.json`) without a second copy of it.
 *
 * The map is `buildClimateMap` over the department breakdown, as the previous page
 * built it, so withheld rows arrive hatched and never as a number. `plans: null` means
 * the plans request failed — not "no plans"; `closesAt: null` means the survey request
 * failed and the header falls back to the last response's day.
 */
export function composeResultsModel(
  payload: SurveyAnalyticsResponse,
  plans: readonly ActionPlan[] | null,
  closesAt: string | null,
): SurveyResultsNextModel {
  const breakdown =
    payload.breakdowns.find((candidate) => candidate.dimension === 'department') ?? payload.breakdowns[0] ?? null
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
    sample: sampleWave,
  }
}
