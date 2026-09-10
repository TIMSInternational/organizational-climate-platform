import type { AdminDashboardModel, MapRow } from './model'
import { isSuppressed } from '../../../components/charts'

/**
 * Every derived reading on the redesigned Panel de Control, as pure functions of
 * the model. The page never carries a computed number as a literal: the mockup's
 * "3,67", "+0,32", "100 %", "bajo la meta" are all outputs of these.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** The company-wide climate average of the closed wave at `index` (oldest first). */
export function waveAverage(model: AdminDashboardModel, index: number): number | null {
  const readings = model.dimensions
    .map((dimension) => dimension.values[index])
    .filter((value): value is number => value !== undefined)
  return mean(readings)
}

/** How many closed waves the dimension series cover. */
export function closedWaveCount(model: AdminDashboardModel): number {
  return Math.min(...model.dimensions.map((dimension) => dimension.values.length))
}

export function latestAverage(model: AdminDashboardModel): number | null {
  return waveAverage(model, closedWaveCount(model) - 1)
}

export function previousAverage(model: AdminDashboardModel): number | null {
  const count = closedWaveCount(model)
  return count >= 2 ? waveAverage(model, count - 2) : null
}

/** Consecutive wave-over-wave rises of the company average, ending at the latest wave. */
export function risesInARow(model: AdminDashboardModel): number {
  let rises = 0
  for (let index = closedWaveCount(model) - 1; index >= 1; index -= 1) {
    const current = waveAverage(model, index)
    const earlier = waveAverage(model, index - 1)
    if (current === null || earlier === null || current <= earlier) break
    rises += 1
  }
  return rises
}

/**
 * The one comparison behind every "below target" mark on the page — judged at the one
 * decimal the page prints. The whole company's Confianza is 3,67 on the wire and prints
 * "3,7" beside "meta 3,7"; a strict `3.67 < 3.7` marked it "bajo la meta" there while
 * Clima en el tiempo, which judges the printed reading, called it "en la meta". A mark
 * that contradicts the number beside it is read as a bug, so both screens judge the
 * number the reader sees.
 */
export function isBelowTarget(value: number, target: number): boolean {
  return Math.round(value * 10) < Math.round(target * 10)
}

/**
 * The slot after `code` in a quarterly cycle — "Q1 2027" after a Q4 that closes in 2026,
 * "Q3" after "Q2" — or `null` when `code` is not a quarter. It labels the rail's hollow
 * "por planificar" step: a slot of the cycle, never a claim that a survey exists.
 */
export function nextWaveCode(code: string, isoDate: string | undefined): string | null {
  const match = /^Q([1-4])(?:\s+(\d{4}))?$/.exec(code.trim())
  if (!match) return null
  const quarter = Number(match[1])
  if (quarter < 4) return match[2] ? `Q${quarter + 1} ${match[2]}` : `Q${quarter + 1}`
  const year = match[2] ? Number(match[2]) : isoDate ? new Date(isoDate).getUTCFullYear() : Number.NaN
  return Number.isNaN(year) ? null : `Q1 ${year + 1}`
}

/** `part` of `whole` as a 0–100 percentage, or `null` when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}

/** Whole days from `from` to `to`, both ISO dates; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
}

/** Rows the map will hatch: under the floor, so no reading of theirs is ever printed. */
export function protectedRows(model: AdminDashboardModel, floor: number): MapRow[] {
  return model.map.rows.filter((row) => isSuppressed(row.responses, floor))
}

export interface MapCell {
  row: MapRow
  dimensionKey: string
  score: number
}

/** The lowest cell among DISCLOSED rows. A protected row cannot be the lowest anything. */
export function lowestCell(model: AdminDashboardModel, floor: number): MapCell | null {
  let lowest: MapCell | null = null
  for (const row of model.map.rows) {
    if (isSuppressed(row.responses, floor)) continue
    row.scores.forEach((score, index) => {
      const dimensionKey = model.map.dimensionKeys[index]
      if (dimensionKey !== undefined && (lowest === null || score < lowest.score)) {
        lowest = { row, dimensionKey, score }
      }
    })
  }
  return lowest
}

/** A 1–5 reading in the reader's locale: `3.67` → "3,67" in Spanish. */
export function reading(value: number, locale: string, decimals = 1): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** A delta with its sign always shown: `0.32` → "+0,32". */
export function signedReading(value: number, locale: string, decimals = 1): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: 'always',
  })
}

/** A 0–100 value as a localised percentage: `100` → "100 %" in Spanish. */
export function percentReading(value: number, locale: string): string {
  return (value / 100).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 })
}
