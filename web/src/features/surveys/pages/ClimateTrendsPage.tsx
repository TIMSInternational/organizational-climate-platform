import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageTopBar } from '../../../components/layout'
import { ClimateMap } from '../../../components/charts'
import { EmptyState, LoadingRegion, NetworkError } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import {
  DEPARTMENT_GROUP,
  WHOLE_COMPANY_KEY,
  getClimateTrends,
  type ClimateTrendsResponse,
} from '../api/climateTrends'
import { buildClimateTrendMap } from '../climateTrendsMap'

/**
 * Climate over time — the same dimension scores the results screens show, read across
 * surveys instead of within one.
 *
 * ## Rows are surveys
 *
 * The grid is a `ClimateMap`, and its rows are the company's surveys oldest-first with the
 * dimensions as columns. That is the transpose of the obvious layout and it is forced by
 * the anonymity floor: `ClimateMap` suppresses a row as a unit because the cells in a row
 * share their respondents, which is true of "one department in one survey" and false of
 * "one dimension across several surveys". See `climateTrends.ts` for the full argument.
 *
 * ## One group at a time
 *
 * The server can return every department at once, and the screen deliberately shows one.
 * Stacking twelve grids would make the page a scroll rather than a reading, and — the real
 * reason — the colour scale is relative to the cells on screen (`climateScale`), so twelve
 * grids would each be coloured against their own mean and look comparable while not being.
 * One grid, one scale, one stated target.
 *
 * ## What the page refuses to draw
 *
 * No trend line, no arrow, no "improving". The matrix reports the waves that exist at the
 * dates they closed. Drawing a slope across an irregular series of changing instruments
 * would assert a comparability nobody established, and a line drawn *through* a suppressed
 * row reconstructs the withheld reading from its neighbours — the one thing the floor
 * exists to prevent.
 */
