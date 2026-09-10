import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { duplicateSurvey, listSurveys } from '../../api/surveys'
import { getClimateTrends } from '../../api/climateTrends'
import { EMPTY_SURVEY_FILTERS, type SurveyFiltersValue } from '../../surveyFilterState'
import { filterSurveysByStatus, surveyStatusFacets, type SurveyStatusFacet } from '../../surveyListView'
import { orderSurveys, waveReadings } from './derive'
import type { SurveyRow, SurveysListNextModel, WaveReading } from './model'

/** How long typing rests before the search reaches the server — one request, not one per key. */
export const SEARCH_DEBOUNCE_MS = 350

export interface SurveysListModelState {
  status: 'loading' | 'ready' | 'error'
  model: SurveysListNextModel
  /** The ordered rows after the status chip, which narrows without a request. */
  visible: readonly SurveyRow[]
  facets: readonly SurveyStatusFacet[]
  availableTypes: readonly string[]
  error: string | null
  draft: SurveyFiltersValue
  /** Edits the filters; the search reaches the server after `SEARCH_DEBOUNCE_MS` of rest. */
  setDraft: (value: SurveyFiltersValue) => void
  /** Sends the filters now — Enter in the search box, or a new type. */
  apply: (value?: SurveyFiltersValue) => void
  statusFilter: string
  setStatusFilter: (status: string) => void
  reload: () => void
  /** Duplicates a survey into a fresh draft and opens it (`POST /surveys/{id}/duplicate`). */
  duplicate: (id: string) => void
  /** The survey being duplicated, while the request is in flight. */
  duplicating: string | null
  /** The server's message when a duplicate was refused. */
  actionError: string | null
}

/**
 * The model behind `/surveys` — THE wiring seam of that screen, and the same
 * request the current list makes: `GET /surveys` through `listSurveys`, type and
 * search on the query string, status narrowed on the client so the chips can count
 * every status at once (`SurveysListPage.tsx` carries the argument). No company id is
 * sent, for the reason given there: a SuperAdmin gets every tenant, anyone else is
 * rescoped by the server — which is also how a leader "gets the list scoped as today".
 *
 * One more read, for one line per closed row: `GET /surveys/climate-trends`, the whole
 * company's series, from which `waveReadings` derives "+0,29 frente a Q2". It is made
 * only for a viewer the server answers — `company_admin`, or a `super_admin` with a
 * company chosen, exactly `ClimateTrendsNextPage`'s gate — and its failure costs those
 * lines and nothing else: the list is the screen, the moves are context.
 */
export function useSurveysListModel(): SurveysListModelState {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyName = useCompanyName()
  const scope = useCompanyScope()
  const readsTrends = scope.status === 'ready' && (scope.role === 'company_admin' || scope.isSuperAdmin)
  const [rows, setRows] = useState<SurveyRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraftState] = useState<SurveyFiltersValue>(EMPTY_SURVEY_FILTERS)
  const [applied, setApplied] = useState<SurveyFiltersValue>(EMPTY_SURVEY_FILTERS)
  const [statusFilter, setStatusFilter] = useState('')
  const [readings, setReadings] = useState<ReadonlyMap<string, WaveReading>>(() => new Map())
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  // The search waits for the typing to rest, so a word is one request and not one per
  // key; `apply` skips the wait for Enter and for a new type.
  useEffect(() => {
    if (draft === applied) return
    const timer = setTimeout(() => setApplied(draft), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, applied])

  useEffect(() => {
    if (!readsTrends) return
    let cancelled = false
    getClimateTrends(baseUrl, { ...(scope.companyId ? { companyId: scope.companyId } : {}), lang: locale })
      .then((trends) => {
        if (!cancelled) setReadings(waveReadings(trends))
      })
      .catch(() => {
        if (!cancelled) setReadings(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, locale, readsTrends, scope.companyId])

  const ordered = useMemo(() => orderSurveys(rows), [rows])
  const visible = useMemo(() => filterSurveysByStatus(ordered, statusFilter), [ordered, statusFilter])
  const facets = useMemo(() => surveyStatusFacets(rows), [rows])
  const availableTypes = useMemo(() => [...new Set(rows.map((row) => row.type))].sort(), [rows])
  const apply = useCallback(
    (value?: SurveyFiltersValue) => {
      const next = value ?? draft
      setDraftState(next)
      setApplied(next)
    },
    [draft],
  )

  const duplicate = useCallback(
    (id: string) => {
      setActionError(null)
      setDuplicating(id)
      duplicateSurvey(baseUrl, id, locale)
        .then((copy) => navigate(`/surveys/${copy.id}`))
        .catch((err: unknown) => setActionError(err instanceof Error ? err.message : t('errors.generic')))
        .finally(() => setDuplicating(null))
    },
    [baseUrl, locale, navigate, t],
  )

  return {
    status,
    model: { companyName, rows: ordered, readings },
    visible,
    facets,
    availableTypes,
    error,
    draft,
    setDraft: setDraftState,
    apply,
    statusFilter,
    setStatusFilter,
    reload: () => {
      void reload()
    },
    duplicate,
    duplicating,
    actionError,
  }
}
