import type { PlanFinding } from './model'

/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * Two columns of the ActionPlansList artboard have no endpoint behind them today, and
 * this module is the only thing that feeds them. While it does, the page wears the
 * "Datos de muestra" chip on those two columns and on the two tiles that count them,
 * and nowhere else:
 *
 * | Field                          | Endpoint that will provide it                    |
 * |--------------------------------|--------------------------------------------------|
 * | the originating finding (the   | `GET /action-plans` → `ActionPlan.finding` —     |
 * | dimension of the map cell)     | phase 2; `ActionPlanEndpoints.ListAsync` returns |
 * |                                | `{ id, title, companyId, departmentId, dueDate,  |
 * |                                | status, priority, createdAt }` and nothing else  |
 * | the owner (responsable)        | `GET /action-plans` → `ActionPlan.owner` —       |
 * |                                | phase 2; the list carries no person at all       |
 *
 * The department half of a finding is REAL — `departmentId` is on the payload and its
 * name comes from `GET /admin/departments` — so only the dimension is read from here.
 *
 * Keyed by the plan's title as the demo tenant's seed writes it
 * (`scripts/seed-surveys.mjs`), because a plan's id differs in every database the seed
 * runs against and its title does not. A plan this table does not name has no sample
 * finding, and every plan has no sample owner — which is what the Grupo Meridiano
 * artboard draws ("Sin asignar" on all four).
 */
export const SAMPLE_FINDING_BY_TITLE: Readonly<Record<string, PlanFinding>> = {
  'Programa de reconocimiento entre pares': { dimensionKey: 'recognition' },
  'Reducir la carga de trabajo en Operaciones': { dimensionKey: 'workload' },
  'Plan de desarrollo de carrera en Ingeniería': { dimensionKey: 'growth' },
}

/** No plan has a sample owner: the artboard reads "Sin asignar" on every row. */
export const SAMPLE_OWNER_BY_TITLE: Readonly<Record<string, string>> = {}
