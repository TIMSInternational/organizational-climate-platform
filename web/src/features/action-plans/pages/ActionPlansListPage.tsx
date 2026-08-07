import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  listActionPlans,
  createActionPlan,
  type ActionPlan,
  type CreateActionPlanInput,
} from '../api/actionPlans'
import { listActionPlanTemplates, type ActionPlanTemplate } from '../api/actionPlanTemplates'
import ActionPlanList from '../components/ActionPlanList'
import ActionPlanFilters from '../components/ActionPlanFilters'
import {
  EMPTY_ACTION_PLAN_FILTERS,
  type ActionPlanFiltersValue,
} from '../actionPlanFilterState'
import ActionPlanForm, { type ActionPlanFormValues } from '../components/ActionPlanForm'
import { useCompanyScope } from '../../../company-context'
import { Target, Loader, CircleCheck, TriangleAlert } from 'lucide-react'
import { KPIDisplay } from '../../../components/charts'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

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
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const [plans, setPlans] = useState<ActionPlan[]>([])
  const [templates, setTemplates] = useState<ActionPlanTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActionPlanFiltersValue>(EMPTY_ACTION_PLAN_FILTERS)
  const [showCreateForm, setShowCreateForm] = useState(false)
  // The plan the viewer just created, so the confirmation can name it and link to
  // it. Cleared when the form is reopened.
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null)

  // Destructured so the fetch depends on the *status* filter alone. Depending on
  // the whole `filters` object would refetch on every keystroke in the search box,
  // which is neither wanted nor needed -- search is narrowed client-side.
  const { status: statusFilter } = filters

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
    setLoadError(null)
    try {
      setPlans(await listActionPlans(baseUrl, companyId, { status: statusFilter }))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, statusFilter, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Templates are fetched separately, and a failure here is deliberately silent.
  // They feed one optional field of the create form; blanking the whole listing
  // because the template catalogue was unreachable would be a much worse outcome
  // than the picker simply not appearing (`ActionPlanForm` hides it when empty).
  const loadTemplates = useCallback(async () => {
    if (!companyId) return
    try {
      setTemplates(await listActionPlanTemplates(baseUrl, companyId))
    } catch {
      setTemplates([])
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  /**
   * Priority and title search, narrowed here rather than on the wire.
   *
   * `ListAsync` takes no parameter for either, and returns the company's complete
   * set in one response, so this is exact — see `ActionPlanFilters` for the full
   * reasoning and for what must change if that endpoint ever grows paging.
   */
  const visible = useMemo(() => {
    const needle = filters.q.trim().toLocaleLowerCase()
    return plans.filter(
      (plan) =>
        (!filters.priority || plan.priority === filters.priority) &&
        (!needle || plan.title.toLocaleLowerCase().includes(needle)),
    )
  }, [plans, filters.priority, filters.q])

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
    // Deliberately not caught: `ActionPlanForm` awaits this call and renders the
    // rejection itself, next to the fields that are still filled in. Catching it
    // here would swallow the server's message and close a form whose contents the
    // user would then have to retype.
    const plan = await createActionPlan(baseUrl, input)
    setShowCreateForm(false)
    setCreated({ id: plan.id, title: plan.title })
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

  return (
    <div>
      <PageTopBar
        title={t('navigation.actionPlans')}
        description={t('navigation.actionPlansDesc')}
        actions={
          <Button
            type="button"
            variant={showCreateForm ? 'outline' : 'default'}
            onClick={() => {
              setCreated(null)
              setShowCreateForm((open) => !open)
            }}
          >
            {showCreateForm ? t('common.cancel') : t('common.newActionPlan')}
          </Button>
        }
      />

      {/* A plain `Alert`, not `destructive`: this is the good outcome. The link is
          the point -- a new plan is created with no KPI values recorded yet, so the
          next thing the user wants is its detail page. */}
      {created && (
        <Alert role="status" className="mb-panel-gap">
          <AlertDescription>
            {t('actionPlans.createdSuccess', { title: created.title })}{' '}
            <Link to={`/action-plans/${created.id}`}>{t('common.viewDetails')}</Link>
          </AlertDescription>
        </Alert>
      )}

      {showCreateForm && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('actionPlans.createActionPlan')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionPlanForm
              templates={templates}
              onSubmit={handleCreate}
              onCancel={() => setShowCreateForm(false)}
            />
          </CardContent>
        </Card>
      )}

      {/* A KPI band ahead of the filters, matching the ForMaps admin shell: the
          shape of the workload is read before it is filtered. Counts come from the
          unfiltered `plans`, deliberately — a band that moved with the filter would
          be describing the filter rather than the company. */}
      {!loading && !loadError && plans.length > 0 && (
        <div className="mb-panel-gap">
          <KPIDisplay
            columns={4}
            locale={locale}
            kpis={[
              { id: 'total', label: t('actionPlans.kpiTotalPlans'), value: plans.length, icon: Target },
              {
                id: 'in-progress',
                label: t('actionPlans.kpiInProgress'),
                value: plans.filter((plan) => plan.status === 'in_progress').length,
                icon: Loader,
              },
              {
                id: 'completed',
                label: t('actionPlans.kpiCompleted'),
                value: plans.filter((plan) => plan.status === 'completed').length,
                icon: CircleCheck,
              },
              {
                id: 'overdue',
                label: t('actionPlans.kpiOverdue'),
                // Past its due date and not finished. `completed` is excluded rather
                // than counted late: a plan delivered after its date is done, and
                // showing it as overdue would tell someone to chase it.
                value: plans.filter(
                  (plan) => plan.status !== 'completed' && new Date(plan.dueDate) < new Date(),
                ).length,
                icon: TriangleAlert,
                // Up is bad here, so the change indicator must not paint a rise green.
                higherIsBetter: false,
              },
            ]}
          />
        </div>
      )}

      <ActionPlanFilters
        value={filters}
        onChange={setFilters}
        resultCount={visible.length}
        disabled={loading}
      />

      {loadError ? (
        <NetworkError
          title={t('errors.generic')}
          description={loadError}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        // `LoadingRegion` already announces `common.loading` in an sr-only live
        // region, so the visible placeholder is a skeleton rather than a second
        // copy of the same word.
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : (
            <ActionPlanList
              plans={visible}
              filtered={Boolean(filters.status || filters.priority || filters.q.trim())}
            />
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
