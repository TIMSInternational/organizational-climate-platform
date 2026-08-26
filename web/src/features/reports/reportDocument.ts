import type { SurveyResultsSummary } from '../surveys/api/surveyResults'

/**
 * The document persisted in `reports.report_output`, as a client can safely read it.
 *
 * ## Why this is a parser and not just an interface
 *
 * `ReportDetail.ReportOutput` (ReportDtos.cs) is a **`string?` holding JSON**, not a
 * nested object: `ReportGeneration` serialises a `ReportOutputDocument` into the column
 * and the endpoint hands the column back verbatim. So every consumer has to
 * `JSON.parse` it, and a consumer that parses and then casts — `JSON.parse(raw) as
 * ReportDocument` — has told the type checker a lie it cannot check. The column is
 * written by one generator today, but it is a text column: an older row, a row written
 * by a previous version of the generator, or a `null` from a report that failed to
 * generate all arrive through the same field, and a cast turns each of them into a page
 * that throws while reading `.surveys.map`.
 *
 * That matters more here than it would elsewhere, because the first consumer is
 * `SharedReportPage` — an **unauthenticated** page whose visitor has no session to fall
 * back to, no navigation to escape with, and no way to tell a crashed render from a
 * revoked link. A render that throws there is indistinguishable from the product being
 * broken.
 *
 * So this module parses defensively and returns `null` for anything it cannot vouch
 * for. `null` means "there is no document", which every caller must already handle:
 * `report_output` is nullable on the entity.
 *
 * ## What it does NOT do
 *
 * It does not recompute, round, floor or infer anything. Every field is carried across
 * exactly as it arrived, or dropped. That rule is load-bearing for suppression:
 * `IsSuppressed` is the aggregation's own decision, and `ReportDepartmentParticipation`
 * documents that a suppressed department's `RespondentCount` has already been zeroed
 * server-side. A parser that "helpfully" filled a missing count from somewhere else
 * would be reconstructing the number the server withheld.
 */

/**
 * One department's participation as a report prints it — `ReportDepartmentParticipation`
 * in ReportDtos.cs.
 *
 * `respondentCount` is **already zero** when `isSuppressed` is true; the server zeroes
 * it so a withheld department's headcount does not exist in the document at all.
 * Renderers must branch on `isSuppressed` rather than on the count, because zero is
 * also a real answer for a department nobody in which responded.
 */
export interface ReportDepartmentParticipation {
  departmentId: string
  name: string | null
  respondentCount: number
  participationRate: number | null
  isSuppressed: boolean
}

/** One dimension's score — `SurveyDimensionResult` in SurveyResultsDtos.cs. */
export interface ReportDimensionScore {
  dimension: string
  questionCount: number
  answeredCount: number
  averageScore: number | null
}

/**
 * One survey's section of a report — `ReportSurveySection` in ReportDtos.cs.
 *
 * `participation` is populated even below the disclosure floor ("a count identifies
 * nobody"), while `dimensions` is empty whenever `isSuppressed` is true. The two
 * together are why a renderer cannot infer "suppressed" from an empty list: a survey
 * with no scale questions has no dimensions and is not suppressed at all.
 */
export interface ReportSurveySection {
  surveyId: string
  title: string | null
  status: string
  participation: SurveyResultsSummary
  dimensions: ReportDimensionScore[]
  departments: ReportDepartmentParticipation[]
  suppressedDepartmentCount: number
  suppressedRespondentCount: number
  unsegmentedRespondentCount: number
  isSuppressed: boolean
  /** A machine-readable code, e.g. `below_minimum_respondents`. Never display copy. */
  suppressionReason: string | null
  minimumGroupSize: number
}

/** One AI insight as a report prints it — `ReportAIInsightItem` in ReportAIInsights.cs. */
export interface ReportAIInsight {
  id: string
  type: string
  category: string
  title: string
  description: string
  /**
   * An integer percentage, 0-100. This is the field #152 was about: the legacy app had
   * two `AIInsight` models, one 0-100 and one 0-1, and the report read the wrong one.
   * Nothing in a report may render a fractional confidence.
   */
  confidenceScore: number
  priority: string
  affectedSegments: string[]
  recommendedActions: string[]
  isAcknowledged: boolean
}

