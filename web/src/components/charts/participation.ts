import { formatMetric } from './formatMetric'

/**
 * Response-rate arithmetic and banding for `ParticipationTracker`.
 *
 * Separate from the component so the thresholds — which are policy, not
 * rendering — can be asserted directly, and because the component file may not
 * export non-components (React Fast Refresh; see `foldSlices.ts`).
 */

/** The four bands the legacy component labelled, in descending order. */
export type ParticipationBand = 'excellent' | 'good' | 'fair' | 'low'

/**
 * Percentage of the target that has responded, or `null` when there is no target
 * to measure against.
 *
 * Legacy took `current`, `target` **and** `rate` as three separate props, then
 * used `rate` for the colour and the status text but `target - current` for
 * "remaining" — so a payload where they disagreed rendered a card that
 * contradicted itself, with nothing to say which number was right. The rate is
 * derived here instead: one source of truth, and it cannot drift.
 */
export function participationRate(current: number, target: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return null
  return (current / target) * 100
}

/**
 * Which band a rate falls in. Boundaries are inclusive at the bottom, matching
 * legacy's `>= 80`, `>= 60`, `>= 40`.
 */
export function participationBand(rate: number): ParticipationBand {
  if (rate >= 80) return 'excellent'
  if (rate >= 60) return 'good'
  if (rate >= 40) return 'fair'
  return 'low'
}

/**
 * The status a band represents.
 *
 * **Four bands, three statuses, on purpose.** Legacy gave each band its own hue —
 * green / blue / yellow / red — which quietly enrols `--admin-accent-blue` into
 * the status vocabulary, where it means nothing. Status in this app is exactly
 * three things: green is good, amber is warning, red is critical. So `excellent`
 * and `good` are both good (a 60% response rate is not a warning), `fair` is the
 * warning and `low` is critical. The four-way distinction survives in the
 * *label*, which is where a reader can actually read it, rather than in a hue
 * they would have to have been taught.
 *
 * Returns the status rather than a class name deliberately. Class names written
 * in a `.ts` module are outside what `styles/utilityExistence.test.ts` can sweep
 * (it reads `className` attributes in `.tsx`), so a typo in one would be exactly
 * as invisible as the four dead classes that guard was written to catch. Keeping
 * the mapping to classes in the component keeps it checkable.
 */
export function bandStatus(band: ParticipationBand): 'good' | 'warning' | 'critical' {
  switch (band) {
    case 'excellent':
    case 'good':
      return 'good'
    case 'fair':
      return 'warning'
    case 'low':
      return 'critical'
  }
}

/**
 * Minutes as hours and minutes, in the reader's language.
 *
 * Legacy returned `` `${hours}h ${mins}m` ``, which is English abbreviation baked
 * into a bilingual app — Spanish wants `2 h 30 min`. Composed from
 * `Intl.NumberFormat`'s unit style, so both come out right without either being
 * written down here.
 */
export function formatMinutes(minutes: number, locale?: string): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'

  const whole = Math.floor(minutes)
  if (whole < 60) return formatMetric(whole, { kind: 'duration', unit: 'minute' }, locale)

  const hours = Math.floor(whole / 60)
  const remainder = whole % 60
  const hoursPart = formatMetric(hours, { kind: 'duration', unit: 'hour' }, locale)
  if (remainder === 0) return hoursPart

  return `${hoursPart} ${formatMetric(remainder, { kind: 'duration', unit: 'minute' }, locale)}`
}
