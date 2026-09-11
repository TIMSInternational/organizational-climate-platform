/**
 * The typed models behind the two team dashboards — `/dashboard` for a `leader` (the
 * canvas's LeaderDashboard, 10 Sep) and for a `supervisor` (SupervisorDashboard, drawn as a
 * PROPOSAL while the ruling on that role is pending).
 *
 * Every number either page prints is derived in `compose.ts` from the payloads the old
 * `DepartmentAdminDashboardView` already read — `GET /dashboard/department-admin` — plus
 * the tracking service's own reads and, for the supervisor's tasks, `GET /dashboard/employee`.
 * The one region no endpoint answers for these roles is the organisation's side of the
 * comparison, which comes from `sampleModel.ts` and wears the "Datos de muestra" chip.
 *
 * ## The floor lives here, not in the view
 *
 * A count under the anonymity floor is `null` in these models, never the number: the view
 * cannot print what it was never handed. `DepartmentAdminDashboard.activeSurveys[].responseCount`
 * arrives unfloored (the payload's own docblock), and both artboards hatch it under 5 — so
 * the composer applies the floor once and every reader of the model inherits it. The team's
 * SIZE stays unfloored, as the 27 Aug ruling says: a leader already knows their team.
 *
 * Naming: the human-readable fields are `name`, not `title`/`label`, because the models
 * carry payload content, and `noHardcodedStrings.test.ts` reads a `title:` or `label:`
 * property as copy.
 */

/** One dimension of the team's latest closed reading, beside the organisation's. */
export interface TeamDimension {
  /** The raw category key (`belonging`), locale-independent; the view names it. */
  key: string
  /** The team's pooled mean on 1–5, or `null` when the reading is withheld. */
  team: number | null
  /**
   * The organisation's mean for the same dimension, from `sampleModel.ts` — no endpoint
   * gives it to a leader. `null` when the sample has no value for this key.
   */
  organization: number | null
}

/** The latest closed survey as the team's climate reads it (`DashboardTeamClimate`). */
export interface TeamClosedWave {
  surveyId: string
  /** The survey's own title, resolved for the locale; `null` when it has none. */
  name: string | null
  /** The short code the cycle is discussed in — "Q3" — from `compose.waveCode`. */
  code: string
  /** ISO timestamp the survey closed; `null` when the payload carries none. */
  closedOn: string | null
  /**
   * The team's respondents to that survey, or `null` when the reading is withheld. The
   * server zeroes the count with the reading ("the withheld size must not travel with the
   * withheld reading"), and a 0 printed here would read as "nobody answered".
   */
  respondents: number | null
  /** The team's reading is withheld: under the floor, or absent from the survey. */
  withheld: boolean
  /**
   * The whole SURVEY fell under its own floor: the server then sends no dimension names at
   * all, so there is not even a set of columns to hatch.
   */
  surveyWithheld: boolean
  /** The floor the server applied, sent with the payload rather than assumed to be 5. */
  floor: number
  /** In the order the page draws them: the server's (ordinal by key). */
  dimensions: readonly TeamDimension[]
}

/** A survey open to the team right now (`DashboardDepartmentSurveySummary`). */
export interface TeamOpenSurvey {
  id: string
  name: string | null
  /** "Q4", from the title; the heading names the wave by it. */
  code: string
  /** ISO timestamp the survey stops accepting answers. */
  closesOn: string
  /** Calendar days from the reader's day to the UTC day it closes; `null` when unparseable. */
  daysLeft: number | null
  /**
   * This department's completed responses — `null` under the floor, so no reader of the
   * model can print a sub-floor count (both artboards hatch it: "menos de 5 respuestas").
   */
  responses: number | null
}

/** A tracking plan as a card line on either page. */
export interface TeamPlan {
  id: string
  code: string
  /** `descripcionQue` — what will be done. */
  que: string
  /** The raw `estadoSemaforo`; `SemaforoChip` knows how to draw it. */
  estado: string
  /** Whole points, 0–100 (`semaforo.toPercent`). */
  percent: number
  /** `DateOnly` the plan was created. */
  createdOn: string
  /** `DateOnly` of the compromiso. */
  dueOn: string
  /** Days from the reader's day to the compromiso; negative once it has gone by. */
  daysToDue: number
  /** An avance is on record (`tracking/next/derive.hasRecordedProgress`). */
  hasProgress: boolean
  /** The day of the latest avance, when one is on record. */
  lastProgressOn: string | null
  cumplido: boolean
  /** Open with the compromiso gone by. */
  overdue: boolean
  /** The plan's node — what `viewerCapabilities.canRecordProgress` judges against. */
  nodoExternalId: string
  /** The node's name when it is the reader's own department; `null` otherwise. */
  nodoName: string | null
  /** The responsable as far as this reader can name them: only themselves, with no directory. */
  responsable: { name: string | null; isViewer: boolean }
}

