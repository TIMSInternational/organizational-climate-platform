import type { TrendDimension } from './model'

/**
 * Pure derivations for Clima en el tiempo. No formatting here beyond what
 * `features/dashboard/next/derive.ts` already exports (`reading`, `signedReading`);
 * this file answers "what is the number", the view answers "how does it read".
 */

export type Standing = 'above' | 'on' | 'below'

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Where a reading sits against the target, at the one-decimal precision the page prints. */
export function standing(value: number, target: number): Standing {
  const shown = round1(value)
  const goal = round1(target)
  if (shown > goal) return 'above'
  if (shown < goal) return 'below'
  return 'on'
}

/** Index of the latest disclosed reading, or `-1` when every wave is withheld. */
export function latestIndex(values: readonly (number | null)[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && values[index] !== undefined) return index
  }
  return -1
}

/** The latest disclosed reading of a dimension, or `null`. */
export function latestValue(dimension: TrendDimension): number | null {
  const index = latestIndex(dimension.values)
  return index === -1 ? null : (dimension.values[index] ?? null)
}

/**
 * The change from the reading at `fromIndex` to the latest disclosed one. `null` when
 * either endpoint is withheld: `latest − from` printed beside one disclosed endpoint
 * would reconstruct the other. A withheld wave *between* the endpoints does not void
 * the delta — both readings are already on the page, and the difference of two
 * disclosed numbers says nothing about the wave between them.
 */
export function deltaSince(values: readonly (number | null)[], fromIndex: number): number | null {
  const to = latestIndex(values)
  if (to === -1 || fromIndex < 0 || fromIndex >= to) return null
  const from = values[fromIndex]
  const latest = values[to]
  if (from === null || from === undefined || latest === null || latest === undefined) return null
  return latest - from
}

/** Mean of the disclosed dimension readings of one wave, or `null` when there are none. */
export function waveMean(dimensions: readonly TrendDimension[], index: number): number | null {
  const present = dimensions
    .map((dimension) => dimension.values[index])
    .filter((value): value is number => typeof value === 'number')
  if (present.length === 0) return null
  return present.reduce((sum, value) => sum + value, 0) / present.length
}

export interface DimensionStanding {
  dimension: TrendDimension
  value: number
  standing: Standing
}

/** Every dimension with a latest reading, judged against the target. */
export function standings(dimensions: readonly TrendDimension[], target: number): DimensionStanding[] {
  return dimensions.flatMap((dimension) => {
    const value = latestValue(dimension)
    return value === null ? [] : [{ dimension, value, standing: standing(value, target) }]
  })
}

/** The 0.5-step ticks that enclose every reading and the target — the chart's y axis. */
export function axisTicks(values: readonly (number | null)[], target: number): number[] {
  const present = values.filter((value): value is number => typeof value === 'number')
  const low = Math.floor((Math.min(...present, target) - 0.2) * 2) / 2
  const high = Math.ceil((Math.max(...present, target) + 0.2) * 2) / 2
  const ticks: number[] = []
  for (let tick = low; tick <= high + 1e-9; tick += 0.5) ticks.push(round1(tick))
  return ticks
}
