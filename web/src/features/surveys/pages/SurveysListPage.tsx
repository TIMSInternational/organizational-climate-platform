import { useCallback, useEffect, useMemo, useState } from 'react'
import { listSurveys, type SurveyListItem } from '../api/surveys'
import SurveyList from '../components/SurveyList'
import SurveyFilters from '../components/SurveyFilters'
import { EMPTY_SURVEY_FILTERS, type SurveyFiltersValue } from '../surveyFilterState'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { LoadingRegion, NetworkError, SkeletonText } from '../../../components/ui'

/**
 * Every survey the viewer may administer.
 *
 * ## Why this page does NOT block a SuperAdmin, unlike Action Plans and Microclimates
 *
 * Those two pages block `super_admin` outright because they scope themselves from the
 * viewer's own `companyId` claim with no picker — so a SuperAdmin would be silently
 * shown one company's rows while believing they were seeing all of them.
 *
 * `GET /surveys` has no such hazard, and it is worth being precise about why rather
 * than copying the workaround. Read `SurveyEndpoints.ListAsync`: for a SuperAdmin the
 * `companyId` filter is *optional*, and omitting it applies **no company predicate at
 * all** — the query returns every tenant's surveys. For anyone else the server
 * overwrites the scope with their own company whatever they send. So this page sends
 * no company id, and both roles get a correct answer: a genuine cross-company view
 * for a SuperAdmin, their own company for a CompanyAdmin. That is the
 * `/admin/benchmarks` shape, not the `/action-plans` one.
 *
 * A consequence worth stating: `companyId` therefore never appears in this page's
 * request, so there is no route param, no claim read, and nothing for a future
 * company-context selector (#57) to conflict with — it would add a filter here, not
 * replace a scoping mechanism.
 *
 * ## Filtering is the server's job
 *
 * Status, type and search all go on the query string. The alternative — fetching
 * everything and filtering the array — is a second implementation of a rule the
 * server owns, and `SurveyStatuses.IsValid` rejecting an unknown status with a 400
 * is a check the client would then be silently skipping.
 */
export default function SurveysListPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [surveys, setSurveys] = useState<SurveyListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Two pieces of state on purpose: `draft` is what the form holds, `applied` is what
  // was actually fetched. Refetching on every keystroke would issue a request per
  // character typed into the search box.
  const [draftFilters, setDraftFilters] = useState<SurveyFiltersValue>(EMPTY_SURVEY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<SurveyFiltersValue>(EMPTY_SURVEY_FILTERS)

  // `useCallback` rather than a plain function plus a deps-array lie: the web lint
  // budget is `--max-warnings 10` and it is exactly full, so one new
  // `react-hooks(exhaustive-deps)` warning fails CI.
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSurveys(await listSurveys(baseUrl, appliedFilters))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, appliedFilters, t])

  useEffect(() => {
    reload()
  }, [reload])

  /**
   * The type filter's options.
   *
   * Derived from the rows on screen because `Survey.Type` has no closed vocabulary on
   * the wire. Deliberately computed from `surveys` — the *current* result set — which
   * means narrowing by type then narrowing again cannot offer a type that would return
   * nothing. The unfiltered load repopulates the full list.
   */
  const availableTypes = useMemo(
    () => [...new Set(surveys.map((survey) => survey.type))].sort(),
    [surveys],
  )

  return (
    <div>
      <PageTopBar
        title={t('navigation.surveys')}
        description={t('surveys.surveyManagementDesc')}
      />

      <SurveyFilters
        value={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters(draftFilters)}
        availableTypes={availableTypes}
        disabled={loading}
      />

      {error ? (
        <NetworkError
          title={t('errors.generic')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        // `LoadingRegion` already announces `common.loading` in an sr-only live
        // region, so the visible placeholder is a skeleton rather than a second copy
        // of the same word.
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? <SkeletonText lines={4} /> : <SurveyList surveys={surveys} />}
        </LoadingRegion>
      )}
    </div>
  )
}
