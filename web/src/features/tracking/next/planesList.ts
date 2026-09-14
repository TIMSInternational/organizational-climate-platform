import type { PlanAccion } from '../api/trackingApi'
import type { PersonaPickerItem } from '../api/trackingPickers'
import { canManagePlan, type TrackingClaims } from '../trackingAccess'
import { toSemaforoEstado, type SemaforoEstado } from '../semaforo'
import { byCompromiso, hasRecordedProgress, isOverdue, planLine, type Viewer } from './derive'
import type { PlanLine } from './model'

/**
 * The *Planes de acción* list (TrackingPlanesList artboard, 10 Sep) as arithmetic over the
 * one read the page makes — `GET /api/planes-accion`, already scoped by the service to what
 * this caller may see — and the directory an administrator's pickers answer. Nothing here
 * decides who sees what; it only groups and counts what came back.
 */
export interface ListRow extends PlanLine {
  nodoExternalId: string
  /** `null` when the directory could not name the nodo (it is admin-only). */
  nodoName: string | null
  como: string
  overdue: boolean
  hasProgress: boolean
  responsableIsViewer: boolean
  /** The service lets this viewer record progress on it (`canManagePlan`). */
  canManage: boolean
}

export interface GroupedRows {
  /** Open plans, by their semáforo, each nearest compromiso first. */
  byEstado: Readonly<Record<SemaforoEstado, ListRow[]>>
  /** Open plans whose semáforo is none the page knows — shown, never re-labelled. */
  unknown: ListRow[]
  cumplidos: ListRow[]
}

export function toRows(
  plans: readonly PlanAccion[],
  asOf: string,
  names: ReadonlyMap<string, string>,
  personas: readonly PersonaPickerItem[],
  viewer: Viewer,
  claims: TrackingClaims | null,
): ListRow[] {
  const directory = new Map(personas.map((persona) => [persona.id, persona]))
  return plans.map((plan) => ({
    ...planLine(plan, asOf, directory, viewer),
    nodoExternalId: plan.nodoExternalId,
    nodoName: names.get(plan.nodoExternalId) ?? null,
    como: plan.metodologiaComo,
    overdue: isOverdue(plan, asOf),
    hasProgress: hasRecordedProgress(plan),
    responsableIsViewer: plan.responsableEjecucionExternalId !== '' && plan.responsableEjecucionExternalId === viewer.personaExternalId,
    canManage: canManagePlan(plan, claims),
  }))
}

export function groupRows(rows: readonly ListRow[]): GroupedRows {
  const byEstado: Record<SemaforoEstado, ListRow[]> = { Rojo: [], Amarillo: [], Verde: [] }
  const unknown: ListRow[] = []
  const cumplidos: ListRow[] = []
  for (const row of rows) {
    if (row.cumplido) {
      cumplidos.push(row)
      continue
    }
    const estado = toSemaforoEstado(row.estado)
    if (estado) byEstado[estado].push(row)
    else unknown.push(row)
  }
  for (const list of Object.values(byEstado)) list.sort(byCompromiso)
  unknown.sort(byCompromiso)
  cumplidos.sort((a, b) => b.fechaCompromiso.localeCompare(a.fechaCompromiso))
  return { byEstado, unknown, cumplidos }
}

/** The names of the nodos holding at least one row, in the directory's order when it answered. */
export function nodoNamesOf(rows: readonly ListRow[], order: readonly string[]): string[] {
  const present = new Set(rows.map((row) => row.nodoExternalId))
  const named = new Map(rows.map((row) => [row.nodoExternalId, row.nodoName]))
  const ids = [...order.filter((id) => present.has(id)), ...[...present].filter((id) => !order.includes(id))]
  return ids.map((id) => named.get(id)).filter((name): name is string => Boolean(name))
}

export interface Coverage {
  plans: number
  /** Distinct nodos with at least one plan. */
  nodosWith: number
  /** Every nodo in the directory; `null` when the directory was not answered. */
  nodosTotal: number | null
  /** The directory's nodos with no plan, by name. */
  without: string[]
}

export function coverage(rows: readonly ListRow[], directory: readonly { id: string; name: string }[] | null): Coverage {
  const withPlans = new Set(rows.map((row) => row.nodoExternalId))
  return {
    plans: rows.length,
    nodosWith: withPlans.size,
    nodosTotal: directory === null ? null : directory.length,
    without: directory === null ? [] : directory.filter((nodo) => !withPlans.has(nodo.id)).map((nodo) => nodo.name),
  }
}
