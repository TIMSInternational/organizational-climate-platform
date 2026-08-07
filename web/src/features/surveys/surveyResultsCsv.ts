import type {
  SurveyAnalyticsResponse,
  SurveyBreakdown,
  SurveyQuestionResult,
} from './api/surveyResults'
import { bucketLabel } from './surveyResultsView'

/**
 * CSV serialisation of **what is on the screen**, which is not the same thing as the
 * survey's data.
 *
 * ## Why this exists here rather than waiting for #122
 *
 * #122 (server-side CSV and PDF export) is still open, so there is no export endpoint
 * to wire an action to. These two functions are deliberately *not* a client-side
 * reimplementation of it: #122 exports the underlying responses, this exports the
 * already-aggregated, already-suppressed payload the page received. That distinction is
 * the reason it is safe to build now — every privacy decision was taken by
 * `SurveyAggregation` before the bytes reached the browser, so there is no floor to
 * re-derive here and no way for this file to disagree with the page above it or to leak
 * something the page does not already show.
 *
 * When #122 lands, a *raw* export belongs to it. This one should stay, or be moved
 * behind it, but it must not be replaced by an export that re-derives suppression on a
 * second code path.
 *
 * ## Withheld is a value, not an empty cell
 *
 * A suppressed segment is written as the caller's `withheld` marker in every measured
 * column. Writing `0` would state that nobody in that group answered; writing an empty
 * cell would let a spreadsheet sum the column and recover the withheld headcount by
 * subtraction, which is the inference the suppression exists to block. The word is
 * neither, and it survives being pasted into a deck.
 */

/** Already-translated column headings and markers. Nothing in this module translates. */
export interface CsvLabels {
  questionOrder: string
  questionText: string
  questionType: string
  optionValue: string
  optionLabel: string
  count: string
  percentage: string
  average: string
  dimension: string
  segment: string
  respondents: string
  participationRate: string
  /** What a withheld measurement reads as. */
  withheld: string
  /** What an absent measurement reads as — a gap, not a suppression. */
  notApplicable: string
  /** Row label for responses that carry no value for the dimension at all. */
  unsegmented: string
}

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * Question text and option labels are authored by users, so `=HYPERLINK(...)` can
 * genuinely reach this file. A leading apostrophe is the standard neutralisation: Excel
 * and Sheets both consume it and display the literal text, and a plain-text reader sees
 * one visible stray character rather than executing anything.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'number' ? String(value) : value
  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text
  // RFC 4180: quote when the field contains a quote, a delimiter or a line break, and
  // escape an embedded quote by doubling it.
  return /["\n\r,]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  // CRLF, per RFC 4180. Excel on Windows renders a bare LF as one long line.
  return rows.map((row) => row.map(cell).join(',')).join('\r\n')
}

/**
 * One row per distribution bucket.
 *
 * Open-ended questions produce one row with no bucket: their answers are word
 * frequencies, and a word cloud is not a distribution over a fixed option set. Dropping
 * them entirely would make the export claim the survey had fewer questions than it did.
 */
export function buildQuestionResultsCsv(
  questions: readonly SurveyQuestionResult[],
  labels: CsvLabels,
): string {
  const rows: (string | number | null)[][] = [
    [
      labels.questionOrder,
      labels.questionText,
      labels.questionType,
      labels.optionValue,
      labels.optionLabel,
      labels.count,
      labels.percentage,
      labels.average,
    ],
  ]

  for (const question of questions) {
    if (question.distribution.length === 0) {
      rows.push([
        question.order,
        question.text,
        question.type,
        null,
        null,
        question.answeredCount,
        null,
        question.average ?? labels.notApplicable,
      ])
      continue
    }

    for (const bucket of question.distribution) {
      rows.push([
        question.order,
        question.text,
        question.type,
        bucket.value,
        bucketLabel(bucket),
        bucket.count,
        bucket.percentage,
        question.average ?? labels.notApplicable,
      ])
    }
  }

  return toCsv(rows)
}

/**
 * One row per segment, across every breakdown, plus one row per breakdown for the
 * responses that fell outside every segment.
 *
 * Both the withheld segments and the unsegmented remainder are written out, so the
 * respondent column of one dimension sums to the survey's completed count and a reader
 * can see *why* it does rather than discovering a shortfall.
 */
export function buildBreakdownCsv(
  breakdowns: readonly SurveyBreakdown[],
  labels: CsvLabels,
): string {
  const rows: (string | number | null)[][] = [
    [labels.dimension, labels.segment, labels.respondents, labels.participationRate],
  ]

  for (const breakdown of breakdowns) {
    for (const segment of breakdown.segments) {
      rows.push([
        breakdown.dimension,
        segment.label ?? segment.key,
        segment.isSuppressed ? labels.withheld : segment.respondentCount,
        segment.isSuppressed
          ? labels.withheld
          : (segment.participationRate ?? labels.notApplicable),
      ])
    }

    if (breakdown.unsegmentedRespondentCount > 0) {
      rows.push([
        breakdown.dimension,
        labels.unsegmented,
        breakdown.unsegmentedRespondentCount,
        labels.notApplicable,
      ])
    }
  }

  return toCsv(rows)
}

/** A stable, filesystem-safe file name. Not copy: it is an identifier a user never reads as prose. */
export function resultsFileName(payload: SurveyAnalyticsResponse, suffix: string): string {
  return `survey-${payload.surveyId}-${suffix}.csv`
}
