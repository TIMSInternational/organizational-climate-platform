import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listMicroclimates, type Microclimate } from '../api/microclimates'
import MicroclimateList from '../components/MicroclimateList'
import MicroclimateFilters, { type MicroclimateFiltersValue } from '../components/MicroclimateFilters'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

// Company scope comes from `useCompanyScope()` (#124), not from the JWT claim
// this page used to read directly. See `company-context/companyContext.ts` for
// the rule, and `ActionPlansListPage` for the same note at length: the block that
// stood here was waiting on a picker, and rested on a premise (#191 made
// `User.CompanyId` nullable, so a global SuperAdmin's claim is `''`, not a real
// company) that has since moved. A SuperAdmin is now asked which company they
// mean rather than blocked -- and never given one by default.
//
// #127 moved creation off this page. The inline `MicroclimateForm` that used to
// appear under a toggle here collected the same eleven fields with no per-field
// validation and no preview, and its template list was fetched on every load of
// this page whether or not anyone opened the form. `/microclimates/new` owns that
// now, so this page fetches one thing and lists it.
export default function MicroclimatesListPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const [microclimates, setMicroclimates] = useState<Microclimate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MicroclimateFiltersValue>({ status: '' })

  // `useCallback` + `[reload]` rather than the mount-only `[]` this page used to
  // run on: the company can now change while the page is mounted, and stale rows
  // under a switched context is the same lie as silent scoping.
  const reload = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setMicroclimates(await listMicroclimates(baseUrl, companyId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Client side, and this is the one filter that can be: `ListAsync` takes a
  // `status` query parameter, but the whole result set for one company is a page's
  // worth of rows and refetching to hide two of them would be a round trip to do
  // what an array filter already did.
  const filtered = microclimates.filter((m) => !filters.status || m.status === filters.status)

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.microclimates')}
        description={t('navigation.microclimatesDesc')}
        actions={
          <>
            {/* `asChild` so the router owns the navigation: a bare anchor
                full-page-reloads the SPA and throws away the in-memory token. */}
            <Button asChild variant="outline">
              <Link to="/microclimates/analytics">{t('microclimates.analytics')}</Link>
            </Button>
            <Button asChild variant="primary">
              <Link to="/microclimates/new">{t('common.newMicroclimate')}</Link>
            </Button>
          </>
        }
      />

      <MicroclimateFilters value={filters} onChange={setFilters} />

      {error ? (
        <NetworkError
          title={t('errors.generic')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? <SkeletonText lines={4} /> : <MicroclimateList microclimates={filtered} />}
        </LoadingRegion>
      )}
    </div>
  )
}