/**
 * Where the leader's plan card reads from.
 *
 * - `tracking` — the leader's own nodo board (`GET /api/tablero-seguimiento`): the plans
 *   the team is executing, each one a page this reader may open (`PlanAccessHandler`: a
 *   leader on their own nodo).
 * - `counts` — no tracking service in this deployment, or no nodo to read: the department
 *   payload's own action-plan COUNTS, with no row to open (`/action-plans` is admin-only,
 *   `ActionPlanEndpoints.CanAccessCompany`).
 * - `failed` — the tracking read failed; the card says so rather than showing an empty board.
 * - `loading` — the board is still being read; the rest of the page does not wait for it.
 */
export type LeaderPlans =
  | { source: 'tracking'; plans: readonly TeamPlan[]; open: number; overdue: number }
  | { source: 'counts'; open: number; overdue: number }
  | { source: 'failed'; error: string | null }
  | { source: 'loading' }

export interface LeaderDashboardModel {
  /** ISO timestamp the model was composed at; day counts are measured against it. */
  asOf: string
  departmentId: string
  departmentName: string
  /** Headcount, unfloored — the 27 Aug ruling: the leader already knows their team. */
  memberCount: number
  activeMemberCount: number
  /** `null` when the company has never closed a survey. */
  closedWave: TeamClosedWave | null
  /** Soonest close first — a page of them (`SurveyRowLimit` on the server). */
  openSurveys: readonly TeamOpenSurvey[]
  /** The true number of open surveys, which the listed page may fall short of. */
  openSurveyCount: number
  /** The floor every count on the page is held to (`compose.countFloor`). */
  floor: number
  /** The organisation's respondents to the same survey, from the sample. */
  organizationRespondents: number | null
  /** True while the organisation's side is the sample — which, today, is always. */
  organizationIsSample: boolean
  plans: LeaderPlans
  /** A tracking service is configured for this deployment. */
  trackingOn: boolean
  /** The climate target on the 1–5 scale — `CLIMATE_TARGET`, the canvas's "meta 3,7". */
  target: number
}

/** One line of "Tus tareas". */
export type SupervisorTask =
  /** A survey the supervisor still owes an answer to (`GET /dashboard/employee`). */
  | { kind: 'answer-survey'; id: string; name: string | null; dueOn: string }
  /** A plan she executes and may record progress on (`canRecordProgress`). */
  | { kind: 'record-progress'; id: string; code: string; firstAvance: boolean; dueOn: string }
  /**
   * A plan she executes but may NOT record progress on — every supervisor today:
   * `PlanAccessHandler` gives the responsable and the involucrados read only.
   */
  | { kind: 'follow-plan'; id: string; code: string; dueOn: string }

/**
 * Where the supervisor's plans come from: `GET /api/mis-tareas` — the plans she is the
 * responsable of or involved in, exactly "los planes que ejecutas".
 */
export type SupervisorPlans =
  | { source: 'tracking'; plans: readonly TeamPlan[] }
  | { source: 'off' }
  | { source: 'failed'; error: string | null }

export interface SupervisorDashboardModel {
  asOf: string
  departmentId: string
  departmentName: string
  activeMemberCount: number
  /** The open survey the coverage card is about: the soonest to close. */
  openSurvey: TeamOpenSurvey | null
  /** How many other surveys are open beside it. */
  otherOpenCount: number
  /** Who answered, `null` under the floor. The same number as `openSurvey.responses`. */
  responded: number | null
  /**
   * Who has not, `null` for as long as `responded` is: printed next to the team's size, it
   * would give the hidden count back by subtraction.
   */
  remaining: number | null
  floor: number
  plans: SupervisorPlans
  /** Soonest first. */
  tasks: readonly SupervisorTask[]
  /** `GET /dashboard/employee` failed, so the surveys she owes are not in the list. */
  surveysUnread: boolean
  trackingOn: boolean
}
