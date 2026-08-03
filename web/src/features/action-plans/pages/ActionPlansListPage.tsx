import { useEffect, useState } from 'react'
import { listActionPlans, createActionPlan, type ActionPlan, type CreateActionPlanInput } from '../api/actionPlans'
import { listActionPlanTemplates, type ActionPlanTemplate } from '../api/actionPlanTemplates'
import ActionPlanList from '../components/ActionPlanList'
import ActionPlanFilters, { type ActionPlanFiltersValue } from '../components/ActionPlanFilters'
import ActionPlanForm, { type ActionPlanFormValues } from '../components/ActionPlanForm'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { useTranslation } from '../../../i18n'

// This slice has no company-picker UI yet (org-structure's admin shell doesn't
// expose a "current company" concept for a SuperAdmin browsing across
// companies). CompanyAdmin's own companyId comes straight off their JWT
// claims -- the same source AdminLayout.tsx already uses for nav/routing --
// so every CompanyAdmin sees and creates action plans for their own company,
// not a globally-configured one.
//
// SuperAdmin is deliberately NOT routed down the same "use claims.companyId"
// path. Unlike CompanyAdmin, SuperAdmin *does* always carry a companyId claim
// (JwtTokenService emits it unconditionally off the non-nullable User.CompanyId
// column) -- so falling through to that path wouldn't error, it would quietly
// scope a SuperAdmin to whatever single company their own user row happens to
// point at, with no picker and no indication anything was scoped at all,
// including any plan they went on to create. Block it explicitly instead until
// #57 (cross-cutting company-context selector) lands.
export default function ActionPlansListPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  const isSuperAdmin = role === 'super_admin'
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [templates, setTemplates] = useState<ActionPlanTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActionPlanFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    if (!companyId || isSuperAdmin) return
    setLoading(true)
    setError(null)
    try {
      const [plansResult, templatesResult] = await Promise.all([
        listActionPlans(baseUrl, companyId),
        listActionPlanTemplates(baseUrl, companyId),
      ])
      setPlans(plansResult)
      setTemplates(templatesResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = plans.filter((plan) => !filters.status || plan.status === filters.status)

  async function handleCreate(values: ActionPlanFormValues) {
    if (!companyId || isSuperAdmin) return
    const input: CreateActionPlanInput = {
      title: values.title,
      description: values.description,
      companyId,
      dueDate: values.dueDate,
      priority: values.priority,
      kpis: values.kpis,
      objectives: values.objectives,
    }
    if (values.templateId) {
      input.templateId = values.templateId
    }
    await createActionPlan(baseUrl, input)
    setShowCreateForm(false)
    await reload()
  }

  if (isSuperAdmin) {
    return (
      <p role="alert">
        {t('common.superAdminScopedBrowsingUnavailable', { feature: t('navigation.actionPlans') })}
      </p>
    )
  }

  if (!companyId) {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>{t('navigation.actionPlans')}</h1>
      <ActionPlanFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? t('common.cancel') : t('common.newActionPlan')}</button>
      {showCreateForm && <ActionPlanForm templates={templates} onSubmit={handleCreate} />}
      {loading ? <p>{t('common.loading')}</p> : <ActionPlanList plans={filtered} />}
    </div>
  )
}
