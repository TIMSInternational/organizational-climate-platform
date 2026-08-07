import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDepartment,
  listDepartments,
  updateDepartment,
  type Department,
} from '../api/departments'
import DepartmentList from '../components/DepartmentList'
import DepartmentForm, { type DepartmentFormValues } from '../components/DepartmentForm'
import { Network, CircleCheck, Users } from 'lucide-react'
import { KPIDisplay } from '../../../components/charts'
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
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

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
 * It returns one company's full, flat list ordered by name. Filtering that array
 * in the browser is therefore not a second implementation of a server rule — the
 * server has no such rule — and the parent-name column needs the whole array in
 * memory regardless.
 */
export default function DepartmentsPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const [departments, setDepartments] = useState<Department[]>([])
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
    try {
      setDepartments(await listDepartments(baseUrl, companyId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, t])

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
        <PageTopBar title={t('navigation.departments')} description={t('navigation.departmentsDesc')} />
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
        <PageTopBar title={t('navigation.departments')} description={t('navigation.departmentsDesc')} />
        <p role="alert">{t('common.noCompanyAssociated')}</p>
      </div>
    )
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.departments')}
        description={t('navigation.departmentsDesc')}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setCreating((open) => !open)
            }}
          >
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
              {/* The ForMaps admin shell leads a data view with a KPI band rather
                  than a sentence, so the three numbers that describe the company are
                  the first thing read. `summaryLine` is kept in the catalogue and
                  used as the band's accessible summary — the figures are unchanged,
                  only their presentation. */}
              <div className="mb-panel-gap">
                <KPIDisplay
                  columns={3}
                  locale={locale}
                  kpis={[
                    {
                      id: 'total',
                      label: t('departments.kpiTotalDepartments'),
                      value: departments.length,
                      icon: Network,
                    },
                    {
                      id: 'active',
                      label: t('departments.kpiActiveDepartments'),
                      value: activeCount,
                      icon: CircleCheck,
                    },
                    {
                      id: 'employees',
                      label: t('departments.kpiAssignedEmployees'),
                      value: employeeCount,
                      icon: Users,
                    },
                  ]}
                />
              </div>

              <div className="mb-panel-gap flex flex-wrap items-end gap-inline">
                <label className="grid gap-1">
                  {t('common.search')}
                  <input
                    type="search"
                    value={query}
                    placeholder={t('departments.searchDepartments')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label className="flex items-center gap-inline">
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
