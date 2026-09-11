import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { readViewerClaims } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context/useCompanyScope'
import { listSurveys } from '../../../surveys/api/surveys'
import { getSurveyAnalytics } from '../../../surveys/api/surveyResults'
import { dimensionLabel } from '../../../surveys/dimensionLabel'
import {
  addBenchmarkMetric,
  createBenchmark,
  getBenchmark,
  listBenchmarks,
  listPriorPeriodCandidates,
  setPriorPeriod,
  updateBenchmark,
  type AddBenchmarkMetricInput,
  type Benchmark,
  type BenchmarkListItem,
  type PriorPeriodCandidate,
  type PriorPeriodStatus,
  type UpdateBenchmarkInput,
} from '../../api/benchmarks'
import { followPriorPeriodChain } from '../../benchmarkAnalysis'
import {
  SUPER_ADMIN,
  canReadBenchmark,
  canWriteBenchmark,
  newBenchmarkCompanyId,
  readableBenchmarks,
} from '../../benchmarkScope'
import { buildCohortReadout } from '../../cohortReadout'
import type { BenchmarkFormValues } from '../../components/BenchmarkForm'
import type { BenchmarkReference, ReadoutState } from './model'

export type BenchmarksStatus = 'forbidden' | 'loading' | 'ready' | 'error'

export interface BenchmarksState {
  status: BenchmarksStatus
  error: string | null
  references: BenchmarkReference[]
  readout: ReadoutState
  /** The cohort the company is read against — the page's eyebrow. */
  cohortName: string | null
  /** Who a created reference belongs to; `undefined` when this viewer may not create. */
  createCompanyId: string | null | undefined
  isSuperAdmin: boolean
  /** The viewer's own company, for the "Esta empresa" scope label. */
  viewerCompanyId: string | undefined
  canWrite: (benchmarkCompanyId: string | null) => boolean
  selection: {
    ids: readonly string[]
    toggle: (id: string) => void
    /** Details of the selected rows that have loaded, in the order they were ticked. */
    details: Benchmark[]
    single: Benchmark | undefined
    chain: Benchmark[]
  }
  reload: () => void
  create: (values: BenchmarkFormValues) => Promise<void>
  update: (id: string, input: UpdateBenchmarkInput) => Promise<void>
  addMetric: (id: string, input: AddBenchmarkMetricInput) => Promise<void>
  setPriorPeriod: (id: string, status: PriorPeriodStatus, priorId?: string) => Promise<void>
  loadCandidates: (id: string) => Promise<PriorPeriodCandidate[]>
}

/**
 * The model behind `/analytics/benchmarks` — THE wiring seam of the screen, and the same
 * requests the old page and its `CohortReadoutSection` made, every one real:
 *
 * - the references: `GET /admin/benchmarks?lang` (`listBenchmarks`), then
 *   `readableBenchmarks` as defence in depth. No company id is sent: for a super_admin the
 *   list is genuinely cross-company (`benchmarkScope.ts` says why the header's company
 *   selector must not narrow it).
 * - the read-out: the cohort named by `?cohort=` (else the first reference) through
 *   `getBenchmark`, the company's most recently closed survey through `listSurveys`, and
 *   its per-dimension means through `getSurveyAnalytics` → `buildCohortReadout`. The
 *   company is a company_admin's own; a super_admin's is the one chosen in the header, and
 *   until one is chosen the read-out says so instead of guessing.
 * - selection, detail, prior period and trend, exactly as the old page wired them.
 *
 * Nothing is requested for a role the server refuses (`BenchmarkEndpoints.ListAsync`
 * requires `Roles.Admin`): `status` is `'forbidden'` and the page says whose screen it is.
 */
