import type { PlanAccion } from './api/trackingApi'
import { SEMAFORO_ORDER, toSemaforoEstado } from './semaforo'

/**
 * The order a work queue has to be in: worst semáforo first, then the nearest
 * compromiso.
 *
 * The service does not sort. `ListAsync` and `MisTareasAsync` both end in a bare
 * `ToListAsync(cancellationToken)`, so the rows arrive in whatever order Postgres
 * felt like — which for a leader triaging a node, or an involucrado looking at
 * their own tasks, is no order at all. Sorting client-side keeps the fix inside
 * this slice rather than adding an `?orderBy=` to a service it is not changing.
 *
 * **An unknown state sorts LAST, not first.** `EstadoSemaforo` is stringly typed on
 * the wire, so a fourth state added service-side would arrive as a word this build
 * has never seen. Ranking it above Rojo would be inventing urgency out of
 * ignorance; ranking it below Verde says "I do not know what this is" without
 * pretending.
 *
 * A plain `.ts` module rather than a helper beside the table component: oxlint's
 * `react(only-export-components)` fails a `.tsx` that exports both a component and
 * a function, and the six-warning budget in this repository is a hard ceiling.
 */
function rank(plan: PlanAccion): number {
  const estado = toSemaforoEstado(plan.estadoSemaforo)
  if (estado === null) return SEMAFORO_ORDER.length
  return SEMAFORO_ORDER.indexOf(estado)
}

export function sortPlans(plans: readonly PlanAccion[]): PlanAccion[] {
  return [...plans].sort((a, b) => {
    const byEstado = rank(a) - rank(b)
    if (byEstado !== 0) return byEstado
    // ISO `YYYY-MM-DD` sorts lexicographically exactly as it sorts chronologically,
    // which is why this needs no date parsing and cannot be moved by a timezone.
    return a.fechaCompromiso.localeCompare(b.fechaCompromiso)
  })
}
