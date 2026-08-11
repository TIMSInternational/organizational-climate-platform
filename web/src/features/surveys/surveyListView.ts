import { participationRate } from '../../components/charts/participation'
import type { SurveyListItem } from './api/surveys'
import { SURVEY_STATUSES } from './surveyVocabulary'

/**
 * The arithmetic behind the surveys listing: the chip row's counts, the status
 * narrowing those chips perform, and the participation figure in each row.
 *
 * A `.ts` module rather than exports from the components, for the reason
 * `surveyFilterState.ts` already records: oxlint's `react(only-export-components)`
 * fires on a value exported beside a component and the web lint budget has no
 * headroom. Keeping it here also makes the rules assertable without rendering
 * anything.
 */

/** One entry of the chip row: a status, and how many surveys currently hold it. */
export interface SurveyStatusFacet {
  /** A member of `SURVEY_STATUSES`. */
  status: string
  count: number
}

/**
 * The count per status, in `SURVEY_STATUSES` (lifecycle) order.
 *
 * ## Why every status appears, including the ones with no rows
 *
 * The obvious alternative is to emit only the statuses present in the data, the
 * way the type filter derives its options from the rows on screen. That is right
 * *there* — `Survey.Type` is validated only as non-empty on the wire, so there is
 * no closed vocabulary and an invented list would offer filters matching nothing.
 * Status is the opposite case: `SurveyStatuses.All` is a fixed five-member set, so
 * a missing chip would not mean "this filter is unavailable", it would mean zero —
 * and a reader cannot tell those apart from an absence. A chip reading `0` says it.
 *
 * It also keeps the chips in fixed positions between loads, so the one under the
 * pointer does not move when a filter is applied.
 */
export function surveyStatusFacets(surveys: readonly SurveyListItem[]): SurveyStatusFacet[] {
  return SURVEY_STATUSES.map((status) => ({
    status,
    count: surveys.reduce((total, survey) => (survey.status === status ? total + 1 : total), 0),
  }))
}

/**
 * The rows a chip selection shows. An empty `status` is "All" and narrows nothing.
 *
 * ## Why THIS filter is the client's, when type and search are the server's
 *
 * `SurveysListPage` pushes type and search to `GET /surveys` and says at length
 * why: filtering the fetched array is a second implementation of a rule the server
 * owns. That argument still holds, and status is the one exception it cannot cover.
 *
 * The chip row exists to show **counts for statuses you are not looking at**. A
 * response to `GET /surveys?status=active` contains no scheduled surveys, so the
 * counts cannot be computed from it; getting them from the server would mean one
 * request per status — five round trips to draw one row of chips — or a facet
 * endpoint that does not exist. So the request stays status-free, the server still
 * owns type and search, and the status narrowing happens over the full set the
 * server returned.
 *
 * Two things make that safe rather than a shortcut. `GET /surveys` is unpaginated
 * (`ListAsync` returns every matching row in one `{ surveys: [...] }` body), so the
 * array being narrowed *is* the whole result. And the chips can only ever emit a
 * member of `SURVEY_STATUSES` — the closed set `SurveyStatuses.All` — so the 400
 * that `SurveyStatuses.IsValid` answers for an unknown status is not a check being
 * skipped here; there is no unknown status a chip can produce.
 */
export function filterSurveysByStatus(
  surveys: readonly SurveyListItem[],
  status: string,
): SurveyListItem[] {
  if (status === '') return [...surveys]
  return surveys.filter((survey) => survey.status === status)
}

/**
 * Participation as whole percentage points, or `null` when the survey declares no
 * expected audience.
 *
 * `targetAudienceCount` is genuinely nullable — a survey may not declare one — and
 * `participationRate` already returns `null` for a non-positive or non-finite
 * denominator. Null is passed through rather than substituted with 0: "nobody has
 * responded" and "there is nothing to measure against" are different statements and
 * a bar at zero would state the first one falsely.
 *
 * Rounded here rather than in the component so the number the bar is drawn at and
 * the number printed beside it cannot disagree.
 */
export function surveyParticipationPercent(
  responseCount: number,
  targetAudienceCount: number | null,
): number | null {
  if (targetAudienceCount === null) return null
  const rate = participationRate(responseCount, targetAudienceCount)
  return rate === null ? null : Math.round(rate)
}
