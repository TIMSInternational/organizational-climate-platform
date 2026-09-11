import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import {
  createActionPlan,
  listActionPlans,
  updateActionPlan,
  type ActionPlan,
  type CreateActionPlanInput,
} from '../api/actionPlans'
import { listActionPlanTemplates, type ActionPlanTemplate } from '../api/actionPlanTemplates'
import type { ActionPlanFormValues } from '../components/ActionPlanForm'
import { listDepartments } from '../../org-structure/api/departments'
import { isTrackingEnabled } from '../../tracking/api/config'
import { listPlanesAccion, type PlanAccion } from '../../tracking/api/trackingApi'
import { getNodoNames } from '../../tracking/api/trackingPickers'
import { todayIso } from '../../tracking/planDates'
import { sortPlans } from '../../tracking/planOrder'
import { semaforoPresentation, toSemaforoEstado } from '../../tracking/semaforo'
import { firstOverdue, groupOf } from './derive'
import type { ActionPlansListModel, OverdueReading, PlanRow } from './model'
import { SAMPLE_FINDING_BY_TITLE, SAMPLE_OWNER_BY_TITLE } from './sampleModel'

export interface ActionPlansListState {
  /** `idle` while there is no company to ask about — the page says why instead. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  model: ActionPlansListModel
  error: string | null
  reload: () => void
  templates: readonly ActionPlanTemplate[]
  /** `POST /action-plans`; rejects with the server's message so the form can show it. */
  create: (values: ActionPlanFormValues) => Promise<{ id: string; title: string }>
  /** `PUT /action-plans/{id}` with `status: cancelled`; rejects with the server's message. */
  cancelPlan: (id: string) => Promise<void>
}

function isRojo(plan: PlanAccion): boolean {
  const estado = toSemaforoEstado(plan.estadoSemaforo)
  return estado !== null && semaforoPresentation(estado).countKey === 'rojo'
}

/**
 * Where a tracking service is configured, its semáforo IS the seguimiento: the plans it
 * reads `Rojo`, worst-first as `planOrder.sortPlans` ranks them, and the first one's nodo
 * by name. `null` when there is no tracking service or it did not answer — the tile then
 * reads the generic plans instead, which is a different source it says out loud.
 *
 * The nodo names are decorative (`getNodoNames`): a failed lookup costs the tile a name,
 * never the reading.
 */
async function readTrackingOverdue(companyId: string): Promise<OverdueReading | null> {
  if (!isTrackingEnabled()) return null
  try {
    const [plans, names] = await Promise.all([
      listPlanesAccion(),
      getNodoNames(companyId).catch(() => new Map<string, string>()),
    ])
    const behind = sortPlans(plans).filter((plan) => !plan.cumplido && isRojo(plan))
    const first = behind[0]
    return {
      source: 'tracking',
      count: behind.length,
      first: first ? { placeName: names.get(first.nodoExternalId) ?? null, name: first.descripcionQue } : null,
    }
  } catch {
    return null
  }
}

function toRow(plan: ActionPlan, departmentNames: ReadonlyMap<string, string>): PlanRow {
  return {
    id: plan.id,
    name: plan.title,
    departmentId: plan.departmentId,
    departmentName: plan.departmentId ? departmentNames.get(plan.departmentId) ?? null : null,
    status: plan.status,
    priority: plan.priority,
    dueDate: plan.dueDate,
    createdAt: plan.createdAt,
    finding: SAMPLE_FINDING_BY_TITLE[plan.title] ?? null,
    ownerName: SAMPLE_OWNER_BY_TITLE[plan.title] ?? null,
  }
}

function overdueFromPlans(rows: readonly PlanRow[], asOf: string): OverdueReading {
  const behind = rows.filter((row) => groupOf(row, asOf) === 'overdue')
  const first = firstOverdue(rows, asOf)
  return {
    source: 'plans',
    count: behind.length,
    first: first ? { placeName: first.departmentName, name: first.name } : null,
  }
}