/** `ReportOutputDocument` in ReportAIInsights.cs. */
export interface ReportDocument {
  /**
   * The generator's own note that the document is not yet the whole report — it names
   * the sections that do not exist yet.
   *
   * It is **server-authored English** and is deliberately not rendered verbatim
   * anywhere: printing it would put an untranslated developer sentence in front of a
   * Spanish-speaking reader. What it is good for is the boolean question "is this
   * document complete", which a client can ask without reading the prose.
   */
  generationNote: string
  surveys: ReportSurveySection[]
  aiInsights: ReportAIInsight[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** A finite number, or `fallback`. `NaN` and `Infinity` are not counts. */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * A boolean, defaulting to the value the CALLER says is safe rather than to `false`.
 *
 * Every boolean this module reads except `isAcknowledged` is a suppression flag, and
 * the safe default for "should this be withheld" is *yes*. A malformed section that
 * defaulted `isSuppressed` to `false` would publish per-dimension scores the server may
 * have withheld — the one failure this document shape exists to prevent.
 */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringArray(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === 'string')
}

function participationOf(value: unknown): SurveyResultsSummary {
  const raw = isRecord(value) ? value : {}
  return {
    invitedCount: nullableNum(raw.invitedCount),
    responseCount: num(raw.responseCount),
    completedCount: num(raw.completedCount),
    partialCount: num(raw.partialCount),
    participationRate: nullableNum(raw.participationRate),
    completionRate: num(raw.completionRate),
    averageCompletionSeconds: nullableNum(raw.averageCompletionSeconds),
    firstResponseAt: nullableStr(raw.firstResponseAt),
    lastResponseAt: nullableStr(raw.lastResponseAt),
    byLanguage: array(raw.byLanguage)
      .filter(isRecord)
      .map((row) => ({ language: str(row.language), count: num(row.count) })),
  }
}

function dimensionOf(value: unknown): ReportDimensionScore {
  const raw = isRecord(value) ? value : {}
  return {
    dimension: str(raw.dimension),
    questionCount: num(raw.questionCount),
    answeredCount: num(raw.answeredCount),
    averageScore: nullableNum(raw.averageScore),
  }
}

function departmentOf(value: unknown): ReportDepartmentParticipation {
  const raw = isRecord(value) ? value : {}
  const isSuppressed = bool(raw.isSuppressed, true)
  return {
    departmentId: str(raw.departmentId),
    name: nullableStr(raw.name),
    // Zeroed rather than carried when the row says it is suppressed. The server already
    // does this; doing it again here means a row that arrives suppressed with a
    // non-zero count — a generator bug, a hand-edited column — cannot leak the count
    // through this client.
    respondentCount: isSuppressed ? 0 : num(raw.respondentCount),
    participationRate: isSuppressed ? null : nullableNum(raw.participationRate),
    isSuppressed,
  }
}

function sectionOf(value: unknown): ReportSurveySection {
  const raw = isRecord(value) ? value : {}
  const isSuppressed = bool(raw.isSuppressed, true)
  return {
    surveyId: str(raw.surveyId),
    title: nullableStr(raw.title),
    status: str(raw.status),
    participation: participationOf(raw.participation),
    // Dropped outright for a suppressed section, mirroring the server's own
    // "Dimensions is empty when IsSuppressed is true". Two implementations of one rule
    // is a smell, but the alternative is a renderer that trusts a list the server
    // promises is empty — and this list is the withheld data itself.
    dimensions: isSuppressed ? [] : array(raw.dimensions).map(dimensionOf),
    departments: array(raw.departments).map(departmentOf),
    suppressedDepartmentCount: num(raw.suppressedDepartmentCount),
    suppressedRespondentCount: num(raw.suppressedRespondentCount),
    unsegmentedRespondentCount: num(raw.unsegmentedRespondentCount),
    isSuppressed,
    suppressionReason: nullableStr(raw.suppressionReason),
    minimumGroupSize: num(raw.minimumGroupSize),
  }
}

function insightOf(value: unknown): ReportAIInsight {
  const raw = isRecord(value) ? value : {}
  return {
    id: str(raw.id),
    type: str(raw.type),
    category: str(raw.category),
    title: str(raw.title),
    description: str(raw.description),
    confidenceScore: num(raw.confidenceScore),
    priority: str(raw.priority),
    affectedSegments: stringArray(raw.affectedSegments),
    recommendedActions: stringArray(raw.recommendedActions),
    isAcknowledged: bool(raw.isAcknowledged, false),
  }
}

/**
 * Parses `reports.report_output` into a document, or returns `null`.
 *
 * `null` for: a null/absent column, text that is not JSON, and JSON that is not an
 * object (the placeholder this column held before #88 was the JSON string
 * `"Report generation is stubbed…"`, which parses fine and is not a document — the
 * exact shape a cast would have turned into a crash).
 *
 * Anything that IS an object is read field by field with the defaults above, so a
 * document missing `surveys` renders as a report with no survey sections rather than
 * throwing.
 */
export function parseReportDocument(raw: string | null | undefined): ReportDocument | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  return {
    generationNote: str(parsed.generationNote),
    surveys: array(parsed.surveys).map(sectionOf),
    aiInsights: array(parsed.aiInsights).map(insightOf),
  }
}
