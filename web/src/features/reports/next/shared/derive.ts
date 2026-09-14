import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { CLIMATE_TARGET, targetBand, type TargetBand } from '../../../surveys/next/derive'
import type { SurveyQuestionResult } from '../../../surveys/api/surveyResults'
import type {
  ReportDemographicBreakdown,
  ReportDepartmentParticipation,
  ReportDocument,
  ReportSegmentParticipation,
  ReportSurveySection,
} from '../../reportDocument'

/**
 * Every figure the redesigned `/shared/reports/:token` prints, derived once from the
 * parsed document — and nothing else.
 *
 * ## The one thing this module is for
 *
 * This page is the most exposed surface in the product: unauthenticated, addressed by a
 * forwardable link, serving a company's climate data to whoever holds the URL. The
 * anonymity floor for it is applied **at read time on the server** —
 * `SurveyAggregation.cs:604` (departments) and `SurveyAggregation.cs:677` (demographic
 * groups) replace a sub-floor group with `(RespondentCount: 0, ParticipationRate: null,
 * IsSuppressed: true, Questions: [])` before anything is stored, and
 * `PublicReportProjection` then withholds the sub-floor headcount from the public payload
 * outright. `reportDocument.ts` re-applies the same refusal at the parser. This module is
 * the third statement of it, at the layer that decides what the page draws.
 *
 * Three rules, each enforced by a function below rather than by the renderer's diligence:
 *
 * 1. **A withheld group yields no number, ever.** `groupRowsOf` does not read
 *    `dimensions` or `respondentCount` off a suppressed segment — not to round it, not to
 *    total it, not to decide a column. A suppressed row carries `null` in every cell and
 *    `protected: true`, so the only thing a renderer can do with it is hatch it.
 * 2. **An absent count is never a zero.** `participationOf` answers `not-computed` when
 *    the survey had no invitation list, because "0 %" reads as "nobody answered" — the
 *    classic leak this platform has already shipped once.
 * 3. **Nothing is recomputed across the floor.** Every average is the aggregation's own,
 *    carried across or dropped. The one derived figure is a *count of groups*, which
 *    names nobody and is what tells a reader the list they are looking at is incomplete.
 *
 * Open text never appears here in any form. `reportDocument.ts` copies only
 * `{ language, word, count, responseCount }` per word, so there is no sentence in the
 * parsed document for this module to carry; `hasOpenTextOf` answers a boolean about
 * whether a frequency map exists at all, which is what the header chip states.
 */

/** The target every reading on this page is judged against — the app's own constant. */
export { CLIMATE_TARGET }

/**
 * The scale the target belongs to, and the reason it is checked rather than assumed.
 *
 * `CLIMATE_TARGET` is 3,7 **of 5**. A report's `dimensions` list is every question
 * category the survey author used, and one of the categories this product ships is `enps`
 * — recorded 0 to 10. Judging a 7,8 eNPS against a 1-to-5 target prints "sobre la meta"
 * beside a figure that is nothing of the sort, and tints its map cell the darkest blue on
 * the ramp: a confident, measured-looking claim about a number that was never on this
 * scale. So a reading outside 1..5 keeps its figure and loses its verdict, which is the
 * honest half of both.
 */
export const SCALE_MIN = 1
export const SCALE_MAX = 5

/** Whether a reading can be judged against the climate target at all. */
export function onScale(value: number): boolean {
  return value >= SCALE_MIN && value <= SCALE_MAX
}

/** One dimension of one survey, as the "Clima por dimensión" table prints it. */
export interface SharedDimensionRow {
  /** The aggregation's own category key. Translated at the render site. */
  key: string
  /** The aggregation's average, carried across. `null` when it computed none. */
  average: number | null
  /**
   * Where `average` sits against the target. `null` when there is no average **and** when
   * the average is not on the 1-to-5 scale the target belongs to — see `SCALE_MIN`.
   */
  band: TargetBand | null
  /** An average that exists but cannot be judged against the target. */
  offScale: boolean
  questionCount: number
  answeredCount: number
}

/**
 * One group's row of the climate map.
 *
 * `scores` is aligned to its map's `columns` and is **all `null` for a protected row**.
 * There is no headcount on this shape at all: the server zeroed it, the parser zeroed it
 * again, and a field that does not exist cannot be printed by a later edit.
 */
export interface SharedGroupRow {
  /** Stable, locale-independent — the aggregation's own grouping value. */
  id: string
  /** The reader-facing name: the group's label where it has one, else its key. */
  name: string
  protected: boolean
  scores: readonly (number | null)[]
}

/** One demographic breakdown as the "Clima por grupo y dimensión" map draws it. */
export interface SharedGroupMap {
  /** The demographic field the aggregation grouped on, e.g. `antigüedad`. */
  field: string
  /** The dimension keys that make up the columns, in first-seen order. */
  columns: readonly string[]
  rows: readonly SharedGroupRow[]
  /** How many of `rows` are withheld. Never how many people are behind them. */
  withheldCount: number
  /** Respondents carrying no value for this field. A different fact from a withheld group. */
  unsegmented: number
}

