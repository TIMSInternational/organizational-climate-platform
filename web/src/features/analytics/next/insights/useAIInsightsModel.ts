import { useCallback, useEffect, useRef, useState } from 'react'
import { useCompanyScope } from '../../../../company-context'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useTranslation } from '../../../../i18n'
import { acknowledgeAIInsight, getAIInsight, listAIInsights } from '../../api/insights'
import { getUser } from '../../../org-structure/api/users'
import { listCompanies } from '../../../org-structure/api/companies'
import { listSurveys } from '../../../surveys/api/surveys'
import { acknowledgerIds, defaultSelection } from './derive'
import type { CompanyPick, InsightRow } from './model'

/**
 * What the page may show this viewer:
 *
 * - `choose` — a super administrator with no company chosen. Insights belong to one company
 *   and are read one company at a time (`GET /admin/ai-insights` requires `companyId`), so
 *   the page asks rather than guessing (#124);
 * - `no-company` — any other role whose token names no tenant;
 * - `not-allowed` — a leader, supervisor or employee: `AIInsightEndpoints.cs:48-50` answers
 *   only a super administrator or the company's own administrator, so the page never makes
 *   the request it would be refused (`capabilities.seesWholeCompany` is exactly that guard);
 * - `insights` — an administrator with a company to read.
 */
export type InsightsMode = 'choose' | 'no-company' | 'not-allowed' | 'insights'

export interface AIInsightsModelState {
  mode: InsightsMode
  loading: boolean
  error: string | null
  rows: readonly InsightRow[]
  /** Acknowledger id → name; `null` when the lookup was refused (it can be, across tenants). */
  names: ReadonlyMap<string, string | null>
  /** Survey id → title, for the evidence line of a finding that names one. */
  surveyTitles: ReadonlyMap<string, string>
  selectedId: string | null
  select: (id: string) => void
  acknowledging: boolean
  actionError: string | null
  acknowledge: () => void
  /** The choose-a-company card; `null` until read. */
  picks: readonly CompanyPick[] | null
  picksError: string | null
  reload: () => void
}

/**
 * The model behind `/analytics/ai-insights` — THE wiring seam of that screen, over existing
 * clients only: `listAIInsights` / `getAIInsight` / `acknowledgeAIInsight` (`api/insights.ts`),
 * `getUser` for the acknowledger's name (a refused lookup is a name we do not print, never an
 * error), and, for the choose-a-company card, `listCompanies` plus one `listAIInsights` per
 * company and `listSurveys`, which answers a super administrator across every tenant.
 *
 * Each list row also reads its detail, because the list DTO carries no segment, confidence or
 * acknowledgement date (`AIInsightDtos.cs:13-14`) and the canvas prints all three on the row.
 * A detail that fails costs its row those three facts and nothing else.
 */
export function useAIInsightsModel(): AIInsightsModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const capabilities = useViewerCapabilities()
  const companyId = scope.companyId
  const mode: InsightsMode =
    scope.status === 'needs-selection'
      ? 'choose'
      : scope.status === 'no-company'
        ? 'no-company'
        : capabilities.seesWholeCompany
          ? 'insights'
          : 'not-allowed'

  const [rows, setRows] = useState<InsightRow[]>([])
  const [names, setNames] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  const [surveyTitles, setSurveyTitles] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [picks, setPicks] = useState<CompanyPick[] | null>(null)
  const [picksError, setPicksError] = useState<string | null>(null)
  // A company switch mid-read must not paint the previous company's findings.
  const generation = useRef(0)

  const loadInsights = useCallback(async () => {
    const run = ++generation.current
    const current = () => run === generation.current
    if (mode !== 'insights' || !companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const items = await listAIInsights(baseUrl, companyId)
      if (!current()) return
      setRows(items.map((item) => ({ item, detail: null })))
      setSelectedId((previous) => (previous && items.some((item) => item.id === previous) ? previous : defaultSelection(items)))
      setLoading(false)

      const details = await Promise.allSettled(items.map((item) => getAIInsight(baseUrl, item.id)))
      if (!current()) return
      const withDetails = items.map((item, index) => {
        const read = details[index]
        return { item, detail: read.status === 'fulfilled' ? read.value : null }
      })
      setRows(withDetails)

      const ids = acknowledgerIds(withDetails)
      const people = await Promise.allSettled(ids.map((id) => getUser(baseUrl, id)))
      if (!current()) return
      setNames(new Map(ids.map((id, index) => {
        const read = people[index]
        return [id, read.status === 'fulfilled' ? read.value.name : null] as const
      })))

      if (withDetails.some((row) => row.detail?.surveyId)) {
        const surveys = await listSurveys(baseUrl, {}, locale).catch(() => [])
        if (!current()) return
        setSurveyTitles(new Map(surveys.map((survey) => [survey.id, survey.title ?? ''] as const)))
      }
    } catch (err) {
      if (!current()) return
      // A failed request is an error with a retry, never an empty list: rendering a 404 as
      // "no findings" would tell an administrator their company has none (the old page's rule).
      setError(err instanceof Error ? err.message : t('errors.generic'))
      setRows([])
      setLoading(false)
    }
  }, [baseUrl, companyId, locale, mode, t])

  const loadPicks = useCallback(async () => {
    if (mode !== 'choose') return
    setPicksError(null)
    try {
      const [companies, surveys] = await Promise.all([
        listCompanies(baseUrl),
        listSurveys(baseUrl, {}, locale).catch(() => []),
      ])
      const lists = await Promise.allSettled(companies.map((company) => listAIInsights(baseUrl, company.id)))
      setPicks(
        companies.map((company, index) => {
          const read = lists[index]
          return {
            id: company.id,
            name: company.name,
            insights:
              read.status === 'fulfilled'
                ? { total: read.value.length, acknowledged: read.value.filter((item) => item.isAcknowledged).length }
                : null,
            surveys: surveys.filter((survey) => survey.companyId === company.id).length,
          }
        }),
      )
    } catch (err) {
      setPicksError(err instanceof Error ? err.message : t('companyContext.loadFailed'))
    }
  }, [baseUrl, locale, mode, t])

  useEffect(() => {
    void loadInsights()
  }, [loadInsights])

  useEffect(() => {
    void loadPicks()
  }, [loadPicks])

  const acknowledge = useCallback(async () => {
    if (!selectedId) return
    setAcknowledging(true)
    setActionError(null)
    try {
      await acknowledgeAIInsight(baseUrl, selectedId)
      // The list row's `isAcknowledged` is stale the moment the detail changes, so the whole
      // list is read again rather than one row patched.
      await loadInsights()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('insights.acknowledgeFailed'))
    } finally {
      setAcknowledging(false)
    }
  }, [baseUrl, loadInsights, selectedId, t])

  return {
    mode,
    loading,
    error,
    rows,
    names,
    surveyTitles,
    selectedId,
    select: (id) => {
      setActionError(null)
      setSelectedId(id)
    },
    acknowledging,
    actionError,
    acknowledge: () => {
      void acknowledge()
    },
    picks,
    picksError,
    reload: () => {
      void loadInsights()
      void loadPicks()
    },
  }
}
