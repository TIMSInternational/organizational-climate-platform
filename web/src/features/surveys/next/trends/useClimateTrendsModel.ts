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
import { buildClimateTrendMap, type ClimateTrendMapModel } from '../../climateTrendsMap'
import { dimensionLabel } from '../../dimensionLabel'
import type { ClimateTrendsNextModel, TrendDimension, TrendGroup, TrendWave } from './model'
import { SAMPLE_TARGET } from './sampleModel'

export type ClimateTrendsStatus = 'loading' | 'ready' | 'error'

export interface ClimateTrendsModelState {
  status: ClimateTrendsStatus
  /** Present exactly when `status === 'ready'`. */
  model: ClimateTrendsNextModel | null
  /** The numbers grid for the selected group, as `ClimateMap` draws it; `null` when nothing can be drawn. */
  table: ClimateTrendMapModel | null
  error: string | null
  retry: () => void
  selectGroup: (key: string) => void
}

/**
 * The model behind `/surveys/climate-trends/next` — THE wiring seam of that screen.
 *
 * Two requests, both through the existing client: the ungrouped series (the whole
 * company) and the department breakdown. The server returns one grouping per call
 * (`groups` holds departments OR the `__company__` series, never both), and the
 * segmented control needs every group at once so a click redraws without a round
 * trip. Both carry the resolved `companyId`, for the reason `ClimateTrendsPage`
 * gives: an explicit id is refused when mismatched rather than silently rescoped.
 *
 * `enabled` is the caller's role gate (see the effect): the request is only made
 * for a viewer the server would answer.
 *
 * The target is the one figure no endpoint provides (`sampleModel.ts`), so `isSample`
 * is `true` and the page says so wherever the target is read.
 */
export function useClimateTrendsModel(enabled: boolean): ClimateTrendsModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyName = useCompanyName()

  const [payloads, setPayloads] = useState<{ whole: ClimateTrendsResponse; byDepartment: ClimateTrendsResponse } | null>(null)
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
    ])
      .then(([whole, byDepartment]) => {
        if (!cancelled) setPayloads({ whole, byDepartment })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '')
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, attempt, enabled, scope.companyId, scope.status, locale])

  const retry = useCallback(() => setAttempt((previous) => previous + 1), [])

  const derived = useMemo(() => {
    if (payloads === null) return null
    const { whole, byDepartment } = payloads
    const wholeGroup = whole.groups.find((group) => group.key === WHOLE_COMPANY_KEY) ?? whole.groups[0] ?? null
    // The grouped response never carries the `__company__` series on the real API; a
    // fixture that answers both requests alike would, and two segments with one key is
    // a duplicate-key render. Filtered, so the control lists the whole company once.
    const departments = byDepartment.groups.filter((group) => group.key !== WHOLE_COMPANY_KEY)
    const groups: TrendGroup[] = [
      { key: WHOLE_COMPANY_KEY, name: null },
      ...departments.map((group) => ({ key: group.key, name: group.label ?? group.key })),
    ]
    const active: ClimateTrendGroup | null =
      selectedGroup === WHOLE_COMPANY_KEY
        ? wholeGroup
        : (departments.find((group) => group.key === selectedGroup) ?? wholeGroup)
    const activeKey = active === null || active.key !== selectedGroup ? WHOLE_COMPANY_KEY : selectedGroup
    const source = activeKey === WHOLE_COMPANY_KEY ? whole : byDepartment

    const waves: TrendWave[] = whole.surveys.map((survey) => ({
      id: survey.surveyId,
      name: survey.title,
      closedAt: survey.endDate,
      completedCount: survey.completedCount,
      status: survey.status,
    }))
    const pointFor = (surveyId: string) => active?.points.find((point) => point.surveyId === surveyId) ?? null
    const dimensions: TrendDimension[] = whole.dimensions.map((dimension, dimensionIndex) => ({
      key: dimension.key,
      name: dimensionLabel(dimension.key, t),
      values: waves.map((wave) => {
        const point = pointFor(wave.id)
        if (point === null || point.isSuppressed) return null
        return point.scores[dimensionIndex] ?? null
      }),
    }))

    const model: ClimateTrendsNextModel = {
      isSample: true,
      companyName,
      target: SAMPLE_TARGET,
      floor: whole.minimumGroupSize,
      waves,
      dimensions,
      groups,
      selectedGroup: activeKey,
      suppressedGroupCount: byDepartment.suppressedGroupCount,
    }
    const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short' })
    const table = active === null ? null : buildClimateTrendMap(source, active, formatDate)
    return { model, table }
  }, [payloads, selectedGroup, companyName, locale, t])

  if (error !== null) return { status: 'error', model: null, table: null, error, retry, selectGroup: setSelectedGroup }
  if (derived === null) return { status: 'loading', model: null, table: null, error: null, retry, selectGroup: setSelectedGroup }
  return { status: 'ready', model: derived.model, table: derived.table, error: null, retry, selectGroup: setSelectedGroup }
}
