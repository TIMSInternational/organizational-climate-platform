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
import { rollUpActionPlans } from '../actionPlanRollup'
import { listDepartments } from '../../org-structure/api/departments'
import { useCompanyScope } from '../../../company-context'
import { KpiTile } from '../../../components/charts'
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
  // Department id → name, for the listing's `From` column. A Map rather than the
  // raw array so the table does a lookup per row instead of a scan per row.
  const [departmentNames, setDepartmentNames] = useState<ReadonlyMap<string, string>>(new Map())
  // Whether that lookup has *settled* — separately from what it settled to,
  // because an empty map is a real answer (a company with no departments, or a
  // failed request the column degrades over) and is indistinguishable from the
  // initial value. Without this the table renders "Department not listed" against
  // every departmented plan for the whole window between the two responses and
  // then flips to the real name: a false provenance claim on the one column this
  // screen was redesigned around. See the gate on `LoadingRegion` below.
  const [departmentsSettled, setDepartmentsSettled] = useState(false)
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

  // The `From` column's names. Failure is silent for the same reason templates'
  // is: the column degrades to "Department not listed" (see `ActionPlanList`),
  // whereas failing the page would hide every plan because one lookup table was
  // unreachable. `GET /admin/departments` is gated by the same `CanAccessCompany`
  // rule as `GET /action-plans`, so anyone who can see these rows can see these
  // names -- this adds no permission the page did not already need.
  //
  // "Degrades to not-listed" is only honest once the request has *finished*.
  // `setDepartmentsSettled(true)` is in a `finally`, so it runs on the success
  // path, on the failure path, and on the no-company path -- the table must never
  // be waiting on a request that will never be made.
  const loadDepartments = useCallback(async () => {
    if (!companyId) {
      setDepartmentsSettled(true)
      return
    }
    // Reset on a company switch as well as on mount: company A's names are not an
    // answer about company B's plans, and leaving this true would put the same
    // false "not listed" on screen for the length of the second request.
    setDepartmentsSettled(false)
    try {
      const departments = await listDepartments(baseUrl, companyId)
      setDepartmentNames(new Map(departments.map((department) => [department.id, department.name])))
    } catch {
      setDepartmentNames(new Map())
    } finally {
      setDepartmentsSettled(true)
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    void loadDepartments()
  }, [loadDepartments])

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

  // Over the *unfiltered* set, and recomputed only when it changes. `now` is read
  // once per roll-up rather than once per plan so every tile is counted against
  // the same day.
  const rollup = useMemo(() => rollUpActionPlans(plans, new Date()), [plans])

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
        // The longer line, not `navigation.actionPlansDesc` ("Track improvement
        // initiatives"): the nav blurb has to fit a tooltip, and this header is
        // where the screen gets to say what the `From` column is for.
        description={t('actionPlans.listDescription')}
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

      {/* The KPI strip, ahead of the filters: the shape of the workload is read
          before it is filtered. Counts come from the unfiltered `plans`,
          deliberately — a strip that moved with the filter would be describing the
          filter rather than the company.

          `KpiTile` rather than `KPIDisplay`. They are not duplicates (see
          `charts/KpiTile.tsx`): `KPIDisplay` is a card grid for when the KPI *is*
          the content, and this is the flat four-across strip from the redesign,
          where the number is context for the table below it. The value lands in
          mono with tabular figures, which the card grid does not do and which is
          the one typographic rule that makes the product read as an instrument. */}
      {!loading && !loadError && plans.length > 0 && (
        <div className="mb-panel-gap grid grid-cols-2 gap-inline lg:grid-cols-4">
          <KpiTile
            label={t('actionPlans.kpiOpen')}
            value={rollup.open}
            locale={locale}
            sub={t('actionPlans.kpiOpenSub', { count: rollup.dueThisMonth })}
          />
          <KpiTile
            label={t('actionPlans.kpiOnTrack')}
            value={rollup.onTrack}
            locale={locale}
            sub={t('actionPlans.kpiOnTrackSub')}
          />
          <KpiTile
            label={t('actionPlans.kpiAtRisk')}
            value={rollup.atRisk}
            locale={locale}
            sub={t('actionPlans.kpiAtRiskSub')}
          />
          <KpiTile
            label={t('actionPlans.kpiCompleted')}
            value={rollup.completed}
            locale={locale}
            sub={t('actionPlans.kpiCompletedSub')}
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
        //
        // Gated on the departments lookup too, not on `listActionPlans` alone.
        // The two run in parallel, so the wait is the slower of them rather than
        // their sum -- and a table that renders first would spend that window
        // asserting "Department not listed" on rows whose department it is about
        // to name. The strip and the filters above are not gated: neither depends
        // on the lookup, and neither can be wrong while it is in flight.
        <LoadingRegion loading={loading || !departmentsSettled} label={t('common.loading')}>
          {loading || !departmentsSettled ? (
            <SkeletonText lines={4} />
          ) : (
            <ActionPlanList
              plans={visible}
              filtered={Boolean(filters.status || filters.priority || filters.q.trim())}
              departmentNames={departmentNames}
            />
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
