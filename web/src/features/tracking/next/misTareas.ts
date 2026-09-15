import type { PlanAccion, SemaforoCounts } from '../api/trackingApi'
import { tallySemaforo, toPercent } from '../semaforo'
import { byCompromiso, dayDiff, hasRecordedProgress, isOverdue } from './derive'

/**
 * *Mis tareas* (`/tracking/mis-tareas`) as arithmetic over the one read the page makes —
 * `GET /api/mis-tareas` — as the MisTareas and MisTareasAsignadas artboards (10 Sep) count it.
 *
 * ## Why this is not a filter on the plans listing
 *
 * `DashboardEndpoints.MisTareasAsync` reads **no role claim at all**. It matches the caller's
 * own `PersonaExternalId` against `ResponsableEjecucionExternalId` or `_involucradosExternalIds`
 * — a statement about the person, not about their rank — so every role gets the same screen
 * and gets only their own rows. Nothing here decides what the reader may see; it only counts
 * what came back.
 *
 * ## Read-only by construction
 *
 * `PlanAccessHandler` gives a responsable or an involucrado `AccessLevel.Read` and nothing
 * more, so nothing in this module produces a write affordance, a percentage to submit or a
 * target to post to. `porcentajeAvance` is a 0–1 FRACTION on the wire and crosses
 * `semaforo.toPercent` exactly once, here, in {@link toTareas} — `semaforoTable.test.ts` fails
 * the build if a second conversion appears anywhere in the feature.
 */

export interface TareaRow {
  id: string
  code: string
  /** The plan's `descripcionQue` — the board's "Qué te toca" column. */
  que: string
  /** The plan's `metodologiaComo`, under it. */
  como: string
  /** `responsable` when the caller answers for the plan, `involucrado` when they take part. */
  papel: 'responsable' | 'involucrado'
  nodoExternalId: string
  /** The nodo's name when the reader can resolve it — their own — else `null`. */
  nodoName: string | null
  /** The wire state (`estadoSemaforo`), drawn only through `SemaforoChip`. */
  estado: string
  /** Whole percentage points, through `semaforo.toPercent`. */
  percent: number
  fechaCompromiso: string
  /** Days from `asOf` to the compromiso; negative once it has gone by. */
  daysToCompromiso: number
  overdue: boolean
  cumplido: boolean
  hasProgress: boolean
  fechaUltimaActualizacion: string
  /**
   * The reader may record the avance on this plan themselves — `canManagePlan`, which is
   * true for a node leader listed here on a plan of their OWN jefatura.
   *
   * The page shows no write control either way; this only decides which of two true
   * sentences the banner carries. Telling a leader "el avance lo registra la jefatura del
   * nodo" names them, one click before the detail page hands them the form — measured, and
   * the reason the old `pages/MisTareasPage` grew the same predicate.
   */
  managedByReader: boolean
}

/** The tally beside the board's "Lo próximo" card: the three states, and how many were read. */
export interface TareasTally {
  counts: SemaforoCounts
  total: number
}

export function toTareas(
  plans: readonly PlanAccion[],
  asOf: string,
  viewerPersonaId: string,
  nodoNames: ReadonlyMap<string, string>,
  managed: (plan: PlanAccion) => boolean,
): TareaRow[] {
  return plans
    .map((plan) => ({
      id: plan.id,
      code: plan.planCode,
      que: plan.descripcionQue,
      como: plan.metodologiaComo,
      // The responsable is also an involucrado on every plan the API creates
      // (`PlanesAccionEndpoints.CreateAsync` adds them), so "responsable" is asked first:
      // it is the stronger of the two statements and the one the board prints.
      papel: (plan.responsableEjecucionExternalId !== '' && plan.responsableEjecucionExternalId === viewerPersonaId
        ? 'responsable'
        : 'involucrado') as TareaRow['papel'],
      nodoExternalId: plan.nodoExternalId,
      nodoName: nodoNames.get(plan.nodoExternalId) ?? null,
      estado: plan.estadoSemaforo,
      percent: toPercent(plan.porcentajeAvance),
      fechaCompromiso: plan.fechaCompromiso,
      daysToCompromiso: dayDiff(asOf, plan.fechaCompromiso),
      overdue: isOverdue(plan, asOf),
      cumplido: plan.cumplido,
      hasProgress: hasRecordedProgress(plan),
      fechaUltimaActualizacion: plan.fechaUltimaActualizacion,
      managedByReader: managed(plan),
    }))
    .sort(byCompromiso)
}

/**
 * The three states counted — through `semaforo.tallySemaforo`, the module that owns the wire
 * values — plus the total.
 *
 * `total` is carried rather than inferred from the three: a state this version does not
 * recognise is counted in none of them, and three numbers that silently fail to add up are
 * how a screen comes to assert a reading nobody took (`SemaforoSummary`, same reasoning).
 */
export function tallyTareas(rows: readonly TareaRow[]): TareasTally {
  return { counts: tallySemaforo(rows.map((row) => ({ estadoSemaforo: row.estado }))), total: rows.length }
}

/*
 * The board's "Lo próximo" card leads with `derive.nextCompromiso(rows)` — the nearest
 * compromiso still ahead, or, when every open task is past, the one that went by first.
 * `TareaRow` carries the four fields it reads, so the rule is not written twice: the tablero
 * and this board must not be able to disagree about which task is next.
 */
