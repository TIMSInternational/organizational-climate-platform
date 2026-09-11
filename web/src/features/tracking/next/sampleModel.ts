import type { BitacoraAvance } from './model'

/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * A plan's bitácora — who created it and every avance recorded on it — exists in the
 * tracking service and is not on the wire:
 *
 * | Field                              | Endpoint that will provide it                     |
 * |------------------------------------|---------------------------------------------------|
 * | the bitácora entries (avances)     | `GET /api/planes-accion/{id}` once `PlanResponse` |
 * | and the plan's creator             | (`PlanDeAccionDtos.cs:20-35`) carries `_bitacora` |
 * | "Avances registrados" on the board | the same, summed over the nodo's plans            |
 *
 * The entity keeps it (`PlanDeAccion._bitacora`, `BitacoraEntryConfiguration.cs`) and the
 * xlsx export already reads it (`TrackingSheetExportEndpoints.cs`,
 * `.Include("_bitacora")`); `PlanResponse.From` simply does not copy it out. Until it
 * does, the Bitácora card and the "Avances registrados" tile read from here and wear the
 * "Datos de muestra" chip.
 *
 * Keyed by plan code as the demo tenant's seed writes it. The figures are the approved
 * artboards' Grupo Meridiano ones: Ana Rojas created the three plans on 10 September and
 * no avance has been recorded on any of them.
 */
export const SAMPLE_CREATOR_BY_CODE: Readonly<Record<string, string>> = {
  'PA-2026-00001': 'Ana Rojas',
  'PA-2026-00002': 'Ana Rojas',
  'PA-2026-00003': 'Ana Rojas',
}

/** No avance is on record for any demo plan. */
export const SAMPLE_AVANCES_BY_CODE: Readonly<Record<string, readonly BitacoraAvance[]>> = {}