/**
 * The participation reading, as one of two statements rather than as a number that may
 * be missing.
 *
 * `not-computed` is the survey that had no invitation list: there is no denominator, so
 * there is no rate — and printing `0 %` there would tell a board member nobody answered.
 */
export type SharedParticipation =
  | { kind: 'rate'; rate: number; invited: number }
  | { kind: 'not-computed' }

/** Every named group a section prints, counted. Names, never headcounts. */
export interface SharedGroupCount {
  readable: number
  total: number
  /** The names of the withheld groups — the same names their hatched rows already carry. */
  withheldNames: readonly string[]
}

/** One survey's section of the report. */
export interface SharedSection {
  surveyId: string
  title: string | null
  /** `en` or `es` — the language the authored text in this section is printed in. */
  resolvedLocale: string
  /** The whole survey is below the floor: it prints counters and a notice, nothing else. */
  suppressed: boolean
  /** A machine-readable code. Never display copy. */
  suppressionReason: string | null
  /** This company's floor, as the aggregation applied it. */
  floor: number
  responses: number
  completed: number
  completionRate: number
  participation: SharedParticipation
  dimensions: readonly SharedDimensionRow[]
  maps: readonly SharedGroupMap[]
  departments: readonly ReportDepartmentParticipation[]
  withheldDepartments: number
  groups: SharedGroupCount
  /** Whether this section carries a word-frequency map at all. Never the words. */
  hasOpenText: boolean
  questions: readonly SurveyQuestionResult[]
}

/** The whole page's model. */
export interface SharedReportView {
  generatedAt: string | null
  /** The highest floor any section was aggregated under — what the header chip states. */
  floor: number
  hasOpenText: boolean
  sections: readonly SharedSection[]
}

/**
 * The reader-facing name of a group.
 *
 * `label ?? key` is the product's own rule: the aggregation labels a department with its
 * name and leaves a demographic value as the value the respondent picked, which is
 * already the words a reader recognises.
 */
function nameOf(segment: ReportSegmentParticipation): string {
  return segment.label ?? segment.key
}

/**
 * The columns of one map: the dimensions the **disclosed** groups carry, in first-seen
 * order.
 *
 * Collected from disclosed rows only. That costs nothing — a suppressed segment arrives
 * with no scores and could not contribute a column if it tried — and it means the loop
 * that builds the header never touches a withheld group's data.
 */
function columnsOf(breakdown: ReportDemographicBreakdown): string[] {
  const columns: string[] = []
  for (const segment of breakdown.segments) {
    if (segment.isSuppressed) continue
    for (const score of segment.dimensions) {
      if (!columns.includes(score.dimension)) columns.push(score.dimension)
    }
  }
  return columns
}

/**
 * The rows of one map.
 *
 * The suppressed branch reads **nothing** off the segment but its name: not
 * `respondentCount`, not `dimensions`. A segment that arrives suppressed and still
 * carrying scores — a generator regression, a hand-edited column, a document written by
 * something that is not this server — therefore cannot put a number on this page through
 * this function, whatever the payload says.
 */
export function groupRowsOf(
  breakdown: ReportDemographicBreakdown,
  columns: readonly string[],
): SharedGroupRow[] {
  return breakdown.segments.map((segment) => {
    if (segment.isSuppressed) {
      return {
        id: segment.key,
        name: nameOf(segment),
        protected: true,
        scores: columns.map(() => null),
      }
    }
    return {
      id: segment.key,
      name: nameOf(segment),
      protected: false,
      scores: columns.map((column) => {
        const score = segment.dimensions.find((row) => row.dimension === column)
        return score === undefined ? null : score.averageScore
      }),
    }
  })
}

/** One demographic breakdown as a map, or `null` when it has no readable column. */
export function mapOf(breakdown: ReportDemographicBreakdown): SharedGroupMap | null {
  const columns = columnsOf(breakdown)
  if (columns.length === 0) return null
  return {
    field: breakdown.dimension,
    columns,
    rows: groupRowsOf(breakdown, columns),
    // The server's own count, not a recount of the rows: the two agree today, and where
    // they ever disagreed the server's is the one that knows what it withheld.
    withheldCount: breakdown.suppressedSegmentCount,
    unsegmented: breakdown.unsegmentedRespondentCount,
  }
}

/**
 * The participation reading.
 *
 * Both halves are required: a rate with no invitation list behind it is a number with no
 * denominator, and the aggregation is explicit that it publishes neither without the
 * other. Anything short of both is `not-computed`, which the page says in words.
 */
export function participationOf(section: ReportSurveySection): SharedParticipation {
  const { invitedCount, participationRate } = section.participation
  if (invitedCount === null || participationRate === null) return { kind: 'not-computed' }
  return { kind: 'rate', rate: participationRate, invited: invitedCount }
}