export function useBenchmarksModel(): BenchmarksState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [searchParams] = useSearchParams()
  const companyScope = useCompanyScope()
  // Read per render, as the old page read its claims: two strings, compared by value below.
  const { role, companyId: claimCompanyId } = readViewerClaims()
  const scope = useMemo(() => ({ role, companyId: claimCompanyId }), [role, claimCompanyId])
  const mayRead = canReadBenchmark(scope, null)
  const createCompanyId = newBenchmarkCompanyId(scope)
  const readoutCompanyId =
    role === SUPER_ADMIN ? (companyScope.status === 'ready' ? companyScope.companyId : undefined) : claimCompanyId
  const requestedCohort = searchParams.get('cohort')

  const [rows, setRows] = useState<BenchmarkListItem[]>([])
  const [status, setStatus] = useState<BenchmarksStatus>(mayRead ? 'loading' : 'forbidden')
  const [error, setError] = useState<string | null>(null)
  const [readout, setReadout] = useState<ReadoutState>({ kind: 'loading' })
  const [cohortDetail, setCohortDetail] = useState<Benchmark | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [details, setDetails] = useState<Record<string, Benchmark>>({})
  const [chain, setChain] = useState<Benchmark[]>([])

  /** `quiet` refreshes the rows after an edit without unmounting the panel being edited. */
  const loadList = useCallback(
    async (quiet = false) => {
      if (!mayRead) {
        setStatus('forbidden')
        return
      }
      if (!quiet) {
        setStatus('loading')
        setError(null)
      }
      try {
        const result = await listBenchmarks(baseUrl, undefined, locale)
        setRows(readableBenchmarks(scope, result))
        setStatus('ready')
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      }
    },
    [baseUrl, locale, mayRead, scope, t],
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  const chosen = rows.find((row) => row.id === requestedCohort) ?? rows[0]
  const chosenId = chosen?.id
  const listReady = status === 'ready'

  useEffect(() => {
    if (!listReady) return
    if (!chosenId) {
      setReadout({ kind: 'no-cohort' })
      return
    }
    let cancelled = false
    setReadout({ kind: 'loading' })
    void (async () => {
      try {
        const detail = await getBenchmark(baseUrl, chosenId, locale)
        if (cancelled) return
        setCohortDetail(detail)
        if (!readoutCompanyId) {
          setReadout({ kind: 'pick-company' })
          return
        }
        const surveys = await listSurveys(baseUrl, { companyId: readoutCompanyId, status: 'closed' }, locale)
        // Most recently closed, sorted here rather than assumed from the response order.
        const latest = [...surveys].sort((a, b) => String(b.endDate ?? '').localeCompare(String(a.endDate ?? '')))[0]
        if (!latest) {
          if (!cancelled) setReadout({ kind: 'no-survey' })
          return
        }
        const analytics = await getSurveyAnalytics(baseUrl, latest.id)
        if (cancelled) return
        // Under the floor the server has emptied `questions` (`SurveyAggregate.IsSuppressed`),
        // so a read-out built from them would print "ninguna dimensión bajo la mediana" over
        // an empty card — a comparison nobody made. The survey is named; its count is not.
        if (analytics.isSuppressed) {
          setReadout({
            kind: 'under-floor',
            survey: latest.title ?? t('surveys.untitled'),
            floor: analytics.minimumGroupSize,
          })
          return
        }
        const built = buildCohortReadout(analytics.questions ?? [], detail.metrics ?? [])
        setReadout({
          kind: 'ready',
          readout: {
            cohort: { id: detail.id, name: detail.name, size: built.cohortSize },
            // The list's title, requested with `lang`, not the analytics payload's: that one
            // resolves in the survey's own fallback language.
            survey: { title: latest.title ?? t('surveys.untitled'), responses: latest.responseCount ?? null },
            yourIndex: built.yourIndex,
            cohortMedian: built.cohortMedian,
            percentile: built.percentile,
            dimensions: built.dimensions.map((dimension) => ({
              key: dimension.key,
              name: dimensionLabel(dimension.key, t),
              score: dimension.score,
              median: dimension.cohortMedian,
            })),
          },
        })
      } catch {
        // A failed read-out leaves the references usable; the region says it failed.
        if (!cancelled) setReadout({ kind: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listReady, chosenId, readoutCompanyId, baseUrl, locale, t])

  // Details of anything selected that is not cached yet — a handful of requests, since an
  // administrator ticks two or three rows.
  useEffect(() => {
    const missing = selectedIds.filter((id) => !details[id])
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const loaded = await Promise.all(missing.map((id) => getBenchmark(baseUrl, id, locale).catch(() => null)))
      if (cancelled) return
      const next: Record<string, Benchmark> = {}
      for (const benchmark of loaded) {
        if (benchmark) next[benchmark.id] = benchmark
      }
      if (Object.keys(next).length > 0) setDetails((current) => ({ ...current, ...next }))
    })()
    return () => {
      cancelled = true
    }
  }, [selectedIds, details, baseUrl, locale])

  const selectedDetails = selectedIds
    .map((id) => details[id])
    .filter((benchmark): benchmark is Benchmark => Boolean(benchmark))
  const single = selectedIds.length === 1 ? selectedDetails[0] : undefined

  useEffect(() => {
    if (!single || single.priorPeriodBenchmarkId === null) {
      setChain([])
      return
    }
    let cancelled = false
    void (async () => {
      const walked = await followPriorPeriodChain(single, (id) => getBenchmark(baseUrl, id, locale))
      if (!cancelled) setChain(walked)
    })()
    return () => {
      cancelled = true
    }
  }, [single, baseUrl, locale])

  const references = useMemo<BenchmarkReference[]>(
    () =>
      rows.map((row) => {
        const known = details[row.id] ?? (cohortDetail?.id === row.id ? cohortDetail : null)
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          category: row.category,
          companyId: row.companyId,
          isActive: row.isActive,
          qualityScore: row.qualityScore,
          validationStatus: known?.validationStatus ?? null,
        }
      }),
    [rows, details, cohortDetail],
  )

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]))
  }, [])

  const refreshDetail = useCallback(
    async (id: string) => {
      const refreshed = await getBenchmark(baseUrl, id, locale)
      setDetails((current) => ({ ...current, [id]: refreshed }))
    },
    [baseUrl, locale],
  )

  const create = useCallback(
    async (values: BenchmarkFormValues) => {
      if (createCompanyId === undefined) return
      await createBenchmark(baseUrl, {
        name: values.name,
        description: values.description,
        type: values.type,
        category: values.category,
        source: values.source,
        industry: values.industry || undefined,
        companySize: values.companySize || undefined,
        region: values.region || undefined,
        // From the claim for a company_admin, `null` (global) for a super_admin — never a
        // form field (`newBenchmarkCompanyId`).
        companyId: createCompanyId,
      })
      await loadList(true)
    },
    [baseUrl, createCompanyId, loadList],
  )

  const update = useCallback(
    async (id: string, input: UpdateBenchmarkInput) => {
      await updateBenchmark(baseUrl, id, input)
      await Promise.all([refreshDetail(id), loadList(true)])
    },
    [baseUrl, refreshDetail, loadList],
  )

  const addMetric = useCallback(
    async (id: string, input: AddBenchmarkMetricInput) => {
      await addBenchmarkMetric(baseUrl, id, input)
      await refreshDetail(id)
    },
    [baseUrl, refreshDetail],
  )

  const setPriorPeriodFor = useCallback(
    async (id: string, priorStatus: PriorPeriodStatus, priorId?: string) => {
      await setPriorPeriod(baseUrl, id, priorStatus, priorId)
      await Promise.all([refreshDetail(id), loadList(true)])
    },
    [baseUrl, refreshDetail, loadList],
  )

  // Stable, because the prior-period panel fetches inside an effect keyed on it. The
  // candidates' names are paired columns, resolved for `lang` (PR #461's fix, carried).
  const loadCandidates = useCallback((id: string) => listPriorPeriodCandidates(baseUrl, id, locale), [baseUrl, locale])

  const canWrite = useCallback((benchmarkCompanyId: string | null) => canWriteBenchmark(scope, benchmarkCompanyId), [scope])

  const reload = useCallback(() => {
    void loadList()
  }, [loadList])

  return {
    status,
    error,
    references,
    readout,
    cohortName: chosen?.name ?? null,
    createCompanyId,
    isSuperAdmin: role === SUPER_ADMIN,
    viewerCompanyId: claimCompanyId,
    canWrite,
    selection: { ids: selectedIds, toggle, details: selectedDetails, single, chain },
    reload,
    create,
    update,
    addMetric,
    setPriorPeriod: setPriorPeriodFor,
    loadCandidates,
  }
}
