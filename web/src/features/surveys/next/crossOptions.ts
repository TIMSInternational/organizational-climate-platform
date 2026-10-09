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
