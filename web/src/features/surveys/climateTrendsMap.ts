import type { ClimateMapRow } from '../../components/charts'
import { climateScale } from './surveyResultsMap'
import type {
  ClimateTrendGroup,
  ClimateTrendsResponse,
  ClimateTrendSurvey,
} from './api/climateTrends'

/**
 * One group's climate-over-time payload, turned into the props `ClimateMap` takes.
 *
 * ## Why this is a separate builder from `buildClimateMap`
 *
 * They read different payloads and produce the same shape. `buildClimateMap` takes a
 * `SurveyBreakdown` — one survey, rows are groups. This takes a `ClimateTrendsResponse` —
 * one group, rows are surveys. What they share is the *rules*, and those are shared as
 * code rather than as a convention: the colour scale comes from `climateScale`, and the
 * two policies below are deliberately the same ones `buildClimateMap` documents at length.
 * Anything else, and the same reading would render two ways on two screens.
 *
 * ## The two inherited rules
 *
 * **A withheld row keeps its row.** It arrives with `respondentCount: 0` and no scores,
 * and is handed to `ClimateMap` exactly so — the component hatches it because the count is
 * under the threshold. Dropping the survey would tell the reader it never happened.
 *
 * **An incomplete column is dropped, not gapped.** `ClimateMapRow.scores` is a dense array
 * and there is no representation for a missing cell. The alternatives are all worse than
 * dropping: a zero is a false measurement, the neighbouring wave's figure is a fabrication
 * attributed to this one, and a hatched cell claims a protection that was not applied. So
 * a dimension survives only if every *disclosed* row has a score for it, and the ones that
 * did not are named in `omittedDimensions` for the page to account for. This is the common
 * case here rather than the rare one — an instrument that gained a dimension between waves
 * produces exactly this — which is why `ClimateTrendDimension.surveyCount` exists: the
 * page can say "asked in 2 of 4 waves" instead of silently showing a narrower grid.
 */
export interface ClimateTrendMapModel {
  /** The columns actually drawn, as `ClimateMap` dimension descriptors. */
  dimensions: { key: string; label: string }[]
  /** One row per survey, oldest first, withheld ones included. */
  rows: ClimateMapRow[]
  target: number | null
  extremeAt: number
  deadBandAt: number
  threshold: number
  /** Dimension keys left out because some disclosed wave has no score for them. */
  omittedDimensions: string[]
  /** The surveys, aligned by index to `rows`, so a caller can name what a row is. */
  surveys: ClimateTrendSurvey[]
}

/**
 * How a survey is named on its row.
 *
 * The title when it has one, and the close date when it does not — never a bare id and
 * never an empty cell. A survey with a null title is not hypothetical here: four of them
 * exist in the local stack today, and a matrix whose row headings were blank would read as
 * a rendering fault rather than as missing authoring.
 */
export function trendRowLabel(
  survey: ClimateTrendSurvey,
  formatDate: (iso: string) => string,
): string {
  const title = survey.title?.trim()
  return title && title.length > 0 ? title : formatDate(survey.endDate)
}

export function buildClimateTrendMap(
  payload: ClimateTrendsResponse,
  group: ClimateTrendGroup,
  formatDate: (iso: string) => string,
): ClimateTrendMapModel | null {
  if (payload.surveys.length === 0 || payload.dimensions.length === 0) return null

  // Index-aligned by contract: the server sends one point per survey, oldest first, and
  // pads a group that did not exist in a wave with a suppressed point precisely so this
  // zip is safe. Guarded anyway — a shorter series would silently shift every reading
  // one column left, which is the worst possible failure for this screen.
  if (group.points.length !== payload.surveys.length) return null

  const disclosed = group.points.filter((point) => !point.isSuppressed)

  const keptIndexes: number[] = []
  const omittedDimensions: string[] = []
  payload.dimensions.forEach((dimension, index) => {
    const complete =
      disclosed.length > 0 && disclosed.every((point) => point.scores[index] !== null)
    if (complete) keptIndexes.push(index)
    else omittedDimensions.push(dimension.key)
  })

  const rows: ClimateMapRow[] = payload.surveys.map((survey, index) => {
    const point = group.points[index]
    return {
      id: survey.surveyId,
      label: trendRowLabel(survey, formatDate),
      // The server's own count, passed through untouched. It is 0 for a withheld row,
      // which is what makes `ClimateMap` hatch it.
      responses: point.respondentCount,
      scores: point.isSuppressed
        ? []
        : keptIndexes.map((dimensionIndex) => point.scores[dimensionIndex] as number),
    }
  })

  const cells = rows.flatMap((row) => row.scores)

  return {
    dimensions: keptIndexes.map((index) => ({
      key: payload.dimensions[index].key,
      label: payload.dimensions[index].key,
    })),
    rows,
    ...climateScale(cells),
    // A floor of 0 would make `isSuppressed` false for the `respondentCount: 0` a withheld
    // row carries, and the row would try to read scores it does not have.
    threshold: Math.max(1, payload.minimumGroupSize),
    omittedDimensions,
    surveys: payload.surveys,
  }
}
