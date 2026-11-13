import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { isApiStatus } from '../../../api/authFetch'
import { todayCalendarDay } from '../../../lib/calendarDay'
import {
  deleteActionPlan,
  getActionPlan,
  listActionPlans,
  listProgress,
  recordProgress as postProgress,
  updateActionPlan,
  type ActionPlanDetail,
  type ProgressUpdateDetail,
} from '../api/actionPlans'
import { listActionPlanTemplates } from '../api/actionPlanTemplates'
import type { ProgressUpdateFormValues } from '../components/ProgressUpdateForm'
import { listDepartments } from '../../org-structure/api/departments'
import { getUser, listUsers } from '../../org-structure/api/users'
import { listSurveys } from '../../surveys/api/surveys'
import { DEPARTMENT_GROUP, getClimateTrends } from '../../surveys/api/climateTrends'
import { latestClosedSurvey } from '../../dashboard/next/compose'
import { findingFromTags } from './useActionPlansListModel'
import { planFinding, planMove, type PlanFinding, type PlanMove } from './planDetailDerive'
import type { ActionPlanDetailModel, Settled } from './planDetailModel'
import { describeApiError } from '../../../api/describeApiError'

export interface ActionPlanDetailState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /**
   * The server refused this reader the plan (403): somebody who is neither an administrator
   * nor its owner. The page says whose plan it is instead of printing the raw refusal.
   */
  forbidden: boolean
  model: ActionPlanDetailModel | null
  /** A status or priority change is in flight. */
  saving: boolean
  /** The server's refusal of the last change — shown beside the plan, never instead of it. */
  actionError: string | null
  reload: () => void
  changeStatus: (status: string) => Promise<void>
  changePriority: (priority: string) => Promise<void>
  /** Hand the plan to somebody, or `null` to take it back. */
  changeOwner: (ownerId: string | null) => Promise<void>
  /** Rejects with the server's message; `ProgressUpdateForm` renders it beside its fields. */
  recordProgress: (values: ProgressUpdateFormValues) => Promise<void>
  /**
   * Correct what the plan says: its title, description, due day and tags (`PUT
   * /action-plans/{id}`). Rejects with the server's message so the edit form keeps what the
   * reader typed and says why.
   */
  editPlan: (values: PlanEdit) => Promise<void>
  /** `DELETE /action-plans/{id}`. Rejects with the server's message. */
  deletePlan: () => Promise<void>
}

