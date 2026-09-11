/**
 * The typed model behind the redesigned Puntos de Referencia — `/analytics/benchmarks`,
 * drawn as the Benchmarks artboard (10 Sep).
 *
 * Every field has an endpoint behind it, so there is no `sampleModel.ts` here and no
 * sample chip on the screen:
 *
 * | Field                                  | Endpoint                                                  |
 * |----------------------------------------|-----------------------------------------------------------|
 * | `references`                           | `GET /admin/benchmarks?lang` (`listBenchmarks`)            |
 * | `cohort`, the medians, the percentile  | `GET /admin/benchmarks/{id}?lang` → `metrics[]` (`getBenchmark`) |
 * | `survey`                               | `GET /surveys?companyId&status=closed&lang` (`listSurveys`) |
 * | `yourIndex`, `dimensions[].score`      | `GET /surveys/{id}/analytics` → `questions[].average`, through `buildCohortReadout` |
 *
 * Every number the page prints — the gap to the median, "3 dimensions below", the widest
 * gap, the band — is derived from this shape in `derive.ts`, never typed.
 */

/** One dimension of the latest closed survey, against the cohort's median for it. */
export interface BenchmarkDimension {
  key: string
  /** Already resolved through `dimensionLabel`: the catalogue's heading, else the author's key. */
  name: string
  /** The company's 0–100 index on this dimension, or `null` when the survey did not score it. */
  score: number | null
  /** The cohort's median on the same index, or `null` when the cohort carries none. */
  median: number | null
}

/** One row of "Todas las referencias". */
export interface BenchmarkReference {
  id: string
  name: string
  type: string
  category: string
  /** `null` is a global reference, read by every tenant and written only by a super_admin. */
  companyId: string | null
  isActive: boolean
  /**
   * The quality rule's verdict, or `null` when nobody has scored the reference — which is
   * what the API says from PR #463 on. Until then a never-scored row arrives as `0`, and
   * `validationStatus: 'pending'` (on the detail) is what tells the two apart.
   */
  qualityScore: number | null
  /** From the detail when it has been read; `null` otherwise. */
  validationStatus: string | null
}

/** This company read against one cohort. */
export interface CohortReadoutModel {
  cohort: { id: string; name: string; size: number | null }
  /** The survey the index is measured on: the company's most recently closed one. */
  survey: { title: string; responses: number | null }
  yourIndex: number | null
  cohortMedian: number | null
  /** Where the company sits in the cohort, 0–100, or `null` when not published. */
  percentile: number | null
  dimensions: readonly BenchmarkDimension[]
}

/**
 * Why there is — or is not — a read-out. Each state is a different sentence on screen; a
 * read-out that failed is not "no cohort", and a super_admin who has not chosen a company
 * has not failed at anything.
 */
export type ReadoutState =
  | { kind: 'loading' }
  | { kind: 'ready'; readout: CohortReadoutModel }
  | { kind: 'no-cohort' }
  | { kind: 'no-survey' }
  | { kind: 'pick-company' }
  | { kind: 'failed' }
