import { useEffect, useState } from 'react'
import { listActionPlans, createActionPlan, type ActionPlan } from '../api/actionPlans'
import ActionPlanList from '../components/ActionPlanList'
import ActionPlanFilters, { type ActionPlanFiltersValue } from '../components/ActionPlanFilters'
import ActionPlanForm, { type ActionPlanFormValues } from '../components/ActionPlanForm'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'

// This slice has no company-picker UI yet (org-structure's admin shell doesn't
// expose a "current company" concept for a SuperAdmin browsing across
// companies). CompanyAdmin's own companyId comes straight off their JWT
// claims -- the same source AdminLayout.tsx already uses for nav/routing --
// so every CompanyAdmin sees and creates action plans for their own company,
// not a globally-configured one. SuperAdmin has no companyId claim at all;
// until #57 (cross-cutting frontend) adds a real company-context selector,
// SuperAdmin simply can't use this page yet.
export default function ActionPlansListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActionPlanFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listActionPlans(baseUrl, companyId)
      setPlans(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load action plans')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = plans.filter((plan) => !filters.status || plan.status === filters.status)

  async function handleCreate(values: ActionPlanFormValues) {
    if (!companyId) return
    await createActionPlan(baseUrl, {
      title: values.title,
      description: values.description,
      companyId,
      dueDate: values.dueDate,
      priority: values.priority,
      kpis: values.kpis,
      objectives: values.objectives,
    })
    setShowCreateForm(false)
    await reload()
  }

  if (!companyId) {
    return <p role="alert">No company is associated with your account.</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Action Plans</h1>
      <ActionPlanFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New action plan'}</button>
      {showCreateForm && <ActionPlanForm onSubmit={handleCreate} />}
      {loading ? <p>Loading…</p> : <ActionPlanList plans={filtered} />}
    </div>
  )
}
