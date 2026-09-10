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

/** A 1–5 reading at the one decimal every cell, card and chip prints. */
export function printedReading(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * The canvas's bands around the target, each the upper bound of its step in TENTHS of a
 * point between the PRINTED reading and the target (`build_admin.py`'s `tint()`, drawn
 * against "meta 3,7"): 2,6 and under is far below (step 0), 2,7–3,4 below (1), 3,5–3,7
 * on target (2), 3,8–4,0 above (3), 4,1 and over far above (4). The map's legend names
 * the grey middle band "en la meta", so a 3,5 is on target on every screen that judges one.
 */
export const TARGET_BANDS_TENTHS = [-11, -3, 0, 3] as const

/** An index into `DIVERGING_COLORS` / `DIVERGING_INKS`: 0 far below … 2 on target … 4 far above. */
export type TargetStep = 0 | 1 | 2 | 3 | 4
export type TargetStanding = 'below' | 'on' | 'above'

/**
 * The step a reading takes against the target — the ONE rule behind every tint (the
 * Panel de Control's map, Clima en el tiempo's table) and every "bajo / en / sobre la
 * meta" word, judged at the decimal the page prints. The whole company's Confianza is
 * 3,67 on the wire and prints "3,7" beside "meta 3,7"; judged raw it was "bajo la meta"
 * on one screen and "en la meta" on the other. A mark that contradicts the number
 * beside it is read as a bug, so every mark judges the number the reader sees.
 */
export function targetStep(value: number, target: number): TargetStep {
  const tenths = Math.round(printedReading(value) * 10) - Math.round(printedReading(target) * 10)
  const [farBelow, below, on, above] = TARGET_BANDS_TENTHS
  if (tenths <= farBelow) return 0
  if (tenths <= below) return 1
  if (tenths <= on) return 2
  if (tenths <= above) return 3
  return 4
}

/** The word a step reads as: the two red steps are below, the grey one on, the two blue above. */
export function targetStanding(value: number, target: number): TargetStanding {
  const step = targetStep(value, target)
  return step < 2 ? 'below' : step > 2 ? 'above' : 'on'
}

/** The comparison behind every "bajo la meta" chip and red endpoint — `targetStanding`. */
export function isBelowTarget(value: number, target: number): boolean {
  return targetStanding(value, target) === 'below'
}

/**
 * The move between two readings AS PRINTED: the difference of the rounded readings, never
 * the rounding of the difference. Confianza went 3,33 → 3,67, which the card prints as
 * "3,3" and "3,7"; the raw difference 0,34 printed "+0,3" beside two numbers a reader can
 * subtract to 0,4. `decimals` is the precision the two readings are printed at.
 */
export function printedMove(to: number, from: number, decimals = 1): number {
  const scale = 10 ** decimals
  return (Math.round(to * scale) - Math.round(from * scale)) / scale
}

/**
 * A survey's title as it reads inside a sentence: one trailing parenthetical dropped —
 * "Encuesta de Clima Q4 (abierta)" → "Encuesta de Clima Q4", as the Dashboard artboard
 * writes it in "… lleva 1 de 24 respuestas a 30 días del cierre", where the sentence
 * already says the survey is open. Kept whole when nothing would be left, or when what
 * is left is another listed survey's own title — then the parenthetical is what tells
 * the two apart.
 */
export function sentenceName(title: string, others: readonly string[] = []): string {
  const match = /^(.*\S)\s*\([^()]*\)$/.exec(title.trim())
  if (!match) return title
  const head = match[1]
  return others.some((other) => other.trim() === head) ? title : head
}

/**
 * The head of a name that carries a subtitle after a spaced dash — "Pulso semanal —
 * ¿cómo fue la semana?" → "Pulso semanal", as the artboard's live card names it. A
 * hyphen inside a word is not a subtitle and is left alone.
 */
export function nameHead(name: string): string {
  const head = name.split(/\s[—–]\s/)[0]?.trim()
  return head ? head : name
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
