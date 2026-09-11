import type { PlanAccion, SemaforoCounts } from '../api/trackingApi'

/**
 * The typed models behind the three redesigned tracking screens — the Vista
 * Consolidada (`/tracking`), the Tablero de Seguimiento (`/tracking/tablero`) and the
 * plan detail (`/tracking/planes/:id`) — the TrackingConsolidado, TrackingTablero and
 * Main artboards of 10 Sep.
 *
 * Each screen reads its model through one hook (`useConsolidadoModel`,
 * `useTableroModel`, `usePlanDetailModel`), the only places that call the tracking
 * client; every figure is derived in `derive.ts`. The payload's percentages are 0–1
 * FRACTIONS and cross `semaforo.toPercent` exactly once, on the way into these models.
 *
 * Naming: `name` rather than `title`/`label` for payload content — see
 * `features/dashboard/next/model.ts`.
 */

/**
 * A person the plan names, as far as THIS viewer can resolve them.
 *
 * `name` is `null` when the directory did not name them: the personas picker
 * (`/tracking/picker/personas`) is admin-only (`TrackingPickerEndpoints.cs:19-21`), so a
 * leader resolves nobody but themselves (their own `sub` and `name` claims). A screen
 * says so in words; it never prints the external id where a name belongs.
 */
export interface PersonaRef {
  id: string
  name: string | null
  email: string | null
}

/** One plan as a row of the consolidado and a card of the tablero. */
export interface PlanLine {
  id: string
  code: string
  que: string
  /** The wire state (`estadoSemaforo`), drawn only through `SemaforoChip`. */
  estado: string
  /** Whole percentage points, through `semaforo.toPercent`. */
  percent: number
  /** `DateOnly`, `YYYY-MM-DD`. */
  fechaCompromiso: string
  /** Days from `asOf` to the compromiso; negative once it has gone by. */
  daysToCompromiso: number
  cumplido: boolean
  responsable: PersonaRef
}

export interface NodoBlock {
  nodoExternalId: string
  /** The directory's name for the nodo, or `null` when it did not answer or name it. */
  name: string | null
  conteos: SemaforoCounts
  totalPlanes: number
  /**
   * The nodo's plans from `GET /api/planes-accion`, or `null` when that listing did not
   * answer — the counts still print, and the table says the plans could not be read.
   */
  plans: PlanLine[] | null
  /** Absent today: `NodoConsolidado` carries no prior-year figure (see `ConsolidadoPage`). */
  resultadoAnioAnteriorPct?: number | null
}

export interface ConsolidadoModel {
  /** Today, `YYYY-MM-DD` in the reader's calendar. */
  asOf: string
  /** When the consolidado answered, epoch ms — "consultado el … a las …". */
  consultedAt: number
  /** Company-wide counts, straight from `GET /api/consolidado`. */
  conteos: SemaforoCounts
  nodos: NodoBlock[]
  /** How many nodos the directory lists, or `null` when it did not answer. */
  directoryNodoCount: number | null
}

export interface TableroPlanCard extends PlanLine {
  /** `DateOnly`s off the payload. */
  fechaCreacion: string
  fechaUltimaActualizacion: string
  /** A progress update is on record — `derive.hasRecordedProgress`. */
  hasProgress: boolean
  /** The payload row, for `canRecordProgress(plan)` and the write calls. */
  plan: PlanAccion
}

export interface TableroModel {
  asOf: string
  nodoExternalId: string
  nodoName: string | null
  conteos: SemaforoCounts
  /** Ordered by compromiso, nearest first — "ordenados por compromiso". */
  plans: TableroPlanCard[]
  /** SAMPLE — the bitácora is not on `PlanResponse`; see `sampleModel.ts`. */
  avancesRegistrados: number
  avancesAreSample: boolean
}

/** One avance in a plan's bitácora. SAMPLE until the API exposes `_bitacora`. */
export interface BitacoraAvance {
  /** `DateOnly`. */
  fecha: string
  autorName: string
  /** Whole percentage points. */
  percent: number
  comentario: string | null
}

export interface PlanDetailModel {
  asOf: string
  plan: PlanAccion
  nodoName: string | null
  responsable: PersonaRef
  /** `null` when `liderExternalId` is blank — "Sin asignar". */
  lider: PersonaRef | null
  involucrados: PersonaRef[]
  /** SAMPLE — see `sampleModel.ts`. */
  bitacora: { creatorName: string | null; avances: BitacoraAvance[] }
  bitacoraIsSample: boolean
}
