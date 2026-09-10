import { useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { LoadingRegion, NetworkError, SkeletonText } from '../../../components/ui'
import SurveyResultsNextView from './SurveyResultsNextView'
import { useSurveyResultsModel } from './useSurveyResultsModel'

/**
 * `/surveys/:id/results/next` — the redesigned survey results, beside the current page.
 *
 * ## Who may open it
 *
 * `GET /surveys/{id}/analytics` is guarded by `CanAdminister`
 * (`SurveyResultsEndpoints.cs:346-348`): a `super_admin`, or a `company_admin` for a
 * survey of their own tenant. A `leader`, a `supervisor` or an `employee` is refused
 * with 403 — the current page has no leader rule to mirror because the server gives a
 * leader nothing to draw. So the gate here is `seesWholeCompany`, the same "admin with
 * a company" shape the seam derives from that check, and every other viewer goes to
 * `/dashboard`, which dispatches them to the surface their role actually has. The
 * artboard's "leader sees their team's row" view needs a leader-scoped results
 * endpoint that does not exist today; it is a product ruling, not a gap this page can
 * close by hiding rows.
 *
 * Nothing here is a permission check: the server re-evaluates on every request.
 */
export default function SurveyResultsNextPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const capabilities = useViewerCapabilities()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const allowed = capabilities.seesWholeCompany
  // Hooks before the early return: the model hook must be called on every render.
  const { model, loading, error, reload } = useSurveyResultsModel(allowed ? id : undefined)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!allowed) return <Navigate to="/dashboard" replace />
  if (!id) return <p role="alert">{t('errors.notFound')}</p>

  const message = error ?? actionError
  if (message) {
    return (
      <NetworkError
        title={t('surveyResults.loadFailed')}
        description={message}
        onRetry={() => {
          setActionError(null)
          reload()
        }}
        retryText={t('common.retry')}
      />
    )
  }

  return (
    <LoadingRegion loading={loading} label={t('common.loading')}>
      {loading || !model ? (
        <SkeletonText lines={6} />
      ) : (
        <SurveyResultsNextView model={model} capabilities={capabilities} baseUrl={baseUrl} onError={setActionError} />
      )}
    </LoadingRegion>
  )
}
