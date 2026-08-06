import type { Benchmark, BenchmarkListItem } from './api/benchmarks'

/**
 * The client-side mirror of `BenchmarkEndpoints.CanReadBenchmark` /
 * `CanWriteBenchmark`.
 *
 * ## Why the read and write rules are two functions and not one
 *
 * A benchmark with `companyId === null` is **global**: every tenant reads it so
 * that a company can compare itself against an industry figure, but only a
 * SuperAdmin may write it. Collapsing that into a single "can I touch this row"
 * check is exactly the multi-tenant hole #207 closed on the API — a CompanyAdmin
 * editing a row every other tenant reads. The UI has to model the same split, or
 * it renders an Edit button that 403s and tells the admin nothing about why.
 *
 * These are **not** a security boundary — the API is. They exist so the page can
 * (a) not offer an action the backend will refuse, and (b) refuse to render a row
 * outside the caller's tenant even if one somehow arrives in a response body.
 *
 * The role strings match the JWT `role` claim (`auth/jwt.ts`), which is the same
 * vocabulary `navigation/navSections.ts` and `app/resolveInitialRoute.ts` use.
 */
export const SUPER_ADMIN = 'super_admin'
export const COMPANY_ADMIN = 'company_admin'

/** A row's owner: `null` for a global benchmark, otherwise the owning company id. */
export type BenchmarkScope = { role: string | undefined; companyId: string | undefined }

/**
 * Mirrors `CanReadBenchmark`. SuperAdmin short-circuits first, exactly as the
 * handler does; a CompanyAdmin reads global rows plus their own company's; every
 * other role reads nothing.
 */
export function canReadBenchmark(scope: BenchmarkScope, benchmarkCompanyId: string | null): boolean {
  if (scope.role === SUPER_ADMIN) return true
  if (scope.role !== COMPANY_ADMIN) return false
  return benchmarkCompanyId === null || scope.companyId === benchmarkCompanyId
}

/**
 * Mirrors `CanWriteBenchmark`. The one difference from {@link canReadBenchmark}
 * is the `null` case, and it is the whole point: a global benchmark is readable
 * by a CompanyAdmin and writable only by a SuperAdmin.
 */
export function canWriteBenchmark(scope: BenchmarkScope, benchmarkCompanyId: string | null): boolean {
  if (scope.role === SUPER_ADMIN) return true
  if (scope.role !== COMPANY_ADMIN) return false
  return benchmarkCompanyId !== null && scope.companyId === benchmarkCompanyId
}

export function isGlobalBenchmark(benchmark: BenchmarkListItem | Benchmark): boolean {
  return benchmark.companyId === null
}

/**
 * Defence in depth for the list.
 *
 * `GET /admin/benchmarks` already scopes its result to the caller, so for a
 * well-behaved API this is the identity function. It is applied anyway because
 * every downstream surface on this page — the comparison matrix in particular —
 * is built from whatever rows reach it, and a comparison is the one place where a
 * leaked row would be quietly averaged into another tenant's picture of itself
 * rather than standing out as obviously foreign.
 */
export function readableBenchmarks<T extends BenchmarkListItem>(scope: BenchmarkScope, benchmarks: T[]): T[] {
  return benchmarks.filter((benchmark) => canReadBenchmark(scope, benchmark.companyId))
}

/**
 * Which company a benchmark created from this page belongs to.
 *
 * A CompanyAdmin can only ever create rows for their own company, so the id comes
 * off their token rather than off a form field. A SuperAdmin creates **global**
 * rows (`null`): they are the only role permitted to, and the alternative —
 * letting a SuperAdmin pick an arbitrary tenant — needs a company picker this app
 * does not have yet. `ActionPlansListPage` blocks SuperAdmin outright for the same
 * missing picker; here there is a genuine SuperAdmin-shaped action available
 * without one, so the page offers that instead of nothing. Revisit when #57
 * (cross-cutting company-context selector) lands.
 *
 * Returns `undefined` for a caller who may not create at all, so the page can
 * hide the form rather than build a request the API will refuse.
 */
export function newBenchmarkCompanyId(scope: BenchmarkScope): string | null | undefined {
  if (scope.role === SUPER_ADMIN) return null
  if (scope.role === COMPANY_ADMIN && scope.companyId) return scope.companyId
  return undefined
}
