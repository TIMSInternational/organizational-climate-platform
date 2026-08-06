import { authFetch } from '../../../api/authFetch'

/**
 * `value` is the stable, locale-independent key stored against a person; `label` is
 * display text resolved for the requested locale. Filtering, grouping and exporting
 * all key off the value, so a bilingual company does not split its own headcount in
 * two the moment the labels are translated (#195).
 */
export interface DemographicFieldOption {
  order: number
  value: string
  label: string | null
}

/** A plain string is attributed to the company's own language; a map is explicit. */
export type LocalizedInput = string | Partial<Record<'en' | 'es', string>>

export interface DemographicFieldOptionInput {
  value?: string
  label: LocalizedInput
}

export interface DemographicField {
  id: string
  companyId: string
  field: string
  label: string | null
  type: string
  options: DemographicFieldOption[] | null
  required: boolean
  order: number
  isActive: boolean
  resolvedLocale: string
  fallbackFields: string[]
}

export interface CreateDemographicFieldInput {
  companyId: string
  field: string
  label: LocalizedInput
  type: string
  options?: DemographicFieldOptionInput[]
  required: boolean
  order: number
}

export interface UpdateDemographicFieldInput {
  label?: LocalizedInput
  options?: DemographicFieldOptionInput[]
  required?: boolean
  order?: number
  isActive?: boolean
}

export async function listDemographicFields(baseUrl: string, companyId: string, lang?: string): Promise<DemographicField[]> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields?companyId=${companyId}${lang ? `&lang=${lang}` : ''}`)
  const body = (await response.json()) as { fields: DemographicField[] }
  return body.fields
}

export async function createDemographicField(baseUrl: string, input: CreateDemographicFieldInput): Promise<DemographicField> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<DemographicField>
}

export async function updateDemographicField(baseUrl: string, id: string, input: UpdateDemographicFieldInput): Promise<DemographicField> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<DemographicField>
}
