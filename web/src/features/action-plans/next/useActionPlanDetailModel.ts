import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { todayCalendarDay } from '../../../lib/calendarDay'
import {
  getActionPlan,
  listActionPlans,
  recordProgress as postProgress,
  updateActionPlan,
  type ActionPlanDetail,
  type ProgressUpdateDetail,
} from '../api/actionPlans'
import { listActionPlanTemplates } from '../api/actionPlanTemplates'
import type { ProgressUpdateFormValues } from '../components/ProgressUpdateForm'
import { listDepartments } from '../../org-structure/api/departments'
import { getUser } from '../../org-structure/api/users'
import { listSurveys } from '../../surveys/api/surveys'
import { DEPARTMENT_GROUP, getClimateTrends } from '../../surveys/api/climateTrends'
import { CLIMATE_TARGET, latestClosedSurvey } from '../../dashboard/next/compose'
import { planFinding, type PlanFinding } from './derive'
import type { ActionPlanDetailModel, Settled } from './model'

export interface ActionPlanDetailState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  model: ActionPlanDetailModel | null
  /** A status or priority change is in flight. */
  saving: boolean
  /** The server's refusal of the last change — shown beside the plan, never instead of it. */
  actionError: string | null
  reload: () => void
  changeStatus: (status: string) => Promise<void>
  changePriority: (priority: string) => Promise<void>
  /** Rejects with the server's message; `ProgressUpdateForm` renders it beside its fields. */
  recordProgress: (values: ProgressUpdateFormValues) => Promise<void>
}

const LOADING = { status: 'loading' } as const

async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { status: 'ready', value: await work() }
  } catch {
    return { status: 'failed' }
  }
}

/**
 * THE wiring seam of `/action-plans/:id`: the plan through `getActionPlan` — the same read
 * and the same writes (`updateActionPlan`, `recordProgress`) as `ActionPlanDetailPage`, the
 * page this replaced — plus the enrichments `model.ts` tabulates, each settled on its own.
 *
 * `enabled` is false for a viewer the server would refuse (`GET /action-plans/{id}` is
 * `CanAccessCompany`: an administrator), so a leader who typed the URL sends nothing.
 */
export function useActionPlanDetailModel(id: string | undefined, enabled: boolean): ActionPlanDetailState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [plan, setPlan] = useState<ActionPlanDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [departmentName, setDepartmentName] = useState<Settled<string | null>>(LOADING)
  const [authorName, setAuthorName] = useState<Settled<string | null>>(LOADING)
  const [createdAt, setCreatedAt] = useState<Settled<string | null>>(LOADING)
  const [templateName, setTemplateName] = useState<Settled<string | null>>(LOADING)
  const [finding, setFinding] = useState<Settled<PlanFinding>>(LOADING)
  const [recorded, setRecorded] = useState<ProgressUpdateDetail[]>([])
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  const reload = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!enabled || !id) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    getActionPlan(baseUrl, id, locale)
      .then((loaded) => {
        if (cancelled) return
        setPlan(loaded)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, enabled, generation, id, locale, t])

  // The enrichments hang off the plan's own company, department, author and template, so
  // they wait for it and re-run only when one of those changes — not on a status change.
  const companyId = plan?.companyId
  const departmentId = plan?.departmentId ?? null
  const createdBy = plan?.createdBy
  const templateId = plan?.templateId ?? null
  const planId = plan?.id

  useEffect(() => {
    if (!companyId || !planId) return
    let cancelled = false
    const apply = <T,>(setter: (value: Settled<T>) => void) => (value: Settled<T>) => {
      if (!cancelled) setter(value)
    }

    if (departmentId === null) setDepartmentName({ status: 'ready', value: null })
    else
      void settle(async () => {
        const departments = await listDepartments(baseUrl, companyId)
        return departments.find((department) => department.id === departmentId)?.name ?? null
      }).then(apply(setDepartmentName))

    if (createdBy)
      void settle(async () => (await getUser(baseUrl, createdBy)).name || null).then(apply(setAuthorName))
    else setAuthorName({ status: 'ready', value: null })

    void settle(async () => {
      const plans = await listActionPlans(baseUrl, companyId, {}, locale)
      return plans.find((candidate) => candidate.id === planId)?.createdAt ?? null
    }).then(apply(setCreatedAt))

    if (templateId === null) setTemplateName({ status: 'ready', value: null })
    else
      void settle(async () => {
        const templates = await listActionPlanTemplates(baseUrl, companyId)
        return templates.find((template) => template.id === templateId)?.name ?? null
      }).then(apply(setTemplateName))

    void settle(async () => {
      const [surveys, trends] = await Promise.all([
        listSurveys(baseUrl, { companyId }, locale),
        getClimateTrends(
          baseUrl,
          departmentId === null ? { companyId, lang: locale } : { groupBy: DEPARTMENT_GROUP, companyId, lang: locale },
        ),
      ])
      const latest = latestClosedSurvey(surveys)
      return planFinding(trends, latest?.id ?? null, departmentId, CLIMATE_TARGET)
    }).then(apply(setFinding))

    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, createdBy, departmentId, locale, planId, templateId])

  const change = useCallback(
    async (patch: { status?: string; priority?: string }) => {
      if (!id) return
      setActionError(null)
      setSaving(true)
      try {
        // `UpdateAsync` answers with the whole recomputed detail, so the chips, the menus and
        // the Ficha cannot disagree for a frame.
        setPlan(await updateActionPlan(baseUrl, id, patch))
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t('errors.generic'))
      } finally {
        setSaving(false)
      }
    },
    [baseUrl, id, t],
  )

  const recordProgress = useCallback(
    async (values: ProgressUpdateFormValues) => {
      if (!id) return
      setActionError(null)
      const update = await postProgress(baseUrl, id, values)
      setRecorded((current) => [...current, update])
      // The POST answers with the update row alone; new KPI and objective values need a GET.
      setPlan(await getActionPlan(baseUrl, id, locale))
    },
    [baseUrl, id, locale],
  )

  const model: ActionPlanDetailModel | null = plan
    ? { plan, asOf: todayCalendarDay(), departmentName, authorName, createdAt, templateName, finding, recorded }
    : null

  return {
    status,
    error,
    model,
    saving,
    actionError,
    reload,
    changeStatus: (next) => change({ status: next }),
    changePriority: (next) => change({ priority: next }),
    recordProgress,
  }
}
