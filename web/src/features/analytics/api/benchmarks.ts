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

/**
 * What the API knows about a benchmark's prior period -- `PriorPeriodStatuses` in
 * `ClimateProject.Domain`.
 *
 * **The three values are three different sentences, and the point of the type is that a
 * screen cannot print one over another.** `priorPeriodBenchmarkId === null` used to be
 * everything the browser had, and it conflated `'none'` with `'unlinked'`: a first-year
 * company with genuinely nothing before it, and a benchmark nobody has got round to
 * linking, both rendered as "This benchmark does not link to a prior period." The first is
 * a fact about the company and the second is a fact about our own data entry, and the
 * reader had no way to tell which they were looking at. #89 gives the API a third value so
 * the page can stop guessing.
 */
export type PriorPeriodStatus = 'unlinked' | 'linked' | 'none'

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
  priorPeriodStatus: PriorPeriodStatus
}

/**
 * One metric read against the same metric in the prior period -- `BenchmarkMetricChangeDto`.
 *
 * `value` is null when only the prior period recorded this metric, `priorValue` when only
 * this one did. `delta` is additionally null when the two periods recorded the metric in
 * different units: `BenchmarkMetric.Unit` is a free string, and 1.2 s against 1200 ms
 * differenced reads as a catastrophe that did not happen. Both units come back so a screen
 * can say why the change is missing rather than print a dash.
 */
export interface BenchmarkMetricChange {
  metricName: string
  value: number | null
  unit: string | null
  priorValue: number | null
  priorUnit: string | null
  delta: number | null
  /** `delta` as a fraction of `priorValue`; null when `delta` is null or `priorValue` is 0. */
  changeRatio: number | null
}

/**
 * The prior period a benchmark links to, already differenced against it by the server.
 *
 * Present only when `priorPeriodStatus` is `'linked'` **and** the caller may read the linked
 * row: a link written before #89 could point at another tenant's benchmark, and the detail
 * route omits the comparison rather than handing over numbers the caller cannot otherwise
 * see. So `priorPeriodStatus === 'linked'` with `priorPeriod === null` is a real, meaningful
 * state and not a loading one.
 */
export interface BenchmarkPriorPeriod {
  id: string
  name: string
  metrics: BenchmarkMetricChange[]
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
  priorPeriodStatus: PriorPeriodStatus
  priorPeriod: BenchmarkPriorPeriod | null
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
 * `type`, `category`, `source` and `companyId` are immutable after creation and `PUT`
 * silently ignores them, so they are not offered here.
 *
 * `priorPeriodBenchmarkId` is not here either, but for the opposite reason: it is not
 * immutable, it has its own route (`setPriorPeriod`). It turned out not to be a property of
 * what the benchmark IS -- it arrives later than the benchmark does, and for every row
 * created before #89 it could never arrive at all.
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

/** A benchmark the API considers a possible prior period -- `PriorPeriodCandidateDto`. */
export interface PriorPeriodCandidate {
  id: string
  name: string
  category: string
  type: string
  createdAt: string
  metricCount: number
  /**
   * True only when this is the **only** candidate.
   *
   * The API suggests and never applies, so this is not a confidence score to sort by: it is
   * the one case where there is nothing to choose between. Anything else is a decision, and
   * a wrong automatic match produces a confidently wrong year-over-year comparison, which is
   * worse than a blank column.
   */
  unambiguous: boolean
}

/**
 * The benchmarks that could be this one's prior period, newest first.
 *
 * Same company scope, same category, same type, created earlier. A read, not a write: a
 * CompanyAdmin may ask this of a global benchmark they are not allowed to edit.
 */
export async function listPriorPeriodCandidates(baseUrl: string, id: string): Promise<PriorPeriodCandidate[]> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}/prior-period/candidates`)
  return response.json() as Promise<PriorPeriodCandidate[]>
}

/**
 * Declares a benchmark's prior period, or declares that it has none.
 *
 * `'linked'` requires `priorPeriodBenchmarkId`; `'none'` and `'unlinked'` refuse it. The
 * server rejects a link across companies, across categories or types, and any link that
 * would make a benchmark its own prior period.
 */
export async function setPriorPeriod(
  baseUrl: string,
  id: string,
  status: PriorPeriodStatus,
  priorPeriodBenchmarkId?: string,
): Promise<Benchmark> {
  const response = await authFetch(`${baseUrl}/admin/benchmarks/${id}/prior-period`, {
    method: 'PUT',
    body: JSON.stringify({ status, priorPeriodBenchmarkId: priorPeriodBenchmarkId ?? null }),
  })
  return response.json() as Promise<Benchmark>
}
