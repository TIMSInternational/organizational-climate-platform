import { useCallback, useEffect, useState } from 'react'
import {
  addBenchmarkMetric,
  createBenchmark,
  getBenchmark,
  listBenchmarks,
  updateBenchmark,
  type AddBenchmarkMetricInput,
  type Benchmark,
  type BenchmarkListItem,
  type UpdateBenchmarkInput,
} from '../api/benchmarks'
import { followPriorPeriodChain } from '../benchmarkAnalysis'
import {
  SUPER_ADMIN,
  canWriteBenchmark,
  newBenchmarkCompanyId,
  readableBenchmarks,
  type BenchmarkScope,
} from '../benchmarkScope'
import BenchmarkList from '../components/BenchmarkList'
import BenchmarkComparison from '../components/BenchmarkComparison'
import BenchmarkDetailPanel from '../components/BenchmarkDetailPanel'
import BenchmarkForm, { type BenchmarkFormValues } from '../components/BenchmarkForm'
import BenchmarkTrend from '../components/BenchmarkTrend'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { EmptyState, ErrorState } from '../../../components/ui'

/**
 * List, compare and trend the benchmarks the caller may read.
 *
 * ## Why this page is open to a SuperAdmin when `/action-plans` is not
 *
 * `ActionPlansListPage` blocks SuperAdmin outright, because
 * `GET /admin/action-plans` requires a company id and a SuperAdmin has no picker
 * to choose one with — they would be silently scoped to whatever company their
 * own user row points at. `GET /admin/benchmarks` has no such requirement: for a
 * SuperAdmin it returns *every* benchmark across every tenant unless a
 * `companyId` filter is supplied. So a SuperAdmin here gets a genuine
 * cross-company view rather than an unmarked accidental one, and blocking them
 * would be copying the precedent past the reason for it.
 *
 * ## Selection drives everything below the table
 *
 * One checkbox column feeds three panels, so the table and the analysis can never
 * disagree about what is selected:
 *
 * - 1 selected → the detail panel, plus a trend if that benchmark links to a
 *   prior period.
 * - 2+ selected → the comparison matrix.
 *
 * Details are fetched per selected id and cached, because `GET /admin/benchmarks`
 * returns `BenchmarkListItem`, which carries no metrics — and metrics are the
 * only thing there is to compare.
 */
export default function BenchmarksPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  // `''`, not a missing claim, is what a global super-admin carries since #191
  // made `User.CompanyId` a `Guid?` (`AuthEndpoints` emits
  // `user.CompanyId?.ToString() ?? string.Empty`). Normalised so `canWriteBenchmark`
  // cannot match a benchmark whose owner id is somehow also empty.
  const rawCompanyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  const companyId = rawCompanyId ? rawCompanyId : undefined
  const scope: BenchmarkScope = { role, companyId }

  const [benchmarks, setBenchmarks] = useState<BenchmarkListItem[]>([])
  const [details, setDetails] = useState<Record<string, Benchmark>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [chain, setChain] = useState<Benchmark[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const createCompanyId = newBenchmarkCompanyId(scope)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listBenchmarks(baseUrl)
      // Rebuilt here rather than closing over `scope`, which is a fresh object on
      // every render and would make this callback -- and the effect that runs it
      // -- change identity every time.
      setBenchmarks(readableBenchmarks({ role, companyId }, result))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, role, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Load the detail for anything selected that is not cached yet. Selection is a
  // small set (an admin ticks two or three rows), so this stays a handful of
  // requests rather than needing a batch endpoint.
  useEffect(() => {
    const missing = selectedIds.filter((id) => !details[id])
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const loaded = await Promise.all(
        missing.map((id) => getBenchmark(baseUrl, id).catch(() => null)),
      )
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
  }, [selectedIds, details, baseUrl])

  const selectedDetails = selectedIds
    .map((id) => details[id])
    .filter((benchmark): benchmark is Benchmark => Boolean(benchmark))
  const single = selectedIds.length === 1 ? selectedDetails[0] : undefined

  // The prior-period walk is its own effect because it is the only fetch here
  // whose length is not known up front -- `followPriorPeriodChain` keeps going
  // until it runs out of links, hits a cycle, or is refused a read.
  useEffect(() => {
    if (!single || single.priorPeriodBenchmarkId === null) {
      setChain([])
      return
    }
    let cancelled = false
    void (async () => {
      const walked = await followPriorPeriodChain(single, (id) => getBenchmark(baseUrl, id))
      if (!cancelled) setChain(walked)
    })()
    return () => {
      cancelled = true
    }
  }, [single, baseUrl])

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id],
    )
  }

  async function refreshDetail(id: string) {
    const refreshed = await getBenchmark(baseUrl, id)
    setDetails((current) => ({ ...current, [id]: refreshed }))
  }

  async function handleCreate(values: BenchmarkFormValues) {
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
      companyId: createCompanyId,
    })
    setShowCreateForm(false)
    await reload()
  }

  async function handleUpdate(id: string, input: UpdateBenchmarkInput) {
    await updateBenchmark(baseUrl, id, input)
    await Promise.all([refreshDetail(id), reload()])
  }

  async function handleAddMetric(id: string, input: AddBenchmarkMetricInput) {
    await addBenchmarkMetric(baseUrl, id, input)
    await refreshDetail(id)
  }

  if (error) {
    return <ErrorState title={t('benchmarks.loadFailed')} description={error} />
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.benchmarks')}
        description={t('benchmarks.description')}
        actions={
          createCompanyId !== undefined ? (
            <button onClick={() => setShowCreateForm((open) => !open)}>
              {showCreateForm ? t('common.cancel') : t('benchmarks.newBenchmark')}
            </button>
          ) : undefined
        }
      />

      {showCreateForm && createCompanyId !== undefined && (
        <>
          <p>
            {role === SUPER_ADMIN
              ? t('benchmarks.createsGlobalHint')
              : t('benchmarks.createsCompanyHint')}
          </p>
          <BenchmarkForm
            variant="create"
            submitLabel={t('benchmarks.createBenchmark')}
            onSubmit={handleCreate}
          />
        </>
      )}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : benchmarks.length === 0 ? (
        <EmptyState
          title={t('benchmarks.noBenchmarks')}
          description={t('benchmarks.noBenchmarksDescription')}
        />
      ) : (
        <>
          <BenchmarkList benchmarks={benchmarks} selectedIds={selectedIds} onToggle={toggle} />

          {selectedIds.length === 0 && <p>{t('benchmarks.comparisonHint')}</p>}

          {single && (
            <BenchmarkDetailPanel
              benchmark={single}
              canWrite={canWriteBenchmark(scope, single.companyId)}
              onUpdate={(input) => handleUpdate(single.id, input)}
              onAddMetric={(input) => handleAddMetric(single.id, input)}
            />
          )}

          {single && (chain.length > 1 ? <BenchmarkTrend chain={chain} /> : <p>{t('benchmarks.noPriorPeriods')}</p>)}

          {selectedDetails.length > 1 && <BenchmarkComparison benchmarks={selectedDetails} />}
        </>
      )}
    </div>
  )
}
