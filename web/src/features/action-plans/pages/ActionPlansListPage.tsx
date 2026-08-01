import { useEffect, useState } from 'react'
import { listActionPlans, createActionPlan, type ActionPlan } from '../api/actionPlans'
import ActionPlanList from '../components/ActionPlanList'
import ActionPlanFilters, { type ActionPlanFiltersValue } from '../components/ActionPlanFilters'
import ActionPlanForm, { type ActionPlanFormValues } from '../components/ActionPlanForm'

// This slice has no company-picker UI yet (org-structure's admin shell doesn't
// expose a "current company" concept for a CompanyAdmin browsing their own
// data outside /admin/companies/:id) -- VITE_DEFAULT_COMPANY_ID is a stopgap
// read directly from env for local/manual testing until #57 (cross-cutting
// frontend) or a later pass adds a real company-context selector.
export default function ActionPlansListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = import.meta.env.VITE_DEFAULT_COMPANY_ID as string
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
    return <p role="alert">VITE_DEFAULT_COMPANY_ID is not configured.</p>
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
