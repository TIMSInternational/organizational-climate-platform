import { waveCode } from '../../../dashboard/next/compose'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { BenchmarkListItem } from '../../api/benchmarks'
import type { TranslateFn } from '../../../../i18n'
import type { Company } from '../../../org-structure/api/companies'
import { sizeText } from '../../../org-structure/next/super/labels'

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

/**
 * The tenant as a sentence names it — "servicios, mediana" — from its own record's sector
 * and size (`GET /admin/companies`), lower-cased mid-sentence in the reader's language.
 * Empty when the record carries neither, so the caller can fall back to a sentence that
 * does not name them.
 */
export function companyProfile(
  company: Pick<Company, 'industry' | 'size'> | null,
  t: TranslateFn,
  locale: string,
): string {
  if (!company) return ''
  return [company.industry?.trim() || null, sizeText(t, company.size)]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.toLocaleLowerCase(locale))
    .join(', ')
}

/** "Sector · from–to unit", the shape the server gives a cohort benchmark's localised name. */
const COHORT_NAME = /^(.+?)\s*·\s*(\d[\d.,]*)\s*[–-]\s*(\d[\d.,]*)\s+(.+)$/u

/**
 * A cohort benchmark's name as the canvas writes it inside a sentence: "Manufactura ·
 * 500–1000 personas" reads "manufactura, de 500 a 1000 personas". The name the server
 * localises is the only source: the detail's `industry` and `companySize` are null on the
 * platform's global row (measured `GET /admin/benchmarks/{id}`, 10 Sep, in both languages).
 * A name of any other shape is returned as it is, never guessed at.
 */
export function cohortPhrase(name: string, t: TranslateFn, locale: string): string {
  const match = COHORT_NAME.exec(name.trim())
  if (!match) return name
  const [, sector, from, to, unit] = match
  return t('superadmin.next.analytics.refs.cohort', { sector: sector.toLocaleLowerCase(locale), from, to, unit })
}
