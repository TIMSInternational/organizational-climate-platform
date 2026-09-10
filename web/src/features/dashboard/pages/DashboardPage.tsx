import DepartmentAdminDashboardView from '../components/DepartmentAdminDashboardView'
import EmployeeDashboardView from '../components/EmployeeDashboardView'
import SuperAdminDashboardView from '../components/SuperAdminDashboardView'
import AdminDashboardNextView from '../next/AdminDashboardNextView'
import { useAdminDashboardModel } from '../next/useAdminDashboardModel'
import { useCompanyScope } from '../../../company-context'

/**
 * `/dashboard` — the landing page for every user (#132), dispatching by role.
 *
 * ## Why four components rather than one page with four sections
 *
 * The server exposes one endpoint per role and refuses the rest, so each of these views can
 * only ever be handed its own role's payload. Rendering "the dashboard" and hiding the
 * parts a viewer may not see would require a single endpoint returning the union, which
 * publishes every tenant's figures to anyone who opens the network tab — the failure the
 * issue names outright. Dispatch is therefore *which request to make*, not *which parts to
 * draw*.
 *
 * Nothing here is a permission check. The role below chooses a destination; the server
 * decides what that destination may contain, and would refuse a mismatched call regardless
 * of what this function returns.
 *
 * ## The role map
 *
 * `Roles` in the API is `super_admin | company_admin | leader | supervisor | employee` —
 * there is no `department_admin`. The legacy app's four dashboards map onto it as:
 *
 * | Legacy dashboard  | Role here                |
 * |-------------------|--------------------------|
 * | SuperAdmin        | `super_admin`            |
 * | CompanyAdmin      | `company_admin`          |
 * | DepartmentAdmin   | `leader`, `supervisor`   |
 * | Evaluated user    | `employee`, and anything unrecognised |
 *
 * The **default is the employee view, deliberately**, and it is the one default that is
 * safe: `/dashboard/employee` is scoped to the caller's own user row and reads no role
 * claim at all, so an unknown or absent role gets a page about themselves rather than a
 * 403 or a blank screen. Defaulting the other way — to an admin view — would be a page
 * that 403s, which is precisely what `resolveInitialRoute` was changed to stop doing.
 *
 * ## The company view is the redesign
 *
 * A CompanyAdmin — and a SuperAdmin with a tenant selected — gets the redesigned Panel
 * de Control from `../next`, which replaced `CompanyAdminDashboardView` on this route.
 * Until `useAdminDashboardModel` is wired it draws the sample in `sampleModel.ts` and
 * says so with a chip; the old view stays in the tree, unrouted, as the reference for
 * that wiring (its module comment says what to copy from it and when to delete it).
 *
 * ## The SuperAdmin's two dashboards
 *
 * A SuperAdmin with no company selected gets the platform overview: their subject really is
 * "all tenants", and `useCompanyScope` reports `needs-selection` rather than guessing one
 * (#124). Once they pick a tenant in the header switcher, the company dashboard for *that*
 * tenant is the more useful answer, and the selection is handed to `useAdminDashboardModel`
 * for exactly that — `GET /dashboard/company-admin`, which it will read, accepts an
 * explicit `companyId` from this role. A CompanyAdmin's selection is ignored by
 * `useCompanyScope` and their claim is used instead, so this branch cannot be used to widen
 * anything.
 */
export default function DashboardPage() {
  const scope = useCompanyScope()

  if (scope.isSuperAdmin) {
    return scope.status === 'ready' && scope.companyId ? (
      <CompanyDashboard companyId={scope.companyId} />
    ) : (
      <SuperAdminDashboardView />
    )
  }

  if (scope.role === 'company_admin') {
    // No `companyId`: the server takes it from the claim. See the hook's parameter doc.
    return <CompanyDashboard />
  }

  if (scope.role === 'leader' || scope.role === 'supervisor') {
    return <DepartmentAdminDashboardView />
  }

  return <EmployeeDashboardView />
}

/**
 * The company administrator's view: the redesigned Panel de Control, fed by the model
 * hook. A component of its own rather than a hook call in `DashboardPage`, so that
 * `useAdminDashboardModel` runs only on the two branches that draw it — once it fetches,
 * an employee's landing page must not be asking for a tenant's figures.
 */
function CompanyDashboard({ companyId }: { companyId?: string }) {
  const model = useAdminDashboardModel(companyId)
  return <AdminDashboardNextView model={model} />
}