/** The fields the edit form corrects. `dueDate` is a calendar day, `YYYY-MM-DD`. */
export interface PlanEdit {
  title: string
  description: string
  dueDate: string
  tags: string[]
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
 * `enabled` is false while there is nobody the server could answer -- no company in scope.
 * `GET /action-plans/{id}` answers an administrator of the plan's company and the plan's own
 * OWNER (`ActionPlanEndpoints.CanReadAsOwner`); anyone else is told so by a 403.
 *
 * `administers` is false for that owner. The enrichments behind it -- the department
 * directory, the user directory, the template catalogue and the climate-trends read the
 * finding is joined from -- are administrator reads, so none of them is sent: each region
 * is settled from what the plan itself carries, or left to say the administration reads it.
 */
export function useActionPlanDetailModel(
  id: string | undefined,
  enabled: boolean,
  administers = true,
): ActionPlanDetailState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [plan, setPlan] = useState<ActionPlanDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [departmentName, setDepartmentName] = useState<Settled<string | null>>(LOADING)
  const [authorName, setAuthorName] = useState<Settled<string | null>>(LOADING)
  const [createdAt, setCreatedAt] = useState<Settled<string | null>>(LOADING)
  const [templateName, setTemplateName] = useState<Settled<string | null>>(LOADING)
  const [finding, setFinding] = useState<Settled<PlanFinding>>(LOADING)
  const [move, setMove] = useState<Settled<PlanMove>>(LOADING)
  const [owners, setOwners] = useState<Settled<readonly { id: string; name: string }[]>>(LOADING)
  const [history, setHistory] = useState<Settled<ProgressUpdateDetail[]>>(LOADING)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  const reload = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    if (!enabled || !id) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    setForbidden(false)
    // The history is the plan's own and readable by whoever may read the plan; it is settled
    // on its own so a failed read costs the Bitácora, never the plan.
    setHistory(LOADING)
    void settle(() => listProgress(baseUrl, id)).then((settled) => {
      if (!cancelled) setHistory(settled)
    })
    getActionPlan(baseUrl, id, locale)
      .then((loaded) => {
        if (cancelled) return
        setPlan(loaded)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setForbidden(isApiStatus(err, 403))
        setError(describeApiError(err, t))
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
  const planDepartmentName = plan?.departmentName ?? null
  const createdBy = plan?.createdBy
  const templateId = plan?.templateId ?? null
  const planId = plan?.id
  // The plan's own record of where it came from, written by `ResultsCellPanel` when it was
  // raised and returned by the read endpoints since #532.
  const sourceSurveyId = plan?.sourceSurveyId ?? null
  const dimensionKey = findingFromTags(plan?.tags)?.dimensionKey ?? null

  useEffect(() => {
    if (!companyId || !planId) return
    let cancelled = false
    const apply = <T,>(setter: (value: Settled<T>) => void) => (value: Settled<T>) => {
      if (!cancelled) setter(value)
    }

    if (departmentId === null) setDepartmentName({ status: 'ready', value: null })
    // The server joins the name onto the plan now; the directory is the fallback, and only
    // an administrator may read it.
    else if (planDepartmentName !== null) setDepartmentName({ status: 'ready', value: planDepartmentName })
    else if (!administers) setDepartmentName({ status: 'failed' })
    else
      void settle(async () => {
        const departments = await listDepartments(baseUrl, companyId)
        return departments.find((department) => department.id === departmentId)?.name ?? null
      }).then(apply(setDepartmentName))

    if (!administers) {
      // The author's name is a user-directory read, and so is the list of people the plan
      // could be handed to -- which this reader cannot hand it to anyway.
      setAuthorName({ status: 'ready', value: null })
      setOwners({ status: 'ready', value: [] })
      setTemplateName(templateId === null ? { status: 'ready', value: null } : { status: 'failed' })
      setFinding({ status: 'failed' })
      setMove({ status: 'failed' })
      void settle(async () => {
        const plans = await listActionPlans(baseUrl, companyId, {}, locale)
        return plans.find((candidate) => candidate.id === planId)?.createdAt ?? null
      }).then(apply(setCreatedAt))
      return () => {
        cancelled = true
      }
    }

    if (createdBy)
      void settle(async () => (await getUser(baseUrl, createdBy)).name || null).then(apply(setAuthorName))
    else setAuthorName({ status: 'ready', value: null })

    void settle(async () => {
      const plans = await listActionPlans(baseUrl, companyId, {}, locale)
      return plans.find((candidate) => candidate.id === planId)?.createdAt ?? null
    }).then(apply(setCreatedAt))

    // Who the plan can be handed to. The whole company's users, because the server's only
    // rule is that an owner belongs to this tenant — there is no "assignable" role, and
    // inventing one in the client would be a policy the API does not enforce.
    void settle(async () => {
      const users = await listUsers(baseUrl, companyId)
      return users.map((user) => ({ id: user.id, name: user.name }))
    }).then(apply(setOwners))

    if (templateId === null) setTemplateName({ status: 'ready', value: null })
    else
      void settle(async () => {
        const templates = await listActionPlanTemplates(baseUrl, companyId)
        return templates.find((template) => template.id === templateId)?.name ?? null
      }).then(apply(setTemplateName))

    // One read, two readings: the cell the plan was raised from and whether a later wave
    // moved it. They must come from the SAME payload, or the baseline and the comparison
    // could be computed against two different windows.
    void settle(async () => {
      const [surveys, trends] = await Promise.all([
        listSurveys(baseUrl, { companyId }, locale),
        getClimateTrends(
          baseUrl,
          departmentId === null ? { companyId, lang: locale } : { groupBy: DEPARTMENT_GROUP, companyId, lang: locale },
        ),
      ])
      const latest = latestClosedSurvey(surveys)
      const found = planFinding(trends, latest?.id ?? null, departmentId, { sourceSurveyId, dimensionKey })
      return { found, moved: planMove(trends, found, departmentId) }
    }).then((settled) => {
      apply(setFinding)(settled.status === 'ready' ? { status: 'ready', value: settled.value.found } : settled)
      apply(setMove)(settled.status === 'ready' ? { status: 'ready', value: settled.value.moved } : settled)
    })

    return () => {
      cancelled = true
    }
  }, [
    administers,
    baseUrl,
    companyId,
    createdBy,
    departmentId,
    dimensionKey,
    locale,
    planDepartmentName,
    planId,
    sourceSurveyId,
    templateId,
  ])

  const change = useCallback(
    async (patch: { status?: string; priority?: string; ownerId?: string; clearOwner?: boolean }) => {
      if (!id) return
      setActionError(null)
      setSaving(true)
      try {
        // `UpdateAsync` answers with the whole recomputed detail, so the chips, the menus and
        // the Ficha cannot disagree for a frame.
        setPlan(await updateActionPlan(baseUrl, id, patch))
      } catch (err) {
        setActionError(describeApiError(err, t))
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
      // Appended to what the server returned; when that read failed, ask again rather than
      // print one note as if it were the whole history.
      setHistory((current) => (current.status === 'ready' ? { status: 'ready', value: [...current.value, update] } : current))
      void settle(() => listProgress(baseUrl, id)).then((settled) => {
        if (settled.status === 'ready') setHistory(settled)
      })
      // The POST answers with the update row alone; new KPI and objective values need a GET.
      setPlan(await getActionPlan(baseUrl, id, locale))
    },
    [baseUrl, id, locale],
  )

  const editPlan = useCallback(
    async (values: PlanEdit) => {
      if (!id) return
      setActionError(null)
      setPlan(await updateActionPlan(baseUrl, id, values, locale))
    },
    [baseUrl, id, locale],
  )

  const deletePlan = useCallback(async () => {
    if (!id) return
    await deleteActionPlan(baseUrl, id)
  }, [baseUrl, id])

  const model: ActionPlanDetailModel | null = plan
    ? { plan, asOf: todayCalendarDay(), departmentName, authorName, createdAt, templateName, finding, move, owners, history }
    : null

  return {
    status,
    error,
    forbidden,
    model,
    saving,
    actionError,
    reload,
    changeStatus: (next) => change({ status: next }),
    changePriority: (next) => change({ priority: next }),
    // `null` is "take it back", and it has to travel as its own flag: an omitted `ownerId`
    // means "not in this request" to the server, so sending undefined would silently do
    // nothing where the reader asked for an unassignment.
    changeOwner: (next) => (next === null ? change({ clearOwner: true }) : change({ ownerId: next })),
    recordProgress,
    editPlan,
    deletePlan,
  }
}
