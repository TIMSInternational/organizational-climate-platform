import type { PlanFinding } from './model'

/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * One column of the ActionPlansList artboard has no endpoint behind it today, and this
 * module is the only thing that feeds it. While it does, the page wears the "Datos de
 * muestra" chip on that column's heading and on the one tile that counts it, and nowhere
 * else:
 *
 * | Field                          | Endpoint that will provide it                    |
 * |--------------------------------|--------------------------------------------------|
 * | the originating finding (the   | `GET /action-plans` → `ActionPlan.finding` —     |
 * | dimension of the map cell)     | phase 2; `ActionPlanEndpoints.ListAsync` returns |
 * |                                | `{ id, title, companyId, departmentId, dueDate,  |
 * |                                | status, priority, createdAt }` and nothing else  |
 *
 * The department half of a finding is REAL — `departmentId` is on the payload and its
 * name comes from `GET /admin/departments` — so only the dimension is read from here.
 *
 * The owner is NOT sample: the action-plan entity has no owner at all (`ActionPlan.cs`
 * carries `CreatedBy` and no assignee), so every plan is, in fact, unassigned — the
 * "Sin asignar" the artboard draws on all four is the real reading until phase 2 adds one.
 *
 * Keyed by the plan's title as the demo tenant's seed writes it
 * (`scripts/seed-surveys.mjs`), because a plan's id differs in every database the seed
 * runs against and its title does not. A plan this table does not name has no sample
 * finding.
 */
export const SAMPLE_FINDING_BY_TITLE: Readonly<Record<string, PlanFinding>> = {
  'Programa de reconocimiento entre pares': { dimensionKey: 'recognition' },
  'Reducir la carga de trabajo en Operaciones': { dimensionKey: 'workload' },
  'Plan de desarrollo de carrera en Ingeniería': { dimensionKey: 'growth' },
}
