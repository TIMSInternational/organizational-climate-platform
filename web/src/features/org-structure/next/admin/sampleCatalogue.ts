/**
 * SAMPLE DATA. A proposal, not a measurement.
 *
 * `GET /admin/demographic-fields?companyId=` is the endpoint that provides a tenant's
 * catalogue, and Grupo Meridiano S.A.'s answers `{ "fields": [] }`: it has no demographic
 * fields, so its results divide only by department. The *Campos demográficos* artboard
 * (10 Sep) draws, for exactly that case, a starting catalogue marked «Propuesta · datos de
 * ejemplo» — these five fields. The screen shows them only while the endpoint returns none,
 * under the amber sample chip, and never sends them anywhere: nothing is created until the
 * administrator fills the "Nuevo campo" form and presses its button.
 *
 * Only the fields and their values are sample. «Personas por valor» and each verdict are
 * computed on screen from the tenant's REAL active people (`GET /dashboard/company-admin`),
 * with the same arithmetic a real field gets (`super/demographics.ts`).
 *
 * Labels are catalogue keys under `demographicFields.next.sample`, so the proposal reads in
 * the viewer's language.
 */
export interface SampleField {
  /** The stable key the field would get. */
  field: string
  /** `demographicFields.next.sample.<labelKey>` */
  labelKey: string
  type: 'select' | 'date'
  /** `demographicFields.next.sample.<valueKey>` for each value, in order. */
  valueKeys: readonly string[]
  required: boolean
  isActive: boolean
}

export const SAMPLE_CATALOGUE: readonly SampleField[] = [
  {
    field: 'antiguedad',
    labelKey: 'tenure',
    type: 'select',
    valueKeys: ['tenureUnder1', 'tenure1to3', 'tenure3to5', 'tenureOver5'],
    required: true,
    isActive: true,
  },
  {
    field: 'tipo_jornada',
    labelKey: 'shift',
    type: 'select',
    valueKeys: ['shiftDay', 'shiftMixed', 'shiftNight'],
    required: false,
    isActive: true,
  },
  {
    field: 'rango_edad',
    labelKey: 'age',
    type: 'select',
    valueKeys: ['age18', 'age25', 'age30', 'age35', 'age40', 'age45', 'age50', 'age55', 'age60'],
    required: false,
    isActive: true,
  },
  { field: 'fecha_ingreso', labelKey: 'startDate', type: 'date', valueKeys: [], required: false, isActive: true },
  {
    field: 'nivel_puesto',
    labelKey: 'level',
    type: 'select',
    valueKeys: ['levelOperational', 'levelProfessional', 'levelManagement'],
    required: false,
    isActive: false,
  },
]
