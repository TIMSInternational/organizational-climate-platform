import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { listSurveys } from '../../api/surveys'
import { EMPTY_SURVEY_FILTERS, type SurveyFiltersValue } from '../../surveyFilterState'
import { filterSurveysByStatus, surveyStatusFacets, type SurveyStatusFacet } from '../../surveyListView'
import { orderSurveys } from './derive'
import type { SurveyRow, SurveysListNextModel } from './model'

export interface SurveysListModelState {
  status: 'loading' | 'ready' | 'error'
  model: SurveysListNextModel
  /** The ordered rows after the status chip, which narrows without a request. */
  visible: readonly SurveyRow[]
  facets: readonly SurveyStatusFacet[]
  availableTypes: readonly string[]
  error: string | null
  draft: SurveyFiltersValue
  setDraft: (value: SurveyFiltersValue) => void
  apply: () => void
  statusFilter: string
  setStatusFilter: (status: string) => void
  reload: () => void
}

/**
 * The model behind `/surveys` — THE wiring seam of that screen, and the same
 * request the current list makes: `GET /surveys` through `listSurveys`, type and
 * search on the query string, status narrowed on the client so the chips can count
 * every status at once (`SurveysListPage.tsx` carries the argument). No company id is
 * sent, for the reason given there: a SuperAdmin gets every tenant, anyone else is
 * rescoped by the server — which is also how a leader "gets the list scoped as today".
 */
export function useSurveysListModel(): SurveysListModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyName = useCompanyName()
  const [rows, setRows] = useState<SurveyRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<SurveyFiltersValue>(EMPTY_SURVEY_FILTERS)
  const [applied, setApplied] = useState<SurveyFiltersValue>(EMPTY_SURVEY_FILTERS)
  const [statusFilter, setStatusFilter] = useState('')

  const reload = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      setRows(await listSurveys(baseUrl, applied, locale))
      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
      setStatus('error')
    }
  }, [baseUrl, applied, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const ordered = useMemo(() => orderSurveys(rows), [rows])
  const visible = useMemo(() => filterSurveysByStatus(ordered, statusFilter), [ordered, statusFilter])
  const facets = useMemo(() => surveyStatusFacets(rows), [rows])
  const availableTypes = useMemo(() => [...new Set(rows.map((row) => row.type))].sort(), [rows])
  const apply = useCallback(() => setApplied(draft), [draft])

  return {
    status,
    model: { companyName, rows: ordered },
    visible,
    facets,
    availableTypes,
    error,
    draft,
    setDraft,
    apply,
    statusFilter,
    setStatusFilter,
    reload: () => {
      void reload()
    },
  }
}
