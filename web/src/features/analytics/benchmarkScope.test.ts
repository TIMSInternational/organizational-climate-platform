import { describe, it, expect } from 'vitest'
import {
  canReadBenchmark,
  canWriteBenchmark,
  isGlobalBenchmark,
  newBenchmarkCompanyId,
  readableBenchmarks,
} from './benchmarkScope'
import type { BenchmarkListItem } from './api/benchmarks'

/**
 * These assertions are transcribed one for one from `CanReadBenchmark` /
 * `CanWriteBenchmark` in `src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs`.
 * If the API's rule moves, these fail — which is the point: a UI that offers an
 * action the API refuses is the bug this pair exists to prevent.
 */

function row(id: string, companyId: string | null): BenchmarkListItem {
  return { id, name: id, type: 'industry', category: 'engagement', companyId, isActive: true, qualityScore: 0 }
}

const OWN = 'company-1'
const OTHER = 'company-2'

describe('canReadBenchmark', () => {
  it('lets a super_admin read anything, including another tenant\'s', () => {
    const scope = { role: 'super_admin', companyId: undefined }
    expect(canReadBenchmark(scope, null)).toBe(true)
    expect(canReadBenchmark(scope, OTHER)).toBe(true)
  })

  it('lets a company_admin read global benchmarks and their own', () => {
    const scope = { role: 'company_admin', companyId: OWN }
    expect(canReadBenchmark(scope, null)).toBe(true)
    expect(canReadBenchmark(scope, OWN)).toBe(true)
  })

  it('does not let a company_admin read another tenant\'s benchmark', () => {
    expect(canReadBenchmark({ role: 'company_admin', companyId: OWN }, OTHER)).toBe(false)
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('denies %s entirely', (role) => {
    expect(canReadBenchmark({ role, companyId: OWN }, null)).toBe(false)
    expect(canReadBenchmark({ role, companyId: OWN }, OWN)).toBe(false)
  })
})

describe('canWriteBenchmark', () => {
  it('lets a super_admin write a global benchmark', () => {
    expect(canWriteBenchmark({ role: 'super_admin', companyId: undefined }, null)).toBe(true)
  })

  /**
   * The #207 hole, restated as a UI rule. A CompanyAdmin READS a global benchmark
   * and must not be offered an edit for it — global rows are visible to every
   * tenant, so a CompanyAdmin editing one changes what every other tenant sees.
   */
  it('does NOT let a company_admin write a global benchmark, even though they can read it', () => {
    const scope = { role: 'company_admin', companyId: OWN }
    expect(canReadBenchmark(scope, null)).toBe(true)
    expect(canWriteBenchmark(scope, null)).toBe(false)
  })

  it('lets a company_admin write their own company\'s benchmark only', () => {
    const scope = { role: 'company_admin', companyId: OWN }
    expect(canWriteBenchmark(scope, OWN)).toBe(true)
    expect(canWriteBenchmark(scope, OTHER)).toBe(false)
  })

  it('does not let a company_admin with no company claim write anything', () => {
    // A global super-admin's claim is the empty string since #191; the page
    // normalises that to undefined, and an undefined company must not match a
    // benchmark's null owner by accident.
    const scope = { role: 'company_admin', companyId: undefined }
    expect(canWriteBenchmark(scope, null)).toBe(false)
    expect(canWriteBenchmark(scope, OWN)).toBe(false)
  })
})

describe('isGlobalBenchmark', () => {
  it('is true exactly when companyId is null', () => {
    expect(isGlobalBenchmark(row('a', null))).toBe(true)
    expect(isGlobalBenchmark(row('b', OWN))).toBe(false)
  })
})

describe('readableBenchmarks', () => {
  it('drops another tenant\'s row for a company_admin even if the API returned it', () => {
    const result = readableBenchmarks({ role: 'company_admin', companyId: OWN }, [
      row('global', null),
      row('own', OWN),
      row('leaked', OTHER),
    ])
    expect(result.map((benchmark) => benchmark.id)).toEqual(['global', 'own'])
  })

  it('keeps every row for a super_admin, which is the genuine cross-company view', () => {
    const result = readableBenchmarks({ role: 'super_admin', companyId: undefined }, [
      row('global', null),
      row('a', OWN),
      row('b', OTHER),
    ])
    expect(result).toHaveLength(3)
  })
})

describe('newBenchmarkCompanyId', () => {
  it('creates global benchmarks for a super_admin', () => {
    expect(newBenchmarkCompanyId({ role: 'super_admin', companyId: undefined })).toBeNull()
  })

  it('creates company-scoped benchmarks for a company_admin', () => {
    expect(newBenchmarkCompanyId({ role: 'company_admin', companyId: OWN })).toBe(OWN)
  })

  it('returns undefined -- meaning "hide the form" -- for anyone who may not create', () => {
    expect(newBenchmarkCompanyId({ role: 'company_admin', companyId: undefined })).toBeUndefined()
    expect(newBenchmarkCompanyId({ role: 'employee', companyId: OWN })).toBeUndefined()
    expect(newBenchmarkCompanyId({ role: undefined, companyId: OWN })).toBeUndefined()
  })
})
