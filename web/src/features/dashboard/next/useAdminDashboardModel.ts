import type { AdminDashboardModel } from './model'
import { sampleModel } from './sampleModel'

/**
 * The model behind the company administrator's `/dashboard`.
 *
 * TODAY this returns the sample in `sampleModel.ts`, unconditionally, and the
 * page shows a "sample data" chip because of it. This hook is where the wiring
 * will happen — the endpoints are listed in the sample's header — so that the
 * components below it never learn where their numbers come from. When it fetches,
 * `isSample` becomes `false` and the chip disappears on its own.
 *
 * `companyId` is the scope `DashboardPage` resolved: set only for a SuperAdmin, who
 * has no tenant of their own and must name one, and `undefined` for a CompanyAdmin,
 * whose scope the server takes from the claim — a client that sent its own idea of
 * the tenant would be choosing a scope, which `GET /dashboard/company-admin` refuses
 * (see `CompanyAdminDashboardView`'s prop of the same name, the wiring reference).
 * The sample ignores it; the wiring will pass it on exactly as `getCompanyAdminDashboard`
 * does today.
 */
export function useAdminDashboardModel(companyId?: string): AdminDashboardModel {
  void companyId
  return sampleModel
}