/**
 * The model behind `/action-plans` — THE wiring seam of the redesigned Planes de Acción.
 *
 * The same requests the page this replaced made (`ActionPlansListPage.tsx`, kept as the
 * wiring reference): `GET /action-plans` for the company in scope, `GET /admin/departments`
 * for the department names (silent on failure — a name is decorative, the plan is not),
 * and the template catalogue for the create form (silent too). One change of shape: the
 * status filter no longer travels on the wire, because the screen groups by state and
 * needs every state at once; `ListAsync` returns the complete set unpaged, so narrowing
 * here is exact (`derive.applyFilters`).
 *
 * Plus, where a tracking service is configured, `GET /api/planes-accion` and the nodo
 * names for the seguimiento tile — see `readTrackingOverdue`.
 *
 * Company scope is `useCompanyScope()`'s, never the claim read by hand: a SuperAdmin with
 * nothing selected has no `companyId`, this asks for nothing, and the page asks them to
 * choose.
 */
export function useActionPlansListModel(): ActionPlansListState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const companyName = useCompanyName()

  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [departmentNames, setDepartmentNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [tracking, setTracking] = useState<OverdueReading | null>(null)
  const [templates, setTemplates] = useState<ActionPlanTemplate[]>([])
  const [status, setStatus] = useState<ActionPlansListState['status']>(companyId ? 'loading' : 'idle')
  const [error, setError] = useState<string | null>(null)
  // Read once per load so every "in N days" on the screen counts from the same day.
  const [asOf, setAsOf] = useState(() => todayIso())

  const reload = useCallback(async () => {
    if (!companyId) {
      setStatus('idle')
      return
    }
    setStatus('loading')
    setError(null)
    setAsOf(todayIso())
    // In parallel: the table waits for the slower of the plans and their names, never
    // for their sum, and never renders "department not listed" against a row whose
    // department is about to be named.
    const [plansResult, namesResult, trackingResult] = await Promise.allSettled([
      listActionPlans(baseUrl, companyId, {}, locale),
      listDepartments(baseUrl, companyId),
      readTrackingOverdue(companyId),
    ])
    setDepartmentNames(
      namesResult.status === 'fulfilled'
        ? new Map(namesResult.value.map((department) => [department.id, department.name]))
        : new Map(),
    )
    setTracking(trackingResult.status === 'fulfilled' ? trackingResult.value : null)
    if (plansResult.status === 'fulfilled') {
      setPlans(plansResult.value)
      setStatus('ready')
    } else {
      const reason: unknown = plansResult.reason
      setPlans([])
      setError(reason instanceof Error ? reason.message : t('errors.generic'))
      setStatus('error')
    }
  }, [baseUrl, companyId, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    listActionPlanTemplates(baseUrl, companyId)
      .then((items) => {
        if (!cancelled) setTemplates(items)
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])

  const rows = useMemo(() => plans.map((plan) => toRow(plan, departmentNames)), [plans, departmentNames])

  const model = useMemo<ActionPlansListModel>(
    () => ({
      companyName,
      asOf,
      rows,
      findingsAreSample: true,
      ownersAreSample: true,
      overdue: tracking ?? overdueFromPlans(rows, asOf),
    }),
    [companyName, asOf, rows, tracking],
  )

  const create = useCallback(
    async (values: ActionPlanFormValues) => {
      if (!companyId) throw new Error(t('errors.generic'))
      const input: CreateActionPlanInput = {
        title: values.title,
        description: values.description,
        companyId,
        dueDate: values.dueDate,
        priority: values.priority,
        kpis: values.kpis,
        objectives: values.objectives,
      }
      if (values.templateId) input.templateId = values.templateId
      const plan = await createActionPlan(baseUrl, input)
      await reload()
      return { id: plan.id, title: plan.title }
    },
    [baseUrl, companyId, reload, t],
  )

  const cancelPlan = useCallback(
    async (id: string) => {
      await updateActionPlan(baseUrl, id, { status: 'cancelled' })
      await reload()
    },
    [baseUrl, reload],
  )

  return {
    status,
    model,
    error,
    reload: () => {
      void reload()
    },
    templates,
    create,
    cancelPlan,
  }
}
