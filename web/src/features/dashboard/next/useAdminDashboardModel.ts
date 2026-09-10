import type { AdminDashboardModel } from './model'
import { sampleModel } from './sampleModel'

/**
 * The model behind `/dashboard/next`.
 *
 * TODAY this returns the sample in `sampleModel.ts`, unconditionally, and the
 * page shows a "sample data" chip because of it. This hook is where the wiring
 * will happen — the endpoints are listed in the sample's header — so that the
 * components below it never learn where their numbers come from. When it fetches,
 * `isSample` becomes `false` and the chip disappears on its own.
 */
export function useAdminDashboardModel(): AdminDashboardModel {
  return sampleModel
}
