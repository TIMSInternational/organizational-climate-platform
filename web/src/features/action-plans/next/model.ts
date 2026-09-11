/**
 * The typed model behind the redesigned Planes de Acción — `/action-plans`, the
 * ActionPlansList artboard of 10 Sep.
 *
 * Every number the page prints is derived from this shape in `derive.ts` — the
 * groups, the counts in the tiles, the days to each due date, the timeline — never
 * typed. The page reads it through `useActionPlansListModel()`, the ONE place that
 * talks to the API; the components below it never fetch.
 *
 * Naming: the human-readable fields are `name`, not `title`/`label`, because they
 * carry payload content (a plan's own title, a tenant's department name) rather than
 * UI copy, and `noHardcodedStrings.test.ts` reads a `title:` or `label:` property as
 * copy. Every string the UI itself says goes through `t()`.
 */

/**
 * The state group a plan is listed under, in the order the page draws them.
 *
 * `overdue` is a reading, not only a status: an open plan whose date has gone by
 * (`actionPlanRollup.isPastDue`) or one marked `overdue` on the wire.
 */
export type PlanGroup = 'overdue' | 'inProgress' | 'notStarted' | 'completed' | 'cancelled'

/** The map cell a plan answers: the dimension, beside the department the plan names. */
export interface PlanFinding {
  /** A dimension key of `surveyRespond.dimensions` — `recognition`, `workload`, … */
  dimensionKey: string
}

export interface PlanRow {
  id: string
  /** The plan's own title, resolved by the server for the reader's language. */
  name: string
  departmentId: string | null
  /**
   * The department's name when `GET /admin/departments` answered and lists it;
   * `null` for a company-wide plan, and for one whose department the lookup did not name.
   */
  departmentName: string | null
  /** One of `ActionPlanValidation.ValidStatuses`, as the wire carries it. */
  status: string
  /** One of `ActionPlanValidation.ValidPriorities`, as the wire carries it. */
  priority: string
  /** ISO instant at UTC midnight of the calendar day the plan is due (`normalizeDueDate`). */
  dueDate: string
  /** ISO instant. */
  createdAt: string
  /** SAMPLE — see `sampleModel.ts`. `null` means the sample names no finding for the plan. */
  finding: PlanFinding | null
  /**
   * Always `null` today, and that is the reading, not a gap: the action-plan entity has no
   * owner (`ActionPlan.cs`), so no plan has one and every row reads "Sin asignar" — the
   * artboard's reading on all four. Phase 2 adds the field; this is where it lands.
   */
  ownerName: string | null
}

/**
 * The fourth tile: how many plans are behind, and the first of them.
 *
 * `source` says which model answered. Where a tracking service is configured its
 * semáforo is the seguimiento — `Rojo` plans from `GET /api/planes-accion`; elsewhere
 * the generic plans past their date answer the same question.
 */
export interface OverdueReading {
  source: 'tracking' | 'plans'
  count: number
  /** The first plan behind: where it sits (nodo or department) and what it is. */
  first: { placeName: string | null; name: string } | null
}

export interface ActionPlansListModel {
  companyName: string | null
  /** Today, `YYYY-MM-DD` in the reader's own calendar. Every "in N days" is counted from it. */
  asOf: string
  rows: readonly PlanRow[]
  /** The findings column and its tile are sample-fed: no endpoint carries a plan's finding. */
  findingsAreSample: boolean
  overdue: OverdueReading
}
