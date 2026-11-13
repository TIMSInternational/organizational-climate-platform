import type { ActionPlanDetail, ProgressUpdateDetail } from '../api/actionPlans'
import type { PlanFinding, PlanMove } from './planDetailDerive'

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
 * | finding         | `GET /surveys` + `GET /surveys/climate-trends` (`planFinding`, `planMove`) |
 * | history         | `GET /action-plans/{id}/progress` (`listProgress`)                    |
 *
 * The history was the one part no endpoint returned until G24: `POST .../progress` wrote the
 * rows and nothing read them back, so the Bitácora listed only what was recorded during the
 * visit and forgot it on reload.
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
  /** Whether a wave that closed after the plan's own moved its cell (`planMove`). */
  move: Settled<PlanMove>
  /** Who the plan can be handed to: every user of its company (`GET /admin/users`). */
  owners: Settled<readonly { id: string; name: string }[]>
  /** Every progress note recorded on the plan, oldest first (`GET /action-plans/{id}/progress`). */
  history: Settled<readonly ProgressUpdateDetail[]>
}
