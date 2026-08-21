import { formatMetric } from '../../components/charts'

/**
 * The unit conversion every reading on these two screens goes through, and the
 * one place that decides what "no value" looks like.
 *
 * ## The tracking service stores fractions, not percentages
 *
 * `porcentaje_avance` is a `numeric(5,4)` in the 0–1 range. Three independent
 * confirmations, because getting this wrong renders 87% as 0.87% or 8700%:
 *
 * - `PlanDeAccion.MarcarCumplido` sets `PorcentajeAvance = 1m` for a finished plan.
 * - `PlanDeAccion.RegistrarAvance` rejects anything outside `0..1` with
 *   "porcentaje_avance debe estar entre 0 y 1", and `CalcularAvanceEsperado`
 *   divides its milestone percentages by `100m` to get into the same space.
 * - The client's own JSON Schema gives it `minimum 0, maximum 1`.
 *
 * The functional document's "0-100%" is display units, i.e. what this module
 * produces — not what the API returns. `resultado_anio_anterior_pct` is the same
 * shape: `numeric(5,4)` on the migration, `decimal?` on `HallazgoDto`.
 *
 * `formatMetric`'s `percentage` kind takes **percentage points** (`78` means 78%),
 * so a fraction has to be multiplied here before it goes in. Doing that at the one
 * call site rather than in each page is the point of this module.
 */

/**
 * A stored 0–1 fraction as the percentage points `formatMetric` wants, or `null`
 * when there is no reading.
 *
 * `null` and `undefined` both mean "no value" — the second because a field the API
 * has not grown yet is absent rather than null (see `formatPercentOrUnavailable`).
 * A non-finite number is also no reading: `NaN * 100` is `NaN`, and `formatMetric`
 * would render it as an em dash with no explanation.
 */
export function percentagePoints(fraction: number | null | undefined): number | null {
  if (fraction === null || fraction === undefined) return null
  if (!Number.isFinite(fraction)) return null
  return fraction * 100
}

/**
 * A stored fraction as localised percent text, or the caller's already-translated
 * "not available" copy.
 *
 * ## Zero is a reading and absence is not
 *
 * This is the distinction the whole helper exists for, and #125's acceptance
 * criteria name it: a null `resultado_anio_anterior_pct` must render as
 * *unavailable*, never as `0 %`. They are different claims — "we compared, and the
 * change is nothing" against "there is nothing to compare against" — and printing
 * the first when you mean the second invents a fact for a reader who has no way to
 * check it. The mirror matters just as much and is easier to break by accident: a
 * genuine `0` must print `0 %`, so a `value || unavailable` shortcut is wrong in
 * the other direction.
 *
 * `trackingUnits.test.ts` pins both halves.
 *
 * @param unavailable already-translated copy for the absent case, e.g. "No disponible"
 */
export function formatPercentOrUnavailable(
  fraction: number | null | undefined,
  unavailable: string,
  locale?: string,
  decimals?: number,
): string {
  const points = percentagePoints(fraction)
  if (points === null) return unavailable
  return formatMetric(points, { kind: 'percentage', decimals }, locale)
}
