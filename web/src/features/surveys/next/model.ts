import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { SurveyBreakdown, SurveyQuestionResult, SurveyResultsSummary } from '../api/surveyResults'
import type { ClimateMapModel } from '../surveyResultsMap'

/**
 * The typed model behind the redesigned survey results (`/surveys/:id/results`).
 *
 * Same conventions as `features/dashboard/next/model.ts`: the page reads this through
 * `useSurveyResultsModel()`, which is the ONE place the API is called; every number the
 * view prints is derived in `derive.ts` from the payload fields kept here, never typed.
 * Human-readable payload content is `name`, not `title`/`label`, because
 * `noHardcodedStrings.test.ts` reads those two property names as UI copy.
 *
 * ## What is a measurement and what is a sample
 *
 * Everything below `sample` comes off `GET /surveys/{id}/analytics` and `GET /action-plans`
 * — the map, the protected rows, the per-question means and the whole-survey 1–5
 * distributions. `sample` carries the two things no endpoint returns today (see
 * `sampleModel.ts` for which endpoints will), and the view marks every region it feeds
 * with the "sample data" chip.
 */

/** One column of the map: a dimension the survey measured. */
export interface ResultsDimension {
  key: string
  /** The question ids that make up the dimension, in the author's order. */
  questionIds: readonly string[]
}

/**
 * One group's row. `mean` is the mean of the group's disclosed dimension scores and
 * is `null` — never 0 — for a protected row, which carries no scores at all
 * (`buildClimateMap` strips them, the server emptied them first).
 */
export interface ResultsGroupRow {
  id: string
  name: string
  responses: number
  isProtected: boolean
  scores: readonly (number | null)[]
  mean: number | null
}

/** The plan that covers a group, when `GET /action-plans` lists one for its department. */
export interface ResultsPlanRef {
  id: string
  name: string
  /** ISO date. */
  dueAt: string
  status: string
}

/**
 * Wave-over-wave and per-group distribution data no endpoint provides today.
 * `isSample` is always true while this shape is fed from `sampleModel.ts`.
 */
export interface ResultsSampleWave {
  isSample: boolean
  /** The code of the wave the deltas are against: "Q2". */
  previousCode: string
  /** Change of the whole-company mean since the previous wave. */
  averageDelta: number
  /** Change per dimension key since the previous wave; a key not listed has no reading. */
  dimensionDeltas: Readonly<Record<string, number>>
  /** How many waves in a row the average has risen, counting this one. */
  risesInARow: number
  /** The opened group's answers to the opened question, as % per scale point, 1..5. */
  groupDistribution: readonly { position: number; percentage: number }[]
}

export interface SurveyResultsNextModel {
  surveyId: string
  /** The survey's own name, off the wire; `null` when it has none. */
  name: string | null
  /** The wave the survey is discussed as — "Q3" out of "Encuesta de Clima Q3" (`waveCode`). */
  code: string
  status: string
  /**
   * When the survey closed (or closes): `endDate` off `GET /surveys/{id}`, which the
   * analytics envelope does not carry. `null` when that request failed — the header
   * then falls back to the last response's day rather than inventing a closing one.
   */
  closesAt: string | null
  summary: SurveyResultsSummary
  /** The whole survey is under `minimumGroupSize`: no map, no findings, counters only. */
  isSuppressed: boolean
  minimumGroupSize: number
  questions: readonly SurveyQuestionResult[]
  /** The department breakdown the map is drawn from; `null` when the payload has none. */
  breakdown: SurveyBreakdown | null
  /**
   * Every breakdown the server returned, for the breakdown export: the file carries
   * every dimension, not only the one the map is drawn from.
   */
  breakdowns: readonly SurveyBreakdown[]
  /** The map as `buildClimateMap` produced it, with withheld rows kept and hatched. */
  climate: ClimateMapModel | null
  /**
   * The company's action plans, or `null` when that request failed — which the view
   * says, rather than claiming "no plan" on the strength of an error.
   */
  plans: readonly ActionPlan[] | null
  sample: ResultsSampleWave
}
