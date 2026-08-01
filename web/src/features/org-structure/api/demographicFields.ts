import { authFetch } from '../../../api/authFetch'

export interface DemographicField {
  id: string
  companyId: string
  field: string
  label: string
  type: string
  options: string[] | null
  required: boolean
  order: number
  isActive: boolean
}

export interface CreateDemographicFieldInput {
  companyId: string
  field: string
  label: string
  type: string
  options?: string[]
  required: boolean
  order: number
}

export interface UpdateDemographicFieldInput {
  label?: string
  options?: string[]
  required?: boolean
  order?: number
  isActive?: boolean
}

export async function listDemographicFields(baseUrl: string, companyId: string): Promise<DemographicField[]> {
  const response = await authFetch(`${baseUrl}/admin/demographic-fields?companyId=${companyId}`)
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