export default function ClimateTrendsPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  /**
   * `useCompanyScope`, not the JWT claim — the rule this page must not re-invent
   * (#124): **a super_admin's company is their explicit selection and never their own
   * claim.** The endpoint answers 400 for a super_admin who names no company, because
   * there is no all-companies climate to return, so a page that just called without one
   * would put an error panel in front of the role the sidebar offers this to. Asked, not
   * guessed at — the same three branches `DepartmentsPage` uses.
   */
  const scope = useCompanyScope()

  const [payload, setPayload] = useState<ClimateTrendsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  /** `null` is the whole company. Anything else names the breakdown to group by. */
  const [groupBy, setGroupBy] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  useEffect(() => {
    if (scope.status !== 'ready') return

    let cancelled = false
    setLoadError(null)
    setPayload(null)

    getClimateTrends(baseUrl, {
      ...(groupBy ? { groupBy } : {}),
      // The resolved company travels on every request, a company_admin's included.
      // The server would default to their claim anyway, but an explicit id makes the
      // request say what it is asking for, and a mismatched one is refused rather than
      // silently rescoped -- which is the failure a caller would publish as company B's
      // climate. `undefined` only before the scope resolves, and the effect returns early
      // in that case.
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
    })
      .then((result) => {
        if (!cancelled) setPayload(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : '')
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, groupBy, attempt, scope.companyId, scope.status])

  // The reader's locale, through Intl, exactly as every other figure on this product's
  // screens is formatted. A survey with no title falls back to this date, so a hand-rolled
  // format here would put one row heading in a different convention from its neighbours.
  const formatDate = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short' }),
    [locale],
  )

  const groups = useMemo(() => payload?.groups ?? [], [payload])

  const active = useMemo(() => {
    if (groups.length === 0) return null
    return groups.find((group) => group.key === selectedGroup) ?? groups[0]
  }, [groups, selectedGroup])

  const model = useMemo(
    () => (payload && active ? buildClimateTrendMap(payload, active, formatDate) : null),
    [payload, active, formatDate],
  )

  if (scope.status === 'needs-selection') {
    return (
      <div className="grid gap-panel-gap">
        <PageTopBar
          title={t('surveys.climateTrends.title')}
          description={t('surveys.climateTrends.description')}
        />
        <EmptyState
          title={t('companyContext.chooseACompany')}
          description={t('companyContext.chooseACompanyDescription')}
        />
      </div>
    )
  }

  if (scope.status === 'no-company') {
    return (
      <div className="grid gap-panel-gap">
        <PageTopBar
          title={t('surveys.climateTrends.title')}
          description={t('surveys.climateTrends.description')}
        />
        <p role="alert">{t('common.noCompanyAssociated')}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-panel-gap">
      <PageTopBar
        title={t('surveys.climateTrends.title')}
        description={t('surveys.climateTrends.description')}
      />

      {loadError !== null ? (
        <NetworkError
          title={t('surveys.climateTrends.loadError')}
          description={loadError || undefined}
          onRetry={() => setAttempt((previous) => previous + 1)}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={payload === null} label={t('common.loading')}>
          {payload && (
            // `gap-section`, and not nothing: the controls and the grid are siblings, so
            // without it the map's own caption sat flush under the dropdown and read as a
            // second label attached to it rather than as the heading of the figure below.
            // Same spacing rhythm the results page uses between its sections.
            <div className="flex flex-col gap-section">
              {/* Native `<select>`, not the `ui/select.tsx` primitive, on the precedent
                  `SurveyFilters` sets and for the same hard reason: that primitive wraps
                  `@radix-ui/react-select`, whose `Select.Item` THROWS on an empty-string
                  value, and "the whole company" is exactly that. `index.css` already
                  styles `select` and `label > select` in both themes. */}
              <div className="flex flex-wrap items-end gap-4">
                <label className="mb-0 w-full sm:w-64">
                  {t('surveys.climateTrends.groupByLabel')}
                  <select
                    value={groupBy ?? ''}
                    onChange={(event) => {
                      setGroupBy(event.target.value === '' ? null : event.target.value)
                      // Cleared, not carried: a department key means nothing under a
                      // different grouping, and keeping it would silently fall back to
                      // whichever group happened to be first.
                      setSelectedGroup(null)
                    }}
                  >
                    <option value="">{t('surveys.climateTrends.wholeCompany')}</option>
                    <option value={DEPARTMENT_GROUP}>
                      {t('surveys.climateTrends.byDepartment')}
                    </option>
                  </select>
                </label>

                {groupBy !== null && groups.length > 0 && (
                  <label className="mb-0 w-full sm:w-64">
                    {t('surveys.climateTrends.groupLabel')}
                    <select
                      value={active?.key ?? ''}
                      onChange={(event) => setSelectedGroup(event.target.value)}
                    >
                      {groups.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.label ?? group.key}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {payload.surveys.length === 0 ? (
                <EmptyState
                  title={t('surveys.climateTrends.noSurveysTitle')}
                  description={t('surveys.climateTrends.noSurveysBody')}
                />
              ) : model === null ? (
                <EmptyState
                  title={t('surveys.climateTrends.nothingToDrawTitle')}
                  description={t('surveys.climateTrends.nothingToDrawBody')}
                />
              ) : (
                <>
                  <ClimateMap
                    dimensions={model.dimensions}
                    rows={model.rows}
                    target={model.target}
                    deadBandAt={model.deadBandAt}
                    extremeAt={model.extremeAt}
                    threshold={model.threshold}
                    // One decimal, the precision every score on the results screens
                    // shares. Left unset, a `4` would sit in the column above a `3.8`.
                    decimals={1}
                    size="large"
                    title={t('surveys.climateTrends.mapTitle')}
                  />

                  {/* Said, not left to be inferred. A narrower grid than the reader
                      expects is otherwise indistinguishable from a product that lost
                      data — and an instrument gaining a dimension between waves is the
                      common case here, not the rare one. */}
                  {model.omittedDimensions.length > 0 && (
                    <p className="text-sm text-fg-secondary">
                      {t('surveys.climateTrends.omittedDimensions', {
                        dimensions: model.omittedDimensions.join(', '),
                      })}
                    </p>
                  )}

                  {payload.suppressedGroupCount > 0 && (
                    <p className="text-sm text-fg-secondary">
                      {t('surveys.climateTrends.suppressedGroups', {
                        count: payload.suppressedGroupCount,
                        threshold: payload.minimumGroupSize,
                      })}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

/** Re-exported so the route file and tests share one name for the ungrouped series. */
export { WHOLE_COMPANY_KEY }
