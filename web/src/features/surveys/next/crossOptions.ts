import type { SurveyAnalyticsResponse, SurveySegmentSelector } from '../api/surveyResults'

/**
 * The values a results cross can be narrowed by, derived from the breakdowns the
 * unfiltered payload already carries.
 *
 * ## Why the options come from the payload and not from a second request
 *
 * `SurveyBreakdown` already enumerates every department and every demographic value the
 * survey's responses carry, suppressed ones included — the page draws them as protected
 * rows. So the picker needs no endpoint of its own, and more importantly it can offer no
 * value the reader could not already see listed on the same screen: choosing a cross
 * discloses nothing that was not already disclosed.
 *
 * ## Suppressed values are still offered
 *
 * Deliberately. Picking one returns the server's refusal, which says the cross is too small
 * to show and nothing at all about how small. Hiding those values instead would leave the
 * reader guessing which crosses exist, and the first thing they would do is guess.
 */
export interface CrossValue {
  /** `'department'`, or the demographic field key. */
  field: string
  /** The stable key the server groups on — a department id, or a demographic code. */
  value: string
  /** What to show. Falls back to the key: a suppressed segment carries no label. */
  label: string
}

export interface CrossField {
  field: string
  values: CrossValue[]
}

/**
 * One entry per breakdown that offers a real choice.
 *
 * A field with a single value is left out: narrowing to it selects everyone who has that
 * value, which is a control that cannot change the answer and reads as though it could.
 */
export function crossFieldsOf(payload: SurveyAnalyticsResponse | null): CrossField[] {
  if (!payload) return []
  return payload.breakdowns
    .map((breakdown) => ({
      field: breakdown.dimension,
      values: breakdown.segments
        .map((segment) => ({
          field: breakdown.dimension,
          value: segment.key,
          label: segment.label ?? segment.key,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((entry) => entry.values.length > 1)
}

/**
 * The chosen values as the selectors the API takes, in the order the fields were offered —
 * stable, so the same cross produces the same request and the same cache key.
 */
export function selectorsOf(
  fields: readonly CrossField[],
  chosen: Readonly<Record<string, string>>,
): SurveySegmentSelector[] {
  return fields
    .filter((entry) => chosen[entry.field] !== undefined && chosen[entry.field] !== '')
    .map((entry) => ({ field: entry.field, value: chosen[entry.field]! }))
}

/** A stable key for one cross, used to tell "already asked" from "asked again". */
export function crossKeyOf(selectors: readonly SurveySegmentSelector[]): string {
  return selectors.map((s) => `${s.field}:${s.value}`).join('|')
}

/** The label a chosen value was offered under, for the summary line. */
export function labelFor(
  fields: readonly CrossField[],
  selector: SurveySegmentSelector,
): string {
  const field = fields.find((entry) => entry.field === selector.field)
  return field?.values.find((v) => v.value === selector.value)?.label ?? selector.value
}

/**
 * One cohort in a comparison: the selectors that define it. An EMPTY list is the whole
 * survey, which is always the first column so every contrast has a reference.
 */
export type Cohort = SurveySegmentSelector[]

/** The whole survey's key. Distinct from any real cohort's, which always carries a colon. */
export const BASELINE_KEY = ''

/**
 * The cohort's name, built from the labels the picker offered rather than from the stored
 * keys, so a department reads as "Finanzas" and not as a GUID.
 */
export function cohortLabel(
  fields: readonly CrossField[],
  cohort: Cohort,
  wholeSurvey: string,
): string {
  return cohort.length === 0 ? wholeSurvey : cohort.map((s) => labelFor(fields, s)).join(' + ')
}

/**
 * Adds a cohort unless an identical one is already there.
 *
 * Compared by key, not by reference: "Finanzas + gerencia" chosen twice is one column, and a
 * table with the same cohort twice invites the reader to look for a difference between them.
 */
export function withCohort(cohorts: readonly Cohort[], candidate: Cohort, max: number): Cohort[] {
  if (candidate.length === 0 || cohorts.length >= max) return [...cohorts]
  const key = crossKeyOf(candidate)
  return cohorts.some((c) => crossKeyOf(c) === key) ? [...cohorts] : [...cohorts, candidate]
}

/**
 * The categories to show, in the baseline's order with any extras appended.
 *
 * Driven by the baseline rather than by the first cohort: the rows then stay put as cohorts are
 * added and removed, so a reader comparing two columns is not also re-finding the row.
 */
export function categoriesOf(payloads: readonly (SurveyAnalyticsResponse | null)[]): string[] {
  const seen: string[] = []
  for (const payload of payloads) {
    for (const dimension of payload?.dimensions ?? []) {
      if (!seen.includes(dimension.dimension)) seen.push(dimension.dimension)
    }
  }
  return seen
}

/** The category a cohort scored lowest on, for a follow-up's description. Null when none is scored. */
export function weakestCategory(
  payload: SurveyAnalyticsResponse | null,
): { dimension: string; averageScore: number } | null {
  const scored = (payload?.dimensions ?? []).filter(
    (d): d is typeof d & { averageScore: number } => d.averageScore !== null,
  )
  if (scored.length === 0) return null
  return scored.reduce((worst, d) => (d.averageScore < worst.averageScore ? d : worst))
}
