import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { listCompanies } from '../../../org-structure/api/companies'
import { getClimateTrends } from '../../api/climateTrends'
import { filterSurveysByStatus, surveyStatusFacets, type SurveyStatusFacet } from '../../surveyListView'
import { waveReadings } from '../list/derive'
import type { SurveyRow, WaveReading } from '../list/model'
import { useSurveysListModel, type SurveysListModelState } from '../list/useSurveysListModel'
import { ALL_COMPANIES, companiesWithClosed, forCompany } from './derive'

export interface SuperSurveysListModelState {
  /** The shared list model — the same `GET /surveys`, search, type, status and duplicate. */
  base: SurveysListModelState
  /** Every row of the chosen company (or of the platform), in the design's order. */
  rows: readonly SurveyRow[]
  /** `rows` after the status chip. */
  visible: readonly SurveyRow[]
  facets: readonly SurveyStatusFacet[]
  company: string
  setCompany: (companyId: string) => void
  /** Company id → name, from `GET /admin/companies`. */
  companyNames: ReadonlyMap<string, string>
  /** Survey id → its climate reading, from each company's own `GET /surveys/climate-trends`. */
  readings: ReadonlyMap<string, WaveReading>
}

/**
 * The model behind the super administrator's `/surveys` — a wrapper over the shared list's
 * seam (`useSurveysListModel`, the same request and the same actions), adding what the
 * cross-tenant reading needs and nothing it does not:
 *
 * - `GET /admin/companies` — the super administrator's own endpoint — to name each row's
 *   company and fill the company filter, which then narrows on the client, as the status
 *   chip does, because the list is already the whole platform;
 * - one `GET /surveys/climate-trends?companyId=` per company with a closed survey, each read
 *   through `waveReadings` — the same reduction the Panel de Control and Clima en el tiempo
 *   print — so a closed row's "+0,32 frente a Q2" is its own company's move. A company whose
 *   read fails costs its rows their move and nothing else; the row then prints its wave's place.
 */
export function useSuperSurveysListModel(): SuperSurveysListModelState {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const base = useSurveysListModel()
  const [company, setCompany] = useState(ALL_COMPANIES)
  const [companyNames, setCompanyNames] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [readings, setReadings] = useState<ReadonlyMap<string, WaveReading>>(() => new Map())

  useEffect(() => {
    let cancelled = false
    listCompanies(baseUrl)
      .then((companies) => {
        if (!cancelled) setCompanyNames(new Map(companies.map((entry) => [entry.id, entry.name])))
      })
      .catch(() => {
        if (!cancelled) setCompanyNames(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  const withClosed = useMemo(() => companiesWithClosed(base.model.rows).sort().join(','), [base.model.rows])

  useEffect(() => {
    const ids = withClosed === '' ? [] : withClosed.split(',')
    if (ids.length === 0) return
    let cancelled = false
    Promise.allSettled(ids.map((companyId) => getClimateTrends(baseUrl, { companyId, lang: locale }))).then((reads) => {
      if (cancelled) return
      const merged = new Map<string, WaveReading>()
      for (const read of reads) {
        if (read.status !== 'fulfilled') continue
        for (const [surveyId, reading] of waveReadings(read.value)) merged.set(surveyId, reading)
      }
      setReadings(merged)
    })
    return () => {
      cancelled = true
    }
  }, [baseUrl, locale, withClosed])

  const rows = useMemo(() => forCompany(base.model.rows, company), [base.model.rows, company])
  const visible = useMemo(() => filterSurveysByStatus(rows, base.statusFilter), [rows, base.statusFilter])
  const facets = useMemo(() => surveyStatusFacets(rows), [rows])

  return { base, rows, visible, facets, company, setCompany, companyNames, readings }
}
