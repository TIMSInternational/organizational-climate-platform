import { waveCode } from '../../../dashboard/next/compose'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { BenchmarkListItem } from '../../api/benchmarks'

/**
 * The pure half of the super administrator's Analítica for one tenant. Pinned by
 * `derive.test.ts`.
 */

export interface ClosedWave {
  code: string
  name: string | null
  endDate: string
  responses: number
}

/** The tenant's most recently closed survey, or `null` when none has closed. */
export function lastClosedSurvey(surveys: readonly SurveyListItem[]): ClosedWave | null {
  const latest = surveys
    .filter((survey) => survey.status === 'closed')
    .sort((a, b) => Date.parse(b.endDate) - Date.parse(a.endDate))[0]
  if (!latest) return null
  return {
    code: waveCode(latest.title, latest.id.slice(0, 8)),
    name: latest.title,
    endDate: latest.endDate,
    responses: latest.responseCount,
  }
}

/** Benchmarks every tenant compares against (`companyId === null`). */
export function globalBenchmarks(all: readonly BenchmarkListItem[]): BenchmarkListItem[] {
  return all.filter((benchmark) => benchmark.companyId === null)
}

/**
 * A reference nobody has scored. The triage's P0 row: "Puntaje de calidad 0,00" on a
 * reference nobody scored reads as a measurement; it says so instead. A quality score is
 * derived from a benchmark's metrics, so zero is what an unmeasured one carries.
 */
export function isUnscored(benchmark: Pick<BenchmarkListItem, 'qualityScore'>): boolean {
  return benchmark.qualityScore === 0
}
