import type { ActionPlanDetail, ProgressUpdateDetail } from '../api/actionPlans'
import type { PlanFinding } from './planDetailDerive'

/**
 * A region read beside the plan, settled on its own: one failed enrichment costs one line
 * of the screen, never the plan.
 */
export type Settled<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' }

/**
 * Everything the redesigned action plan (`/action-plans/:id`) prints, and where each part
 * comes from. Every source is an existing client; no sample data feeds this screen.
 *
 * | Part            | Read                                                                  |
 * |-----------------|-----------------------------------------------------------------------|
 * | the plan        | `GET /action-plans/{id}` (`getActionPlan`)                            |
 * | department name | `GET /admin/departments` (`listDepartments`)                          |
 * | author name     | `GET /admin/users/{createdBy}` (`getUser`)                            |
 * | created day     | `GET /action-plans` (`listActionPlans`) — the detail carries no date |
 * | template name   | `GET /action-plan-templates` (`listActionPlanTemplates`)              |
 * | finding         | `GET /surveys` + `GET /surveys/climate-trends` (`planFinding`)         |
 *
 * ## What no endpoint returns, and the screen therefore does not claim
 *
 * The plan's progress history. `POST /action-plans/{id}/progress` writes an
 * `ActionPlanProgressUpdate` row and nothing reads one back — `ActionPlanEndpoints.cs:412`
 * is the only reference to `ActionPlanProgressUpdates` in the API. So the Bitácora lists the
 * plan's creation and the progress recorded during this visit (`recorded`, from each POST's
 * response), and says so; it never prints the board's "Sin avances registrados", which the
 * server cannot confirm.
 */
export interface ActionPlanDetailModel {
  plan: ActionPlanDetail
  /** Today as an ISO calendar day — what "en 35 días" counts from. */
  asOf: string
  /** `null` for a plan with no department: the whole company. */
  departmentName: Settled<string | null>
  /** `null` when the author is not a user this viewer can read. */
  authorName: Settled<string | null>
  createdAt: Settled<string | null>
  /** `null` when the plan has no template. */
  templateName: Settled<string | null>
  finding: Settled<PlanFinding>
  /** Progress recorded during this visit, oldest first. */
  recorded: readonly ProgressUpdateDetail[]
}
