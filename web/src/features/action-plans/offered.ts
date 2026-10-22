import { isTrackingEnabled } from '../tracking/api/config'

/**
 * Whether this deployment offers `/action-plans` at all.
 *
 * The sidebar's rule, and the only one: `navSections.workspacePlanItems` drops the generic
 * Planes de Acción row wherever a tracking service is configured and offers the tracking
 * module in its place (Federico's decision of 2026-08-21 — one place to manage plans, not two
 * that disagree). Hiding the row while a dashboard button, a results panel, the search palette
 * and the notification inbox still led to `/action-plans` was the nav saying one thing and the
 * screens another (G24). Every entry point outside the nav asks this instead of deciding again.
 */
export function actionPlansOffered(): boolean {
  return !isTrackingEnabled()
}

/** A plan's page, or `null` where this deployment does not offer `/action-plans`. */
export function actionPlanHref(id: string): string | null {
  return actionPlansOffered() ? `/action-plans/${id}` : null
}
