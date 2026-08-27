import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for `GET /surveys/climate-trends` (`SurveyClimateTrendsEndpoints.cs`).
 *
 * ## What this is, and what it is not
 *
 * The company's own dimension scores across its own surveys. It is **not**
 * `/benchmarks/{id}/trends`, which walks a hand-linked chain of external comparison rows
 * and never reads a response. The two have similar names and answer different questions;
 * they were confused for each other once.
 *
 * ## The matrix is transposed on purpose
 *
 * Rows are **surveys** and columns are **dimensions**, which is the reverse of how the
 * feature is usually described. The reason is the anonymity floor and not layout: a
 * reading is withheld on the size of the group behind it, so the group must be constant
 * along a row. Within one survey, one department answered every dimension — one
 * respondent count governs the whole row, and `ClimateMap`'s row-as-a-unit suppression is
 * exactly right. The other way round, the count varies along the row and a component that
 * suppresses by row would either withhold disclosable cells or disclose withheld ones.
 *
 * ## Suppression arrives as data
 *
 * A withheld point carries `isSuppressed: true`, all-null scores and `respondentCount: 0`.
 * The zero is not a reading and must never be rendered as one — the server withholds the
 * real count deliberately, because publishing a size beside a hatched cell hands over the
 * number the floor exists to protect. Feed it to `ClimateMap` as `responses` and let the
 * component decide; do not branch on it here.
 */

/** One column: a question category, which this product calls a dimension. */
export interface ClimateTrendDimension {
  /**
   * The raw category string, locale-independent. Categories are authored free text and
   * are not translated anywhere in this product, so there is no label to resolve.
   */
  key: string
  /**
   * How many surveys in the window actually contain this dimension. Lets a reader tell a
   * dimension dropped from later instruments from one every wave asked about — the null
   * scores alone cannot, because a null is also what suppression produces.
   */
  surveyCount: number
}

/** One cell-row: one survey, for one group. */
export interface ClimateTrendPoint {
  surveyId: string
  /**
   * Completed responses behind this row. **Never render it.** It decides suppression and
   * is reported so a client can apply a raised company floor; it is 0 whenever
   * `isSuppressed` is true, so the withheld size never travels with the withheld reading.
   */
  respondentCount: number
  isSuppressed: boolean
  /**
   * One entry per dimension, positionally aligned to `dimensions`. `null` means "no
   * score" and deliberately conflates three causes — suppressed, never asked, no answered
   * scale question. Telling them apart would let a reader difference a named group's size.
   */
  scores: (number | null)[]
}

/** One group's series across every survey in the window. */
export interface ClimateTrendGroup {
  /** A department id, a demographic value, or `WHOLE_COMPANY_KEY` when ungrouped. */
  key: string
  /** Resolved display name, or `null` when the key is its own name. */
  label: string | null
  /** One per survey, oldest first, aligned by index to `surveys`. */
  points: ClimateTrendPoint[]
}

/** One survey in the window — the matrix's row heading. */
export interface ClimateTrendSurvey {
  surveyId: string
  title: string | null
  status: string
  /** When the survey CLOSED. What the rows are ordered and dated by. */
  endDate: string
  /** The survey's own completed count, independent of any grouping. */
  completedCount: number
  isSuppressed: boolean
}

export interface ClimateTrendsResponse {
  companyId: string
  /** Echoed back, so an ungrouped response is distinguishable from a grouped one that matched nothing. */
  groupBy: string | null
  surveys: ClimateTrendSurvey[]
  dimensions: ClimateTrendDimension[]
  groups: ClimateTrendGroup[]
  /**
   * Groups withheld in every survey in the window. They are still present in `groups`,
   * with every point suppressed — counted, not dropped, because removing them would
   * misreport the organisation's shape.
   */
  suppressedGroupCount: number
  /** The floor the server actually applied. Hand this to `ClimateMap`, never a local constant. */
  minimumGroupSize: number
  generatedAt: string
}

/** The group key the server uses for the ungrouped series. Mirrors `SurveyClimateTrends.WholeCompanyKey`. */
export const WHOLE_COMPANY_KEY = '__company__'

/** The `groupBy` value that selects the department breakdown. */
export const DEPARTMENT_GROUP = 'department'

export interface ClimateTrendsQuery {
  /** `department`, a demographic field key, or omitted for the whole company. */
  groupBy?: string
  /** Surveys to read. The server clamps to its own ceiling; it does not error. */
  limit?: number
  /** SuperAdmin only. A CompanyAdmin naming another company is refused, not rescoped. */
  companyId?: string
}

export async function getClimateTrends(
  baseUrl: string,
  query: ClimateTrendsQuery = {},
): Promise<ClimateTrendsResponse> {
  const params = new URLSearchParams()
  if (query.groupBy) params.set('groupBy', query.groupBy)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.companyId) params.set('companyId', query.companyId)

  const suffix = params.size > 0 ? `?${params}` : ''
  const response = await authFetch(`${baseUrl}/surveys/climate-trends${suffix}`)
  return response.json() as Promise<ClimateTrendsResponse>
}
