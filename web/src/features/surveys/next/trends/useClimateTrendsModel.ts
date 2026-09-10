import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import {
  DEPARTMENT_GROUP,
  WHOLE_COMPANY_KEY,
  getClimateTrends,
  type ClimateTrendGroup,
  type ClimateTrendsResponse,
} from '../../api/climateTrends'
import { listSurveys, type SurveyListItem } from '../../api/surveys'
import { dimensionLabel } from '../../dimensionLabel'
import { CLIMATE_TARGET, waveCode } from '../../../dashboard/next/compose'
import { orderByLatest, withoutArchived } from './derive'
import type { ClimateTrendsNextModel, OpenWave, TrendDimension, TrendGroup, TrendWave } from './model'

export type ClimateTrendsStatus = 'loading' | 'ready' | 'error'

export interface ClimateTrendsModelState {
  status: ClimateTrendsStatus
  /** Present exactly when `status === 'ready'`. */
  model: ClimateTrendsNextModel | null
  error: string | null
  retry: () => void
  selectGroup: (key: string) => void
}

interface Payloads {
  whole: ClimateTrendsResponse
  byDepartment: ClimateTrendsResponse
  /** `GET /surveys?status=active` for the tenant, or `null` when it could not be read. */
  open: readonly SurveyListItem[] | null
}

/** The open survey closing soonest, as the cycle reads it — or `null`. */
function openWaveOf(rows: readonly SurveyListItem[] | null, companyId: string | undefined): OpenWave | null {
  if (rows === null) return null
  const open = rows
    .filter((row) => row.status === 'active' && (companyId === undefined || row.companyId === companyId))
    .sort((a, b) => a.endDate.localeCompare(b.endDate))[0]
  return open ? { code: waveCode(open.title, open.id.slice(0, 8)), closesAt: open.endDate } : null
}

/**
 * The model behind `/surveys/climate-trends` — THE wiring seam of that screen.
 *
 * Three requests, all through existing clients: the ungrouped series (the whole
 * company), the department breakdown, and the tenant's open survey. The server returns
 * one grouping per call (`groups` holds departments OR the `__company__` series, never
 * both), and the segmented control needs every group at once so a click redraws without
 * a round trip. All three carry the resolved `companyId`, for the reason
 * `ClimateTrendsPage` gives: an explicit id is refused when mismatched rather than
 * silently rescoped. The open survey is context for one sentence ("la Q4 abierta entra
 * al cerrar el 10 oct"), so its failure costs that sentence and nothing else.
 *
 * Every payload passes through `withoutArchived` before anything reads it: the trends
 * window carries archived surveys, and an archived survey never counts here.
 *
 * `enabled` is the caller's role gate (see the effect): the request is only made for a
 * viewer the server would answer.
 */
export function useClimateTrendsModel(enabled: boolean): ClimateTrendsModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyName = useCompanyName()

  const [payloads, setPayloads] = useState<Payloads | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedGroup, setSelectedGroup] = useState<string>(WHOLE_COMPANY_KEY)

  useEffect(() => {
    // `enabled` is the page's role gate: a leader must never fire this request, which
    // the server answers 403 — the redirect alone would still have sent it.
    if (!enabled || scope.status !== 'ready') return
    let cancelled = false
    setError(null)
    setPayloads(null)
    const common = { ...(scope.companyId ? { companyId: scope.companyId } : {}), lang: locale }
    Promise.all([
      getClimateTrends(baseUrl, common),
      getClimateTrends(baseUrl, { ...common, groupBy: DEPARTMENT_GROUP }),
      listSurveys(baseUrl, { companyId: scope.companyId, status: 'active' }, locale).catch(() => null),
    ])
      .then(([whole, byDepartment, open]) => {
        if (!cancelled) {
          setPayloads({ whole: withoutArchived(whole), byDepartment: withoutArchived(byDepartment), open })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '')
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, attempt, enabled, scope.companyId, scope.status, locale])

  const retry = useCallback(() => setAttempt((previous) => previous + 1), [])

  const model = useMemo((): ClimateTrendsNextModel | null => {
    if (payloads === null) return null
    const { whole, byDepartment, open } = payloads
    const wholeGroup = whole.groups.find((group) => group.key === WHOLE_COMPANY_KEY) ?? whole.groups[0] ?? null
    // The grouped response never carries the `__company__` series on the real API; a
    // fixture that answers both requests alike would, and two segments with one key is
    // a duplicate-key render. Filtered, so the control lists the whole company once.
    const departments = byDepartment.groups.filter((group) => group.key !== WHOLE_COMPANY_KEY)
    const groups: TrendGroup[] = [
      { key: WHOLE_COMPANY_KEY, name: null },
      ...departments.map((group) => ({ key: group.key, name: group.label ?? group.key })),
    ]
    const chosen = departments.find((group) => group.key === selectedGroup) ?? null
    const active: ClimateTrendGroup | null = chosen ?? wholeGroup
    const activeKey = chosen ? chosen.key : WHOLE_COMPANY_KEY

    const monthYear = (iso: string) =>
      new Date(iso).toLocaleDateString(locale, { timeZone: 'UTC', month: 'short', year: 'numeric' })
    const waves: TrendWave[] = whole.surveys.map((survey) => ({
      id: survey.surveyId,
      code: waveCode(survey.title, monthYear(survey.endDate)),
      name: survey.title,
      closedAt: survey.endDate,
      completedCount: survey.completedCount,
    }))
    const seriesOf = (group: ClimateTrendGroup | null): TrendDimension[] =>
      whole.dimensions.map((dimension, dimensionIndex) => ({
        key: dimension.key,
        name: dimensionLabel(dimension.key, t),
        values: waves.map((wave) => {
          const point = group?.points.find((candidate) => candidate.surveyId === wave.id) ?? null
          if (point === null || point.isSuppressed) return null
          return point.scores[dimensionIndex] ?? null
        }),
      }))
    // The order is the whole company's, whichever group is drawn.
    const order = orderByLatest(seriesOf(wholeGroup)).map((dimension) => dimension.key)
    const series = seriesOf(active)
    const dimensions = order.flatMap((key) => series.filter((dimension) => dimension.key === key))
    const points = waves.map((wave) => active?.points.find((candidate) => candidate.surveyId === wave.id))
    // The server pads a group that did not exist in a wave with a suppressed point, so an
    // absent one is treated as withheld rather than as a reading of nothing.
    const withheld = points.map((point) => point === undefined || point.isSuppressed)
    const respondents = points.map((point) => (point === undefined || point.isSuppressed ? null : point.respondentCount))

    return {
      companyName,
      target: CLIMATE_TARGET,
      floor: whole.minimumGroupSize,
      waves,
      withheld,
      respondents,
      dimensions,
      groups,
      selectedGroup: activeKey,
      suppressedGroupCount: byDepartment.suppressedGroupCount,
      openWave: openWaveOf(open, scope.companyId),
    }
  }, [payloads, selectedGroup, companyName, locale, t, scope.companyId])

  if (error !== null) return { status: 'error', model: null, error, retry, selectGroup: setSelectedGroup }
  if (model === null) return { status: 'loading', model: null, error: null, retry, selectGroup: setSelectedGroup }
  return { status: 'ready', model, error: null, retry, selectGroup: setSelectedGroup }
}
