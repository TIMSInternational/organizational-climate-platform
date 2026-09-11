import { printedMove, printedReading } from '../../../dashboard/next/derive'
import type { TrendDimension, TrendWave } from './model'

/**
 * "Exportar" on Clima en el tiempo: the numbers table as a CSV, built from the SAME model
 * the table draws, so the file can publish nothing the screen withholds:
 *
 * - a wave the floor withheld for the drawn group prints the withheld word in its
 *   respondents cell and in every reading — never a number, and never an empty count
 *   that would read as "nobody answered";
 * - a dimension the wave did not ask is an empty cell, never a zero;
 * - the first → last move is printed only when both ends are readings, and it is the
 *   difference of the two readings as printed (`printedMove`), as on screen.
 *
 * Readings are one decimal with a point, machine-readable like the product's other CSVs
 * (`surveyResultsCsv.ts`), with the same RFC 4180 quoting and the same guard against a
 * payload name that a spreadsheet would run as a formula.
 */
export interface TrendsCsvLabels {
  group: string
  survey: string
  closed: string
  responses: string
  /** The word a withheld wave prints: "protegido". */
  withheld: string
}

export interface TrendsCsvInput {
  /** The drawn group's name: the whole company, or a department. */
  groupName: string
  waves: readonly TrendWave[]
  withheld: readonly boolean[]
  respondents: readonly (number | null)[]
  dimensions: readonly TrendDimension[]
  labels: TrendsCsvLabels
}

const FORMULA_LEAD = /^[=+\-@\t\r]/

/** A name from the payload: neutralised if a spreadsheet would read it as a formula, quoted if it must be. */
function text(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value
  return /["\n\r,]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** A reading at the decimal the page prints. */
function readingCell(value: number): string {
  return printedReading(value).toFixed(1)
}

/** A move with its sign, as the page prints it. */
function moveCell(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

export function buildTrendsCsv(input: TrendsCsvInput): string {
  const { groupName, waves, withheld, respondents, dimensions, labels } = input
  const rows: string[][] = [
    [labels.group, labels.survey, labels.closed, labels.responses, ...dimensions.map((dimension) => dimension.name)].map(text),
  ]
  waves.forEach((wave, index) => {
    const held = withheld[index] === true
    const count = respondents[index]
    rows.push([
      text(groupName),
      text(wave.name?.trim() || wave.code),
      wave.closedAt.slice(0, 10),
      held ? text(labels.withheld) : count === null || count === undefined ? '' : String(count),
      ...dimensions.map((dimension) => {
        if (held) return text(labels.withheld)
        const value = dimension.values[index]
        return value === null || value === undefined ? '' : readingCell(value)
      }),
    ])
  })
  const last = waves.length - 1
  const first = waves[0]
  const latest = waves[last]
  if (first && latest && last > 0) {
    rows.push([
      text(groupName),
      text(`${first.code} → ${latest.code}`),
      '',
      '',
      ...dimensions.map((dimension) => {
        const from = withheld[0] ? null : (dimension.values[0] ?? null)
        const to = withheld[last] ? null : (dimension.values[last] ?? null)
        return from === null || to === null ? '' : moveCell(printedMove(to, from))
      }),
    ])
  }
  // CRLF, per RFC 4180: Excel on Windows renders a bare LF as one long line.
  return rows.map((row) => row.join(',')).join('\r\n')
}
