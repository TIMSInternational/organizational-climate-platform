import type { PlanAccion, SemaforoCounts } from '../api/trackingApi'
import type { PersonaPickerItem } from '../api/trackingPickers'
import { SEMAFORO_ORDER, semaforoCount, toPercent, type SemaforoEstado } from '../semaforo'
import type { PersonaRef, PlanLine } from './model'

/**
 * The derived readings of the three redesigned tracking screens, as pure functions.
 *
 * ## Days
 *
 * Every date here is a `DateOnly` — `YYYY-MM-DD` with no time and no zone (`planDates.ts`)
 * — and `asOf` is the reader's own calendar day in the same shape (`planDates.todayIso`).
 * Both parse as UTC midnight, so a difference in days is exact and cannot move with the
 * reader's zone, and two of them compare as strings exactly as they compare as dates.
 *
 * ## Percentages
 *
 * Nothing here scales. `porcentajeAvance` is a fraction on the wire and crosses
 * `semaforo.toPercent` once, in {@link planLine}; `semaforoTable.test.ts` fails the build
 * if a second conversion appears anywhere in the feature.
 */

const MS_PER_DAY = 86_400_000

/** Whole days from `fromIso` to `toIso`; negative when `toIso` is earlier. */
export function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_DAY)
}

/** An open plan whose compromiso has gone by. A plan due today is not overdue. */
export function isOverdue(plan: Pick<PlanAccion, 'cumplido' | 'fechaCompromiso'>, asOf: string): boolean {
  return !plan.cumplido && plan.fechaCompromiso < asOf
}

/**
 * Whether a progress update is on record, read off the two fields the payload has.
 *
 * `PlanDeAccion.RegistrarAvance` writes both `PorcentajeAvance` and
 * `FechaUltimaActualizacion` (the avance's own date); creation sets the percentage to 0
 * and the last update to the creation date. So a plan with either a percentage above zero
 * or a last update later than its creation has had an avance. The one case this cannot
 * see is an avance of 0 % dated on the creation day, which leaves both fields exactly as
 * creation left them — the bitácora (not on the wire, see `sampleModel.ts`) is the only
 * thing that could tell those apart.
 */
export function hasRecordedProgress(plan: Pick<PlanAccion, 'porcentajeAvance' | 'fechaUltimaActualizacion' | 'fechaCreacion'>): boolean {
  return plan.porcentajeAvance > 0 || plan.fechaUltimaActualizacion > plan.fechaCreacion
}

/** A `DateOnly` with its year — "15 sept 2026" — rendered in UTC so the day cannot move. */
export function fullDay(iso: string, locale: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Date(parsed).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}

/** Up to two initials, for the avatar beside a name. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toLocaleUpperCase())
    .join('')
}

export interface Viewer {
  /** The `sub` claim — the viewer's own `PersonaExternalId`. */
  personaExternalId: string
  /** The `name` claim, or `null`. */
  name: string | null
}

/**
 * A person, as far as this viewer can name them: the directory when it answered (an
 * administrator), otherwise only the viewer themselves.
 */
export function resolvePersona(
  id: string,
  directory: ReadonlyMap<string, PersonaPickerItem>,
  viewer: Viewer,
): PersonaRef {
  const known = directory.get(id)
  if (known) return { id, name: known.name, email: known.email }
  if (id !== '' && id === viewer.personaExternalId && viewer.name) return { id, name: viewer.name, email: null }
  return { id, name: null, email: null }
}

export function planLine(
  plan: PlanAccion,
  asOf: string,
  directory: ReadonlyMap<string, PersonaPickerItem>,
  viewer: Viewer,
): PlanLine {
  return {
    id: plan.id,
    code: plan.planCode,
    que: plan.descripcionQue,
    estado: plan.estadoSemaforo,
    percent: toPercent(plan.porcentajeAvance),
    fechaCompromiso: plan.fechaCompromiso,
    daysToCompromiso: dayDiff(asOf, plan.fechaCompromiso),
    cumplido: plan.cumplido,
    responsable: resolvePersona(plan.responsableEjecucionExternalId, directory, viewer),
  }
}

/** Nearest compromiso first, then by code — "ordenados por compromiso". */
export function byCompromiso<T extends { fechaCompromiso: string; code: string }>(a: T, b: T): number {
  const byDate = a.fechaCompromiso.localeCompare(b.fechaCompromiso)
  return byDate !== 0 ? byDate : a.code.localeCompare(b.code)
}

/** The nodo names carrying at least one plan in `estado`, in the order given. */
export function nodosIn(
  nodos: readonly { conteos: SemaforoCounts; name: string | null }[],
  estado: SemaforoEstado,
): string[] {
  return nodos.filter((nodo) => semaforoCount(nodo.conteos, estado) > 0).flatMap((nodo) => (nodo.name ? [nodo.name] : []))
}

/** `Finanzas`, `Ingeniería y Operaciones` — the reader's own list grammar. */
export function joinNames(names: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names)
}

/**
 * The state the board's semáforo tile leads with: the worst one that holds a plan, so a
 * red plan is never tucked behind a green count. `null` when the nodo has no plans.
 */
export function leadingEstado(conteos: SemaforoCounts): SemaforoEstado | null {
  return SEMAFORO_ORDER.find((estado) => semaforoCount(conteos, estado) > 0) ?? null
}

/** The nearest compromiso among open plans (days may be negative when all are past). */
export function nextCompromiso<T extends { fechaCompromiso: string; code: string; cumplido: boolean; daysToCompromiso: number }>(
  plans: readonly T[],
): T | null {
  const open = plans.filter((plan) => !plan.cumplido).sort(byCompromiso)
  return open.find((plan) => plan.daysToCompromiso >= 0) ?? open[0] ?? null
}

/** The plan detail's 404, as `authFetch` reports it: an empty body leaves only the status. */
export function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message)
}
