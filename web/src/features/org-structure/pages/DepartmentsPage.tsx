import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import {
  createDepartment,
  listDepartments,
  updateDepartment,
  type Department,
} from '../api/departments'
import { getCompanyAdminDashboard } from '../../dashboard/api/dashboard'
import DepartmentList, { type DepartmentReading } from '../components/DepartmentList'
import DepartmentForm, { type DepartmentFormValues } from '../components/DepartmentForm'
import { KpiTile, isSuppressed } from '../../../components/charts'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

/**
 * The anonymity floor this screen states and enforces.
 *
 * `charts/ProtectedCell.tsx` defaults to the same 5. It is named here because the
 * page description, the "under the floor" tile and every suppressed cell all have
 * to agree about it, and three separate literals would be three places to drift.
 *
 * A constant rather than a fetched value because there is nothing to fetch:
 * `api/companySettings.ts` carries `anonymousSurveys` and no threshold field, so
 * the platform has no per-company floor to read yet.
 */
const FLOOR = 5

/**
 * Departments, as a destination of their own (#142).
 *
 * ## Why this page exists at all
 *
 * The department CRUD has been reachable only from a block halfway down
 * `CompanyDetailPage`, under a heading, below the company profile and the
 * settings form. `GET /admin/companies/{id}` is **SuperAdmin-only**, so for the
 * role that actually runs a company's org structure — `company_admin` — that page
 * renders its top half as "profile unavailable" and the departments are buried
 * beneath it. Departments are not a company-profile detail; they are the thing
 * surveys, action plans and demographics are all sliced by.
 *
 * ## Scoping: `useCompanyScope`, not the JWT claim
 *
 * The route is a flat `/departments` with no company id in it, like `/surveys`
 * and `/action-plans`, so one nav entry serves both admin roles. The company
 * comes from `company-context` (#124), which encodes the rule this page must not
 * re-invent: **a super_admin's company is their explicit selection and never
 * their own claim.** `GET /admin/departments` takes `companyId` as a *required*
 * query parameter, so there is no "all companies" answer to fall back on — a
 * super_admin who has selected nothing is asked, not guessed at.
 *
 * ## Loading, empty and error are three states, not two
 *
 * A 200 with no rows is a brand-new company that has not been structured yet —
 * `EmptyState`, with the create action right there. A failed request is
 * `NetworkError` with a retry. Collapsing the second into the first would tell an
 * admin their company has no departments when in fact the request never
 * succeeded, which is the failure `AIInsightsPage` documents at length and the
 * reason the two are kept strictly apart here too.
 *
 * ## Filtering is client-side here, deliberately
 *
 * Unlike `SurveyTemplatesPage`, which pushes its filters to the server because
 * the endpoint takes them, `GET /admin/departments` accepts **only** `companyId`.
 * It returns one company's full, flat list ordered by name
 * (`DepartmentEndpoints.cs`, `.OrderBy(d => d.Name)`). Filtering that array in the
 * browser is therefore not a second implementation of a server rule — the server
 * has no such rule — and both the parent-name column and the tree need the whole
 * array in memory regardless.
 *
 * ## The redesign: a structure with a reading on it
 *
 * The screen was a flat alphabetical list with a KPI card grid over it. It is now
 * the reporting structure itself — depth-first, indented, `departmentRows` — with
 * a measurement beside every row and the anonymity floor stated on both. The four
 * numbers above it moved from `KPIDisplay` cards to the redesign's flat `KpiTile`
 * strip, because on this page the numbers are context for the table rather than
 * the content of the page.
 *
 * The fourth tile is new and is the one worth defending: **how many departments
 * can never be reported on their own**. It is derived, not fetched — a department
 * with fewer people than the floor cannot gather enough responses whatever it
 * answers — and it is the number an administrator needs *before* sending a survey,
 * not after.
 */
