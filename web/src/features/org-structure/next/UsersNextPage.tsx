import { readViewerClaims } from '../../../auth/viewerCapabilities'
import AdminUsersView from './admin/AdminUsersView'
import SuperUsersView from './super/SuperUsersView'

/**
 * `/admin/companies/:companyId/users` — the per-role canvas's *Usuarios* (10 Sep), which
 * replaced `UsersListPage` at this route. The super administrator's roster of a tenant is
 * `SuperUsersView` (`SuperUsersList` artboard); every other role gets the company
 * administrator's `AdminUsersView` (`UsersList` artboard), which itself says so to a role
 * that manages no people rather than asking the server for a list it would refuse.
 *
 * The role is read off the claim, so the page still renders outside
 * `CompanyContextProvider`, as `UsersListPage` did.
 */
export default function UsersNextPage() {
  return readViewerClaims().role === 'super_admin' ? <SuperUsersView /> : <AdminUsersView />
}
