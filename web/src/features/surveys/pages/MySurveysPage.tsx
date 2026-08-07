import { useCallback, useEffect, useState } from 'react'
import { listMySurveys, type MySurveyListItem } from '../api/surveys'
import MySurveyList from '../components/MySurveyList'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

/**
 * The respondent-facing list — one of the very few non-admin pages in the product.
 *
 * ## Why there is no role check, and why that is the correct shape here
 *
 * Every other page in this app either gates on a role or scopes itself from a claim.
 * This one does neither, deliberately. `GET /surveys/my` resolves the caller's **own
 * user row** — by `sub`, then by external id, then by email — and filters by that
 * row's company and department. It reads no role claim at all, which is what makes it
 * loadable by `employee`, `supervisor` and `leader`, the three roles that until now
 * had exactly one page (`/notifications`) they could open.
 *
 * Reading the department from the user row rather than from the JWT is the endpoint's
 * own choice and it matters: department membership moves, and a token minted before a
 * transfer would otherwise keep serving the old team's surveys until it expired.
 *
 * A **global** super admin (`User.CompanyId` is NULL since #191) belongs to no tenant,
 * so the endpoint returns an empty list rather than an error — correct, and the reason
 * this page needs no super-admin special case either. It is also why `navSections.ts`
 * does not offer this entry to `super_admin`: an always-empty page is not a
 * destination.
 *
 * ## No respond link
 *
 * No survey respond page exists yet. A row that links nowhere is worse for an
 * employee than a row that does not pretend to, so the page says once, above the
 * table, that answering is not yet available here.
 */
export default function MySurveysPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [surveys, setSurveys] = useState<MySurveyListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSurveys(await listMySurveys(baseUrl, locale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <div>
      <PageTopBar
        title={t('navigation.mySurveys')}
        description={t('navigation.mySurveysDesc')}
      />

      {error ? (
        <NetworkError
          title={t('errors.generic')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : (
            <>
              {surveys.length > 0 && (
                <Alert className="mb-panel-gap">
                  <AlertDescription>{t('surveys.respondingUnavailable')}</AlertDescription>
                </Alert>
              )}
              <MySurveyList surveys={surveys} />
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
