import CompanyAdminDashboardView from '../components/CompanyAdminDashboardView'
import DepartmentAdminDashboardView from '../components/DepartmentAdminDashboardView'
import EmployeeDashboardView from '../components/EmployeeDashboardView'
import SuperAdminDashboardView from '../components/SuperAdminDashboardView'
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
 * ## The SuperAdmin's two dashboards
 *
 * A SuperAdmin with no company selected gets the platform overview: their subject really is
 * "all tenants", and `useCompanyScope` reports `needs-selection` rather than guessing one
 * (#124). Once they pick a tenant in the header switcher, the company dashboard for *that*
 * tenant is the more useful answer, and `GET /dashboard/company-admin` accepts an explicit
 * `companyId` from this role for exactly that. A CompanyAdmin's selection is ignored by
 * `useCompanyScope` and their claim is used instead, so this branch cannot be used to widen
 * anything.
 */
export default function DashboardPage() {
  const scope = useCompanyScope()

  if (scope.isSuperAdmin) {
    return scope.status === 'ready' && scope.companyId ? (
      <CompanyAdminDashboardView companyId={scope.companyId} />
    ) : (
      <SuperAdminDashboardView />
    )
  }

  if (scope.role === 'company_admin') {
    // No `companyId` prop: the server takes it from the claim. See the prop's doc comment.
    return <CompanyAdminDashboardView />
  }

  if (scope.role === 'leader' || scope.role === 'supervisor') {
    return <DepartmentAdminDashboardView />
  }

  return <EmployeeDashboardView />
}
