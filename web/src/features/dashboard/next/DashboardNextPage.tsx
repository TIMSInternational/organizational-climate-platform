import { Navigate } from 'react-router'
import { useCompanyScope } from '../../../company-context'
import AdminDashboardNextView from './AdminDashboardNextView'
import { useAdminDashboardModel } from './useAdminDashboardModel'

/**
 * `/dashboard/next` — the redesigned Panel de Control, for the company administrator.
 *
 * Same gate as `DashboardPage` draws for the company view: a `company_admin` sees
 * it for their own tenant, a `super_admin` sees it once a company is selected in the
 * header switcher, and every other role — or a SuperAdmin with no tenant chosen —
 * goes to `/dashboard`, which dispatches them to the view their role actually has.
 *
 * Nothing here is a permission check (see `DashboardPage`): today the model is a
 * sample, and once it is wired the server refuses a mismatched caller regardless.
 */
export default function DashboardNextPage() {
  const scope = useCompanyScope()
  const model = useAdminDashboardModel()

  const allowed =
    scope.role === 'company_admin' ||
    (scope.isSuperAdmin && scope.status === 'ready' && Boolean(scope.companyId))

  if (!allowed) return <Navigate to="/dashboard" replace />

  return <AdminDashboardNextView model={model} />
}
