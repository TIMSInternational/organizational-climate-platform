import { useCallback, useEffect, useState } from 'react'
import { listActionPlans, createActionPlan, type ActionPlan, type CreateActionPlanInput } from '../api/actionPlans'
import { listActionPlanTemplates, type ActionPlanTemplate } from '../api/actionPlanTemplates'
import ActionPlanList from '../components/ActionPlanList'
import ActionPlanFilters, { type ActionPlanFiltersValue } from '../components/ActionPlanFilters'
import ActionPlanForm, { type ActionPlanFormValues } from '../components/ActionPlanForm'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { EmptyState } from '../../../components/ui'

// Company scope comes from `useCompanyScope()` (#124), not from the JWT claim
// this page used to read directly.
//
// The comment that stood here said SuperAdmin was blocked outright because
// "SuperAdmin *does* always carry a companyId claim (JwtTokenService emits it
// unconditionally off the non-nullable User.CompanyId column)", so falling
// through to the claim would have scoped them to whatever single company their
// own user row pointed at, silently. Both halves of that have moved:
//
//   - #191 made `User.CompanyId` a `Guid?`, so a global SuperAdmin's claim is now
//     the empty string rather than a real company. The claim is no longer a wrong
//     answer; it is no answer at all.
//   - #124 supplies the picker the block was waiting for. `resolveCompanyScope`
//     is where the "never fall back to a SuperAdmin's own claim" rule now lives,
//     for every page at once instead of once per page.
//
// So the role is no longer blocked. It is asked. A SuperAdmin with nothing
// selected gets `status: 'needs-selection'` and the prompt below -- never a
// company chosen for them.
export default function ActionPlansListPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [templates, setTemplates] = useState<ActionPlanTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActionPlanFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  // `useCallback` + `[reload]` rather than the `[]` this page used to run on:
  // the company can now change *while the page is mounted*, and a mount-only
  // effect would leave company A's plans on screen under a header that says
  // company B -- a half-applied scope switch, which is the same class of lie the
  // silent scoping was.
  const reload = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
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
  }, [baseUrl, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = plans.filter((plan) => !filters.status || plan.status === filters.status)

  async function handleCreate(values: ActionPlanFormValues) {
    if (!companyId) return
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

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.actionPlans')}
        description={t('navigation.actionPlansDesc')}
        actions={
          <button onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? t('common.cancel') : t('common.newActionPlan')}
          </button>
        }
      />
      <ActionPlanFilters value={filters} onChange={setFilters} />
      {showCreateForm && <ActionPlanForm templates={templates} onSubmit={handleCreate} />}
      {loading ? <p>{t('common.loading')}</p> : <ActionPlanList plans={filtered} />}
    </div>
  )
}
