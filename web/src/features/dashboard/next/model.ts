/**
 * The typed model behind the redesigned Panel de Control — the company administrator's
 * `/dashboard`.
 *
 * Every number the page prints is derived from this shape in `derive.ts` — the
 * average, the deltas, the percentages, "below target" — never typed as a string.
 * The page reads the model through `useAdminDashboardModel()`, which is the ONE
 * place wiring to the API will happen; the components below it never fetch.
 *
 * Naming: the human-readable fields are `name`, not `title`/`label`, because the
 * model carries payload content (a tenant's department names, a survey's own
 * name) rather than UI copy, and `noHardcodedStrings.test.ts` reads a `title:`
 * or `label:` property as copy. Every string the UI itself says goes through
 * `t()`.
 */

export type WaveStatus = 'closed' | 'open' | 'planned'

/** One survey wave of the climate cycle. */
export interface Wave {
  id: string
  /** The short code the cycle is discussed in: "Q1", "Q4". */
  code: string
  name: string
  status: WaveStatus
  /** ISO date; present when `status === 'closed'`. */
  closedAt?: string
  /** ISO date; present when `status === 'open'`. */
  closesAt?: string
}

/** One dimension's mean, per closed wave, oldest first. */
export interface DimensionSeries {
  key: string
  name: string
  values: readonly number[]
}

/** One group's row on the climate map of the latest closed wave. */
export interface MapRow {
  departmentId: string
  name: string
  /** Respondents in the group. Under the floor the row must render protected. */
  responses: number
  /** One score per `map.dimensionKeys` entry, in that order. */
  scores: readonly number[]
}

export interface PlanRef {
  id: string
  name: string
  /** 0–100. */
  progress: number
  owner?: string
  /** ISO date. */
  dueAt?: string
}

export interface OpenSurvey {
  id: string
  code: string
  name: string
  responses: number
  audience: number
  /** ISO date. */
  closesAt: string
}

export type AttentionItem =
  /** The lowest disclosed cell of the map; the cell itself is derived from `map`. */
  | { kind: 'lowest-cell'; plan: PlanRef }
  /** A tracking plan past its due date, in a nodo. */
  | { kind: 'overdue-plan'; nodo: string; plan: PlanRef }
  /** The open survey with few responses in; `surveyId` names `openSurvey`. */
  | { kind: 'low-participation'; surveyId: string; remindersSent: number }

export interface AdminDashboardModel {
  /** True while the model is the sample; the page shows a chip saying so. */
  isSample: boolean
  /** ISO date the model was read at; day counts are computed against it. */
  asOf: string
  companyName: string
  /** The climate target on the 1–5 scale. */
  target: number
  latestClosedWave: Wave
  previousWave: Wave | null
  openSurvey: OpenSurvey | null
  /** Participation of the latest closed wave. */
  participation: { responses: number; completed: number }
  dimensions: readonly DimensionSeries[]
  waves: readonly Wave[]
  map: { dimensionKeys: readonly string[]; rows: readonly MapRow[] }
  plans: { open: number; overdue: number; overdueNodo: string | null }
  attention: readonly AttentionItem[]
  liveMicroclimate: { id: string; name: string; responses: number; closesAt: string } | null
}
