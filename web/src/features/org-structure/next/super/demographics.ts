import { isSuppressed } from '../../../../components/charts'
import type { DemographicField } from '../../api/demographicFields'
import { peoplePerValue } from '../../components/demographicReach'

/**
 * The arithmetic of the Campos demográficos screen, pure, so
 * `demographics.test.ts` pins it against the tenant's own figures (42 active people).
 *
 * The verdict rides on `peoplePerValue` — the floor of the mean, which is the pigeonhole
 * bound `demographicReach.ts` explains: if `⌊people ÷ values⌋` is under the floor, some
 * value must hold fewer people than the floor. The MEAN is what the screen prints ("10,5
 * por valor"); the two agree on every verdict because the floor is a whole number — a
 * mean at or above 5 has a floor at or above 5, and one below has one below.
 */

export type CutVerdict = 'usable' | 'narrow' | 'not-a-cut' | 'unknown'

/** People per value, unrounded — what the canvas prints. `null` with no values. */
export function meanPerValue(people: number, values: number): number | null {
  if (!Number.isFinite(people) || people < 0 || !Number.isInteger(values) || values <= 0) return null
  return people / values
}

/** A list of `values` values over `people` people clears the floor. */
export function isUsableCut(people: number, values: number, floor: number): boolean {
  const perValue = peoplePerValue(people, values)
  return perValue !== null && !isSuppressed(perValue, floor)
}

/**
 * The smallest number of values at which this sample stops clearing the floor — the
 * canvas's "Con 9 valores la media bajaría a 4,7". `⌊people ÷ floor⌋ + 1`: one value
 * fewer still holds the floor in every value on average, this many cannot. `null` when
 * `values` is already past it, or when no list could ever clear it.
 */
export function tippingPoint(people: number, values: number, floor: number): number | null {
  if (!Number.isFinite(people) || people < floor || floor <= 0) return null
  const point = Math.floor(people / floor) + 1
  return point > values ? point : null
}

/** A field's verdict. Only an active or inactive `select` divides results at all. */
export function fieldVerdict(field: Pick<DemographicField, 'type' | 'options'>, people: number | undefined, floor: number): CutVerdict {
  if (field.type !== 'select') return 'not-a-cut'
  if (people === undefined) return 'unknown'
  return isUsableCut(people, field.options?.length ?? 0, floor) ? 'usable' : 'narrow'
}

/** Cuts actually on offer: active, a list, and clearing the floor — as `DemographicFieldsPage`. */
export function usableCuts(fields: readonly DemographicField[], people: number | undefined, floor: number): number {
  return fields.filter((field) => field.isActive && fieldVerdict(field, people, floor) === 'usable').length
}

/**
 * A stable key from a label, as the canvas's "Antigüedad" → "antiguedad": lower case,
 * accents folded, anything else an underscore. The administrator can still type their own.
 */
export function keyFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