export default function DepartmentsPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const [departments, setDepartments] = useState<Department[]>([])
  const [readings, setReadings] = useState<ReadonlyMap<string, DepartmentReading> | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)

  // `useCallback` + `[reload]`, not a bare `reload()` with a hand-written
  // dependency array. The seven older pages in this repo use the latter and each
  // of them is a standing `react-hooks(exhaustive-deps)` warning; the lint budget
  // has no room left for an eighth.
  const reload = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    // The two calls are independent and the page must not serialise them, but
    // they are NOT equally important, so this is not a `Promise.all`: that would
    // reject the pair when only the optional half failed.
    //
    // The list is the page. Losing it is `NetworkError` with a retry.
    //
    // The readings are an enrichment: `GET /dashboard/company-admin` is the only
    // response this client can ask for that carries completed responses for more
    // than one department at once (`DashboardDepartmentSummary`; the department
    // dashboard answers for one department at a time). If it fails, the Responses
    // column is dropped rather than filled with zeroes — a zero is a measurement,
    // and "we could not ask" is not one.
    //
    // It answers for at most `DepartmentRowLimit` departments (12, in
    // `DashboardEndpoints.cs`), ordered by name, and no row carries a flag saying
    // the list was cut. `DepartmentList` therefore treats a department absent from
    // this map as unmeasured rather than as a zero; the same rule, one level down.
    const [list, dashboard] = await Promise.allSettled([
      listDepartments(baseUrl, companyId),
      getCompanyAdminDashboard(baseUrl, { companyId, lang: locale }),
    ])

    if (dashboard.status === 'fulfilled') {
      setReadings(
        new Map(
          dashboard.value.departments.map((department) => [
            department.id,
            { responses: department.completedResponseCount },
          ]),
        ),
      )
    } else {
      setReadings(undefined)
    }

    if (list.status === 'fulfilled') {
      setDepartments(list.value)
    } else {
      const reason: unknown = list.reason
      setError(reason instanceof Error ? reason.message : t('errors.generic'))
    }
    setLoading(false)
  }, [baseUrl, companyId, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return departments.filter((department) => {
      if (!showInactive && !department.isActive) return false
      if (!needle) return true
      return (
        department.name.toLowerCase().includes(needle) ||
        (department.description ?? '').toLowerCase().includes(needle)
      )
    })
  }, [departments, query, showInactive])

  const activeCount = departments.filter((department) => department.isActive).length
  const employeeCount = departments.reduce((total, d) => total + d.employeeCount, 0)
  // Structural, not measured: a department with fewer people than the floor can
  // never gather enough responses to be reported on its own, whatever it answers.
  const underFloorCount = departments.filter((department) =>
    isSuppressed(department.employeeCount, FLOOR),
  ).length

  async function handleCreate(values: DepartmentFormValues) {
    if (!companyId) return
    await createDepartment(baseUrl, {
      companyId,
      name: values.name,
      // Empty string is not "no description" on the wire — it is a description of
      // zero characters. `undefined` omits the property, which is what
      // `CreateDepartmentRequest`'s `string?` means.
      description: values.description || undefined,
      parentDepartmentId: values.parentDepartmentId || undefined,
      isActive: values.isActive,
    })
    setCreating(false)
    await reload()
  }

  async function handleUpdate(values: DepartmentFormValues) {
    if (!editing) return
    // No `parentDepartmentId`: `UpdateDepartmentRequest` has no such field, and
    // sending one would be silently dropped. `DepartmentForm` is told to lock the
    // control for the same reason.
    await updateDepartment(baseUrl, editing.id, {
      name: values.name,
      description: values.description,
      isActive: values.isActive,
    })
    setEditing(null)
    await reload()
  }

  if (scope.status === 'needs-selection') {
    return (
      <div>
        <PageTopBar
          title={t('navigation.departments')}
          description={t('departments.pageDescription', { threshold: FLOOR })}
        />
        <EmptyState
          title={t('companyContext.chooseACompany')}
          description={t('companyContext.chooseACompanyDescription')}
        />
      </div>
    )
  }

  if (scope.status === 'no-company') {
    return (
      <div>
        <PageTopBar
          title={t('navigation.departments')}
          description={t('departments.pageDescription', { threshold: FLOOR })}
        />
        <p role="alert">{t('common.noCompanyAssociated')}</p>
      </div>
    )
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.departments')}
        description={t('departments.pageDescription', { threshold: FLOOR })}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setCreating((open) => !open)
            }}
          >
            {/* The plus belongs to the create affordance, not to the button: this
                one control toggles, and a "+ Cancel" would be nonsense. */}
            {creating ? null : <Plus aria-hidden="true" />}
            {creating ? t('common.cancel') : t('departments.newDepartment')}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('departments.createNewDepartment')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DepartmentForm
              departments={departments}
              submitLabel={t('departments.createDepartment')}
              onSubmit={handleCreate}
            />
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('departments.editDepartment')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DepartmentForm
              // Remounts the controlled inputs when a different row is picked;
              // without it the form keeps the first row's values.
              key={editing.id}
              departments={departments}
              excludeIdFromParentOptions={editing.id}
              parentLocked
              initialValues={{
                name: editing.name,
                description: editing.description ?? '',
                parentDepartmentId: editing.parentDepartmentId ?? '',
                isActive: editing.isActive,
              }}
              submitLabel={t('departments.saveChanges')}
              onSubmit={handleUpdate}
            />
            <div className="mt-panel-gap flex items-center gap-inline">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error ? (
        <NetworkError
          title={t('departments.failedLoadDepartments')}
          description={error}
          onRetry={() => void reload()}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('departments.loadingDepartments')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : departments.length === 0 ? (
            <EmptyState
              title={t('departments.noDepartmentsYet')}
              description={t('departments.addNewDepartmentStructure')}
              // Suppressed while the form is open: it would otherwise sit under a
              // create form as a second button with the same label, which is both
              // noise and ambiguous to a screen reader.
              action={
                creating ? undefined : (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    {t('departments.createDepartment')}
                  </Button>
                )
              }
            />
          ) : (
            <>
              {/* Counts come from the full list, not the filtered one: they
                  describe the company, and a summary that moved as you typed in
                  the search box would be describing the search instead. */}
              {/* `KpiTile`, not `KPIDisplay`. They are not duplicates: `KPIDisplay`
                  is the card grid a page uses when the KPI *is* the content, and
                  this page's content is the table. `KpiTile` is the redesign's flat
                  strip form — a four-across row of readings between the header and
                  the work — which is the role these four numbers actually play here.
                  Every value in it is `font-mono tabular-nums`, the same
                  instrument-face rule the table below follows. */}
              <div className="mb-panel-gap grid grid-cols-2 gap-inline lg:grid-cols-4">
                <KpiTile
                  label={t('departments.kpiTotalDepartments')}
                  value={departments.length}
                  locale={locale}
                  sub={t('departments.kpiTotalSub')}
                />
                <KpiTile
                  label={t('departments.kpiActiveDepartments')}
                  value={activeCount}
                  locale={locale}
                  sub={t('departments.kpiInactiveSub', {
                    count: departments.length - activeCount,
                  })}
                />
                <KpiTile
                  label={t('departments.kpiAssignedEmployees')}
                  value={employeeCount}
                  locale={locale}
                  sub={
                    // The only tile in this band with somewhere else to go: the two
                    // department counts are counting the very list below them, but
                    // the people are on the users page. `companyId` is non-null
                    // here — the whole panel is behind a guard for it.
                    <Link
                      className="text-accent-blue hover:underline"
                      to={`/admin/companies/${companyId}/users`}
                    >
                      {t('dashboard.manageUsers')}
                    </Link>
                  }
                />
                <KpiTile
                  label={t('departments.kpiUnderFloor', { threshold: FLOOR })}
                  value={underFloorCount}
                  // Departments too small to be reported is not good news going up.
                  higherIsBetter={false}
                  locale={locale}
                  sub={t('departments.kpiUnderFloorSub')}
                />
              </div>

              {/* The filter row reads as one instrument panel rather than two
                  loose controls, on the same recessed surface the tiles use. Both
                  controls stay native: `ui/Checkbox` is a Radix button, and the
                  suite reaches this one by its label as a real checkbox. */}
              <div className="mb-panel-gap flex flex-wrap items-end gap-4 rounded-lg border border-line-light bg-surface-icon-box p-3">
                <label className="grid gap-1 text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
                  {t('common.search')}
                  <Input
                    type="search"
                    className="w-64 max-w-full"
                    value={query}
                    placeholder={t('departments.searchDepartments')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label className="flex h-control-md items-center gap-2 text-sm text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(event) => setShowInactive(event.target.checked)}
                  />
                  {t('departments.showInactive')}
                </label>
              </div>

              {visible.length === 0 ? (
                <EmptyState
                  title={t('departments.noDepartmentsFound')}
                  description={t('departments.tryAdjustingFilters')}
                />
              ) : (
                <DepartmentList
                  departments={visible}
                  parentLookup={departments}
                  readings={readings}
                  threshold={FLOOR}
                  onEdit={(department) => {
                    setCreating(false)
                    setEditing(department)
                  }}
                />
              )}
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
