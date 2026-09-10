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
 * Everything but `sample` is measured. `GET /surveys/{id}/analytics`, `GET /surveys/{id}`
 * and `GET /action-plans` give the map, the protected rows, the per-question means, the
 * whole-survey 1–5 distributions, the closing date and the plans; `GET
 * /surveys/climate-trends` names the previous wave and the rises in a row, and that
 * wave's own `GET /surveys/{id}/analytics` gives what `previous` compares against.
 * `sample` carries the one reading no endpoint returns today — the opened group's 1–5
 * distribution (`sampleModel.ts`) — and the view marks that region, and only that one,
 * with the "sample data" chip.
 */

/** One column of the map: a dimension the survey measured. */
export interface ResultsDimension {
  key: string
  /** The question ids that make up the dimension, in the author's order. */
  questionIds: readonly string[]
}

/**
 * One group's row. `mean` is the mean of the group's dimension scores and is `null`
 * — never 0 — for a protected row, which carries no scores at all (`buildClimateMap`
 * strips them, the server emptied them first).
 */
export interface ResultsGroupRow {
  id: string
  name: string
  responses: number
  isProtected: boolean
  scores: readonly (number | null)[]
  mean: number | null
  /**
   * The change of `mean` since the previous wave, unrounded. `null` — never 0 — for a
   * protected row, for a group the previous wave withheld or did not have, and when
   * there is no previous wave: the grid then says "sin Q2", or draws no such column.
   */
  vsPrevious: number | null
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
 * The survey before this one, as the page compares against it. Every figure is measured,
 * from that survey's own `GET /surveys/{id}/analytics`, by the same rules this survey's
 * figures are read by (`compose.ts` `composePrevious`).
 */
export interface ResultsPreviousWave {
  surveyId: string
  /** "Q2" out of "Encuesta de Clima Q2" (`waveCode`). */
  code: string
  /** The previous wave's unrounded whole-survey mean, per dimension key. */
  dimensionScores: Readonly<Record<string, number>>
  /**
   * Per group (department id) the previous wave DISCLOSED, its unrounded mean per
   * dimension key. A group that wave withheld, or did not have, has no entry — never a
   * zero — and the grid says "sin Q2" for it.
   */
  groupScores: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Whether the previous wave came with a breakdown by group at all. */
  hasGroupBreakdown: boolean
  /** Consecutive wave-over-wave rises of the company's climate, ending at THIS survey. */
  risesInARow: number
}

/**
 * What the page knows about the previous wave: `loaded`; `none` — nothing closed before
 * this survey, a first wave; or `failed` — a request failed, and the page says so and
 * prints no comparison.
 */
export type ResultsPrevious =
  | { status: 'loaded'; wave: ResultsPreviousWave }
  | { status: 'none' }
  | { status: 'failed' }

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
  /** The survey's authored content language: `'es' | 'en' | 'both'`. */
  language: string
  /**
   * The locale the text on the wire is **actually in**. The UI locale is a request;
   * a Spanish-only survey opened in English comes back `'es'`, and the view has to
   * say so (#195) — `ResultsContentLanguageNotice` reads these three fields.
   */
  resolvedLocale: string
  /** Field paths that reached for the other language, e.g. `questions[2].text`. */
  fallbackFields: readonly string[]
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
  /** The wave this survey is compared against, measured — or why there is none. */
  previous: ResultsPrevious
}
