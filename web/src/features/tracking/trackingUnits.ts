import { formatMetric } from '../../components/charts'
import { toPercent } from './semaforo'

/**
 * The one place that decides what "no value" looks like on the tracking screens.
 *
 * ## This module does NOT convert — `semaforo.toPercent` does
 *
 * That is the whole point of it now. It used to carry its own `fraction * 100`,
 * which made two fraction→percentage conversions in one feature: this one, and
 * `semaforo.toPercent` for the progress bars. Two conversions is how a bar comes
 * to be fed a raw `0.15` while the figure beside it reads "15%", and it is how one
 * of them came to be missing a `Math.round`.
 *
 * `percentagePoints` is a null-aware wrapper around `toPercent` and nothing else.
 * If you need the number, call `toPercent`; if you need "or say it is missing",
 * call `formatPercentOrUnavailable`. There is no third option and no second
 * multiplication in this feature.
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
 * which is exactly what `toPercent` returns.
 */

/**
 * A stored 0–1 fraction as whole percentage points, or `null` when there is no
 * reading.
 *
 * `null` and `undefined` both mean "no value" — the second because a field the API
 * has not grown yet is absent rather than null (see `formatPercentOrUnavailable`).
 * A non-finite number is also no reading: `NaN * 100` is `NaN`, and `formatMetric`
 * would render it as an em dash with no explanation.
 *
 * The scaling itself is `toPercent`'s, so this inherits its rounding and its
 * clamp. The rounding is what stops `0.07` — which is `7.000000000000001` once
 * multiplied — printing as `7,0 %` in a column whose other rows read `8 %`,
 * because `formatMetric` defaults to "no decimals for an integer, one otherwise"
 * and float dust makes a whole percentage look fractional.
 */
export function percentagePoints(fraction: number | null | undefined): number | null {
  if (fraction === null || fraction === undefined) return null
  if (!Number.isFinite(fraction)) return null
  return toPercent(fraction)
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
): string {
  const points = percentagePoints(fraction)
  if (points === null) return unavailable
  return formatMetric(points, { kind: 'percentage' }, locale)
}
