import { useTranslation } from '../../../i18n'
import { LoadingRegion, NetworkError, SkeletonText } from '../../../components/ui'

interface DashboardStateProps {
  loading: boolean
  failed: boolean
  /** The server's message, or null. Never rendered raw when null — see below. */
  error: string | null
  onRetry: () => void
  children: React.ReactNode
}

/**
 * The loading / failed / loaded band the four role dashboards share.
 *
 * Written once because the four views are four components by design (see
 * `api/dashboard.ts`), and four hand-written copies of this is four chances to ship a page
 * whose retry button does nothing.
 *
 * `LoadingRegion` announces the wait in an sr-only live region, so the visible placeholder
 * is a skeleton rather than a second copy of the word "Loading" — the same pairing every
 * other page here uses.
 */
export default function DashboardState({ loading, failed, error, onRetry, children }: DashboardStateProps) {
  const { t } = useTranslation()

  if (failed) {
    return (
      <NetworkError
        title={t('dashboard.failedToLoadDashboard')}
        // The server's message when there is one, and the catalogue's when there is not.
        // A thrown non-`Error` has no text worth showing, and `String(err)` would put
        // "[object Object]" on a dashboard.
        description={error ?? t('errors.generic')}
        onRetry={onRetry}
        retryText={t('common.retry')}
      />
    )
  }

  return (
    <LoadingRegion loading={loading} label={t('common.loading')}>
      {loading ? <SkeletonText lines={6} /> : children}
    </LoadingRegion>
  )
}
