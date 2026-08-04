/**
 * Number formatting for the KPI and tracker components.
 *
 * Everything goes through `Intl.NumberFormat`, and the shape below is what forces
 * that. Legacy `KPIDisplay` formatted by string concatenation:
 *
 * ```
 * case 'currency':   return `$${val.toLocaleString()}`
 * case 'percentage': return `${val}%`
 * case 'duration':   return `${val}d`
 * ```
 *
 * Three separate bugs in four lines. The `$` hardcodes US dollars for a
 * Costa Rican client. `${val}%` puts the sign hard against the digits, which is
 * wrong in Spanish — `Intl` renders `78 %` with the space. And `${val}d`
 * abbreviates "days" in English inside an app that ships `es` at full key parity.
 * `toLocaleString()` with no locale argument also reads the *host's* locale, not
 * the one the user picked, so a Spanish user on an English machine got `1,234.5`.
 */

/**
 * What a metric is, which determines how it reads.
 *
 * A discriminated union rather than a `format?: string` plus optional extras,
 * because `Intl.NumberFormat` **throws** on `{ style: 'currency' }` with no
 * currency code ("Currency code is required with currency style") and on an
 * invalid one. Modelling it this way makes a currency metric without a currency a
 * *type* error instead of a runtime crash — the same reason `DialogContent` makes
 * an unlabelled close button a type error.
 */
export type MetricFormat =
  | { kind: 'number'; decimals?: number }
  /** `value` is in percentage points: 78 means 78%, not 7800%. */
  | { kind: 'percentage'; decimals?: number }
  | { kind: 'currency'; currency: string; decimals?: number }
  | { kind: 'duration'; unit: 'minute' | 'hour' | 'day'; decimals?: number }

function digits(decimals: number | undefined, value: number): Intl.NumberFormatOptions {
  // No explicit precision means "however many this number needs, capped at one" —
  // a KPI reading 78.5 is useful, 78.4999999 is noise.
  const places = decimals ?? (Number.isInteger(value) ? 0 : 1)
  return { minimumFractionDigits: places, maximumFractionDigits: places }
}

export function formatMetric(value: number, format: MetricFormat, locale?: string): string {
  if (!Number.isFinite(value)) return '—'

  switch (format.kind) {
    case 'percentage':
      // Divided by 100 because `style: 'percent'` multiplies back up. Going
      // through Intl rather than appending '%' is what gets `78 %` in Spanish and
      // `78%` in English without either being spelled out here.
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        ...digits(format.decimals, value),
      }).format(value / 100)

    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: format.currency,
        // No default precision here, unlike the other kinds. A currency already
        // has a correct number of decimal places — 2 for USD, 0 for JPY — and Intl
        // knows it per currency. Imposing the "cap at 1 decimal" rule below
        // printed `$1,234.5`, dropping a digit off the cents.
        ...(format.decimals === undefined
          ? {}
          : { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals }),
      }).format(value)

    case 'duration':
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: format.unit,
        unitDisplay: 'short',
        ...digits(format.decimals, value),
      }).format(value)

    case 'number':
      return new Intl.NumberFormat(locale, digits(format.decimals, value)).format(value)
  }
}

/**
 * Relative change from `previous` to `current`, as a fraction (0.1 = +10%).
 *
 * Returns `null` when there is no meaningful answer rather than a number that
 * looks like one. Legacy computed
 * `((value - previousValue) / previousValue) * 100` unguarded, so a KPI whose
 * previous value was 0 — a brand new survey, the common case — rendered
 * `Infinity%`, and `0 → 0` rendered `NaN%`.
 *
 * "Up from zero" genuinely has no percentage: every increase from nothing is an
 * infinite one. The caller shows the absolute change instead.
 */
export function deltaFraction(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return (current - previous) / previous
}

/** Sign of a change, with exact equality treated as its own case rather than as a fall. */
export function changeDirection(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current > previous) return 'up'
  if (current < previous) return 'down'
  return 'flat'
}