/** The dimension rows. Empty for a suppressed section, whatever the payload carries. */
export function dimensionRowsOf(section: ReportSurveySection): SharedDimensionRow[] {
  if (section.isSuppressed) return []
  return section.dimensions.map((dimension) => {
    const average = dimension.averageScore
    const judged = average !== null && onScale(average)
    return {
      key: dimension.dimension,
      average,
      band: judged ? targetBand(average) : null,
      offScale: average !== null && !judged,
      questionCount: dimension.questionCount,
      answeredCount: dimension.answeredCount,
    }
  })
}

/**
 * Every named group this section prints, counted — departments and demographic groups
 * alike, because a reader counting "readable groups" is counting rows on this page.
 *
 * `withheldNames` carries names and never headcounts. A name is already on the hatched
 * row beside it; the count of people behind it is the figure the floor exists to hide and
 * is not on this shape to be carried.
 */
export function groupCountOf(section: ReportSurveySection): SharedGroupCount {
  const withheldNames: string[] = []
  let readable = 0
  let total = 0

  // A survey below the whole-survey floor has no readable group, by definition: with
  // fewer than five complete responses every group inside it is smaller still. The
  // aggregation produces no breakdowns at all for such a survey, so this branch is
  // unreachable from this server — and it is here because the branch that is NOT taken
  // would report "2 of 3 readable" for a survey whose per-question results are withheld
  // in full, which is the shape a hand-edited document or an older generator produces.
  if (section.isSuppressed) return { readable: 0, total: 0, withheldNames: [] }

  for (const department of section.departments) {
    total += 1
    if (department.isSuppressed) {
      if (department.name !== null) withheldNames.push(department.name)
    } else {
      readable += 1
    }
  }

  for (const breakdown of section.demographics) {
    for (const segment of breakdown.segments) {
      total += 1
      if (segment.isSuppressed) withheldNames.push(nameOf(segment))
      else readable += 1
    }
  }

  return { readable, total, withheldNames }
}

/**
 * Whether this section has any open-text surface at all.
 *
 * A boolean, deliberately: the header chip states whether the reader is looking at a
 * report that includes word frequencies, and nothing about what any of them say. A
 * question whose whole cloud was withheld still counts — the reader is entitled to know
 * the report has an open-text section before they are told it is empty.
 */
export function hasOpenTextOf(section: ReportSurveySection): boolean {
  if (section.isSuppressed) return false
  return section.questions.some(
    (question) => question.words.length > 0 || question.suppressedWordCount > 0,
  )
}

/** One survey's section of the view. */
export function sectionOf(section: ReportSurveySection): SharedSection {
  const maps = section.isSuppressed
    ? []
    : section.demographics.map(mapOf).filter((map): map is SharedGroupMap => map !== null)

  return {
    surveyId: section.surveyId,
    title: section.title,
    resolvedLocale: section.resolvedLocale,
    suppressed: section.isSuppressed,
    suppressionReason: section.suppressionReason,
    // A document that carries no floor is read as the platform minimum rather than as 0:
    // `minimumGroupSize` defaults to 0 in the parser, and a floor of 0 printed on this
    // page would advertise that nothing was withheld.
    floor: section.minimumGroupSize > 0 ? section.minimumGroupSize : ANONYMITY_FLOOR,
    responses: section.participation.responseCount,
    completed: section.participation.completedCount,
    completionRate: section.participation.completionRate,
    participation: participationOf(section),
    dimensions: dimensionRowsOf(section),
    maps,
    // Dropped for a suppressed section, like every other breakdown.
    //
    // The server never sends them: below `SurveyResultsPrivacy.MinimumRespondents` the
    // aggregation produces no breakdowns at all, so `departments` is empty and nothing
    // is lost. The refusal is here because the survey-level counters ARE published below
    // the floor — "a count of responses identifies nobody" — and a reader of this file
    // could reasonably take that to cover a department's count too. It does not: a
    // department inside a survey with four complete responses has at most four people in
    // it, which is under the segment floor as well. So the one figure this page may print
    // for a withheld survey is the whole survey's, and it prints it above.
    departments: section.isSuppressed ? [] : section.departments,
    withheldDepartments: section.isSuppressed ? 0 : section.suppressedDepartmentCount,
    groups: groupCountOf(section),
    hasOpenText: hasOpenTextOf(section),
    // Already empty for a suppressed section, both server-side and at the parser. Emptied
    // a third time here so this shape cannot carry a distribution or a word cloud that
    // the floor withheld.
    questions: section.isSuppressed ? [] : section.questions,
  }
}

/** The whole document as the page reads it. */
export function viewOf(document: ReportDocument, generatedAt: string | null): SharedReportView {
  const sections = document.surveys.map(sectionOf)
  return {
    generatedAt,
    floor: sections.reduce(
      (highest, section) => Math.max(highest, section.floor),
      ANONYMITY_FLOOR,
    ),
    hasOpenText: sections.some((section) => section.hasOpenText),
    sections,
  }
}
