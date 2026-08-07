import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for the four survey results surfaces (`SurveyResultsEndpoints.cs`, #121).
 *
 * ## Why the page calls `/analytics` and not `/results` + `/statistics`
 *
 * `/results` returns the per-question half, `/statistics` the segment half, and
 * `/analytics` returns **both halves of the same `SurveyAggregate` in one round trip**.
 * They are three presentations over one computation, so fetching two of them would cost
 * two full aggregations of the same response set and — worse — could return two payloads
 * computed a moment apart, so the participation counter beside the distributions could
 * disagree with the one beside the breakdowns while both were individually correct.
 * All three are typed here anyway, because a caller that genuinely wants one half should
 * ask for one half rather than discard the other.
 *
 * ## `resolvedLocale` is not the locale you asked for
 *
 * `lang` is a *request*. `resolvedLocale` names the locale the text on the wire is
 * **actually in** — a Spanish-only survey fetched with `?lang=en` comes back with
 * `resolvedLocale: 'es'`, and the page has to say so (#195). Nothing here is
 * `En`/`Es`-shaped; the server resolves and reports.
 *
 * ## Suppression arrives as data, not as an absence
 *
 * `isSuppressed`, `suppressionReason`, `suppressedSegmentCount`,
 * `suppressedRespondentCount` and `unsegmentedRespondentCount` all exist so a client can
 * render "withheld" rather than silently showing a shorter list. Treating a suppressed
 * bucket as zero is a different and wrong claim, and it invites a reader to infer the
 * withheld figure from the totals — so the counts are modelled as required fields here
 * rather than as optional ones a page can forget.
 */

/** How many responses arrived in each language. Rows, not fields — see the DTO notes. */
export interface SurveyLanguageCount {
  language: string
  count: number
}

/** Participation counters. Returned even below the disclosure floor: a count identifies nobody. */
export interface SurveyResultsSummary {
  /** `null` when the survey carries no target audience — not a fabricated denominator. */
  invitedCount: number | null
  responseCount: number
  completedCount: number
  partialCount: number
  /** Completed / invited, 0-100. `null` when there is no invited total. */
  participationRate: number | null
  /** Completed / started, 0-100. */
  completionRate: number
  averageCompletionSeconds: number | null
  firstResponseAt: string | null
  lastResponseAt: string | null
  byLanguage: SurveyLanguageCount[]
}

/**
 * One bucket of a question's distribution.
 *
 * `value` is the stable, locale-independent option value and is the group key on the
 * server; `label` is display text resolved for the request locale and must never be used
 * as an identity here either — two options can resolve to the same label in one locale.
 */
export interface SurveyDistributionBucket {
  value: string
  label: string | null
  count: number
  percentage: number
  /** Mean 1-based position, for ranking questions only. */
  averageRank: number | null
}

/** One word of one language's cloud. Verbatim response text is never returned. */
export interface SurveyWordFrequency {
  language: string
  word: string
  count: number
  responseCount: number
}

export interface SurveyQuestionResult {
  questionId: string
  order: number
  type: string
  text: string | null
  category: string | null
  answeredCount: number
  /** Empty for open-ended questions, which have no option set. */
  distribution: SurveyDistributionBucket[]
  /** Scale questions only. `null` for everything else, and for a partly unparseable set. */
  average: number | null
  median: number | null
  /** Open-ended questions only, bucketed by the language the response was written in. */
  words: SurveyWordFrequency[]
  /** Distinct words withheld for appearing in too few responses. */
  suppressedWordCount: number
}

/** One question's numbers inside one segment. Deliberately not a full distribution. */
export interface SurveySegmentQuestionResult {
  questionId: string
  answeredCount: number
  average: number | null
}

/**
 * One department or one demographic value.
 *
 * When `isSuppressed` is true the server has already emptied `questions` and zeroed
 * `respondentCount`. **A zero here is not a measurement**, it is the absence of one, and a
 * page that plots it draws a bar claiming nobody in that group answered.
 */
export interface SurveySegmentResult {
  /** `"department"`, or the demographic field key. */
  dimension: string
  /** The department id, or the stable demographic value. Locale-independent. */
  key: string
  label: string | null
  respondentCount: number
  participationRate: number | null
  isSuppressed: boolean
  questions: SurveySegmentQuestionResult[]
}

export interface SurveyBreakdown {
  dimension: string
  segments: SurveySegmentResult[]
  suppressedSegmentCount: number
  suppressedRespondentCount: number
  /** Completed responses carrying no value at all for this dimension. */
  unsegmentedRespondentCount: number
}

/** Fields every one of the three heavy presentations carries. */
interface SurveyResultsEnvelope {
  surveyId: string
  title: string | null
  status: string
  /** The survey's authored content language: `'es' | 'en' | 'both'`. */
  language: string
  /** The locale the returned text is actually in. May differ from what was requested. */
  resolvedLocale: string
  /** Field paths that reached for the other language. */
  fallbackFields: string[]
  summary: SurveyResultsSummary
  isSuppressed: boolean
  /** A machine-readable reason code, e.g. `below_minimum_respondents`. Not display copy. */
  suppressionReason: string | null
  minimumGroupSize: number
  generatedAt: string
}

/** `GET /surveys/{id}/results` — the per-question half. */
export interface SurveyResultsResponse extends SurveyResultsEnvelope {
  questions: SurveyQuestionResult[]
}

/** `GET /surveys/{id}/statistics` — the segment half. */
export interface SurveyStatisticsResponse extends SurveyResultsEnvelope {
  breakdowns: SurveyBreakdown[]
}

/** `GET /surveys/{id}/analytics` — both halves of one aggregation, in one round trip. */
export interface SurveyAnalyticsResponse extends SurveyResultsEnvelope {
  questions: SurveyQuestionResult[]
  breakdowns: SurveyBreakdown[]
}

/** One department's live participation, from the poll endpoint. */
export interface SurveyDepartmentParticipation {
  departmentId: string
  name: string
  completedCount: number
  participationRate: number | null
}

/** `GET /surveys/{id}/real-time-stats` — counters only, cheap enough to poll. */
export interface SurveyRealTimeStatsResponse {
  surveyId: string
  status: string
  /** False once the survey can no longer accept responses: stop polling. */
  isLive: boolean
  invitedCount: number | null
  responseCount: number
  completedCount: number
  inProgressCount: number
  participationRate: number | null
  completionRate: number
  lastResponseAt: string | null
  byDepartment: SurveyDepartmentParticipation[]
  suppressedDepartmentCount: number
  suppressedRespondentCount: number
  unsegmentedRespondentCount: number
  minimumGroupSize: number
  /** The server's chosen poll cadence, so the interval is not a constant copied per caller. */
  pollIntervalSeconds: number
  generatedAt: string
}

/**
 * `lang` is last and optional, per the house rule: a prior bug put an optional
 * `baseUrl` before the required arguments and broke five exports.
 */
function resultsUrl(baseUrl: string, surveyId: string, suffix: string, lang?: string): string {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  return `${baseUrl}/surveys/${encodeURIComponent(surveyId)}/${suffix}${query}`
}

export async function getSurveyResults(
  baseUrl: string,
  surveyId: string,
  lang?: string,
): Promise<SurveyResultsResponse> {
  const response = await authFetch(resultsUrl(baseUrl, surveyId, 'results', lang))
  return response.json() as Promise<SurveyResultsResponse>
}

export async function getSurveyStatistics(
  baseUrl: string,
  surveyId: string,
  lang?: string,
): Promise<SurveyStatisticsResponse> {
  const response = await authFetch(resultsUrl(baseUrl, surveyId, 'statistics', lang))
  return response.json() as Promise<SurveyStatisticsResponse>
}

export async function getSurveyAnalytics(
  baseUrl: string,
  surveyId: string,
  lang?: string,
): Promise<SurveyAnalyticsResponse> {
  const response = await authFetch(resultsUrl(baseUrl, surveyId, 'analytics', lang))
  return response.json() as Promise<SurveyAnalyticsResponse>
}

/**
 * No `lang`: this payload contains no authored content at all — only counters and
 * department names, which are not `_en`/`_es` paired — so there is nothing for a locale to
 * resolve and sending one would imply otherwise.
 */
export async function getSurveyRealTimeStats(
  baseUrl: string,
  surveyId: string,
): Promise<SurveyRealTimeStatsResponse> {
  const response = await authFetch(resultsUrl(baseUrl, surveyId, 'real-time-stats'))
  return response.json() as Promise<SurveyRealTimeStatsResponse>
}
