import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for `/admin/benchmarks` (BenchmarkEndpoints.cs).
 *
 * **`companyId` is nullable, and the null is load-bearing.** A benchmark with
 * `companyId === null` is a GLOBAL benchmark: every tenant can read it for comparison,
 * but only a SuperAdmin may write it (`CanWriteBenchmark` -- a CompanyAdmin writing a row
 * every other tenant reads was the P0 that #207 closed). A page must therefore be able to
 * tell the two apart, which is why this is modelled as `string | null` rather than as a
 * required id.
 *
 * As with reports, the list projection and the detail are separate types: `GET
 * /admin/benchmarks` returns `BenchmarkListItem` (no description, source, region or
 * metrics), everything else returns `BenchmarkDetail`.
 */

/** A single metric attached to a benchmark -- see `BenchmarkMetricDto` in BenchmarkDtos.cs. */
export interface BenchmarkMetric {
  id: string
  metricName: string
  value: number
  unit: string
  percentile: number | null
  sampleSize: number | null
}

/** A row of `GET /admin/benchmarks` -- see `BenchmarkListItem` in BenchmarkDtos.cs. */
export interface BenchmarkListItem {
  id: string
  name: string
  type: string
  category: string
  /** `null` means a global benchmark, readable by every tenant. */
  companyId: string | null
  isActive: boolean
  qualityScore: number
}

/** The full record returned by create/get/update/add-metric -- `BenchmarkDetail`. */
export interface Benchmark {
  id: string
  name: string
  description: string
  type: string
  category: string
  source: string
  industry: string | null
  companySize: string | null
  region: string | null
  /** `null` means a global benchmark, readable by every tenant, writable only by a SuperAdmin. */
  companyId: string | null
  isActive: boolean
  validationStatus: string
  qualityScore: number
  priorPeriodBenchmarkId: string | null
  metrics: BenchmarkMetric[]
}

export interface CreateBenchmarkInput {
  name: string
  description: string
  type: string
  category: string
  source: string
  industry?: string
  companySize?: string
  region?: string
  /**
   * Required to state, and nullable on purpose. `null` creates a GLOBAL benchmark, which
   * the backend allows only for a SuperAdmin -- a CompanyAdmin who reached this by
   * forgetting to pass their own company id would get a bare 403 with no clue why. Making
   * the caller write the `null` makes that a decision rather than an omission.
   */
  companyId: string | null
  priorPeriodBenchmarkId?: string
}

/**
 * Deliberately narrower than `CreateBenchmarkInput`, mirroring `UpdateBenchmarkRequest`:
 * `type`, `category`, `source`, `companyId` and `priorPeriodBenchmarkId` are immutable
 * after creation and `PUT` silently ignores them, so they are not offered here.
 */
export interface UpdateBenchmarkInput {
  name: string
  description: string
  industry?: string
  companySize?: string
  region?: string
}

export interface AddBenchmarkMetricInput {
  metricName: string
  value: number
  unit: string
  percentile?: number
  sampleSize?: number
}

/**
 * Lists benchmarks visible to the caller.
 *
 * `companyId` is a SuperAdmin-only filter and is optional (so it goes last). For a
 * CompanyAdmin the backend ignores it entirely and always returns global benchmarks plus
 * that admin's own company's -- passing another company's id does not widen the result.
 */
export async function listBenchmarks(baseUrl: string, companyId?: string): Promise<BenchmarkListItem[]> {
  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
  const response = await authFetch(`${baseUrl}/admin/benchmarks${query}`)
  return response.json() as Promise<BenchmarkListItem[]>
}

export async function createBenchmark(baseUrl: string, input: CreateBenchmarkInput): Promise<Benchmark> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Benchmark>
}

export async function getBenchmark(baseUrl: string, id: string): Promise<Benchmark> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}`)
  return response.json() as Promise<Benchmark>
}

export async function updateBenchmark(baseUrl: string, id: string, input: UpdateBenchmarkInput): Promise<Benchmark> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Benchmark>
}

/** Adds a metric and returns the whole benchmark, with the new metric already in `metrics`. */
export async function addBenchmarkMetric(baseUrl: string, id: string, input: AddBenchmarkMetricInput): Promise<Benchmark> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}/metrics`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Benchmark>
}
