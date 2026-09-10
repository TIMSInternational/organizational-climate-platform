import { WHOLE_COMPANY_KEY, type ClimateTrendsResponse } from '../../api/climateTrends'
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

/**
 * The payload with every ARCHIVED survey taken out of it, and the points aligned to them.
 *
 * `GET /surveys/climate-trends` answers with the closed-and-archived window
 * (`ReportGeneration.cs:92` names it), so a rehearsal copy that was archived arrives as
 * the newest wave — and the first cut of this page read it as the latest survey: the
 * CLIMA tile said "Encuesta de Clima Q4 (abierta) (Copia)" over an em dash. The list
 * promises the opposite ("Una encuesta archivada no cuenta en Clima en el tiempo"), so
 * an archived survey is removed here, once, before anything reads a wave.
 *
 * `suppressedGroupCount` is recounted over what is left: the server counts groups
 * withheld in every wave of ITS window, and a group disclosed only in an archived wave
 * is, after the cut, withheld in every wave this page shows.
 */
export function withoutArchived(payload: ClimateTrendsResponse): ClimateTrendsResponse {
  const kept = payload.surveys.map((survey, index) => ({ survey, index })).filter(({ survey }) => survey.status !== 'archived')
  const indexes = kept.map(({ index }) => index)
  const groups = payload.groups.map((group) => ({
    ...group,
    points: indexes.flatMap((index) => {
      const point = group.points[index]
      return point === undefined ? [] : [point]
    }),
  }))
  return {
    ...payload,
    surveys: kept.map(({ survey }) => survey),
    groups,
    suppressedGroupCount: groups.filter(
      (group) =>
        group.key !== WHOLE_COMPANY_KEY &&
        group.points.length > 0 &&
        group.points.every((point) => point.isSuppressed),
    ).length,
  }
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
  /** The move since the wave before the latest reading, or `null` when either end is withheld. */
  lastMove: number | null
}

/** Every dimension with a latest reading, judged against the target. */
export function standings(dimensions: readonly TrendDimension[], target: number): DimensionStanding[] {
  return dimensions.flatMap((dimension) => {
    const index = latestIndex(dimension.values)
    const value = index === -1 ? null : (dimension.values[index] ?? null)
    return value === null
      ? []
      : [{ dimension, value, standing: standing(value, target), lastMove: index > 0 ? deltaSince(dimension.values, index - 1) : null }]
  })
}

/**
 * The order the six dimensions are drawn in: by the whole company's latest reading,
 * highest first, ties in the server's column order, a dimension with no reading last.
 * It is the canvas's order (Pertenencia 4,0 … Carga de trabajo 3,3) and it is computed
 * once, from the whole company, so choosing a department redraws the charts in place
 * instead of shuffling them.
 */
export function orderByLatest<T extends TrendDimension>(dimensions: readonly T[]): T[] {
  return dimensions
    .map((dimension, index) => ({ dimension, index, value: latestValue(dimension) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      return b.value - a.value || a.index - b.index
    })
    .map(({ dimension }) => dimension)
}

/** The 0.5-step ticks that enclose every reading and the target — one chart's y axis. */
export function axisTicks(values: readonly (number | null)[], target: number): number[] {
  const present = values.filter((value): value is number => typeof value === 'number')
  const low = Math.floor((Math.min(...present, target) - 0.2) * 2) / 2
  const high = Math.ceil((Math.max(...present, target) + 0.2) * 2) / 2
  const ticks: number[] = []
  for (let tick = low; tick <= high + 1e-9; tick += 0.5) ticks.push(round1(tick))
  return ticks
}

/**
 * ONE y axis for all six charts: the ticks that enclose every reading of every
 * dimension, and the target. Small multiples on six different scales invite the eye to
 * compare slopes that are not comparable — a 0,3 rise on a 1-point axis looks like a
 * 0,6 rise on a half-point one — so the canvas draws all six on 3,0–4,5 and this does
 * the same from the data.
 */
export function sharedAxisTicks(dimensions: readonly TrendDimension[], target: number): number[] {
  return axisTicks(
    dimensions.flatMap((dimension) => dimension.values),
    target,
  )
}
