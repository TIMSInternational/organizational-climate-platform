import { authFetch } from '../../../api/authFetch'

export interface Company {
  id: string
  name: string
  emailDomain: string | null
  industry: string | null
  size: string | null
  country: string | null
  subscriptionTier: string | null
  createdAt: string
  /**
   * The company's language setting ('es' | 'en'), which every new survey, invitation and report
   * inherits. On the list only (`GET /admin/companies`); absent from an API older than it.
   */
  language?: string | null
}

export interface CompanyDetail extends Company {
  userCount: number
}

export interface CreateCompanyInput {
  name: string
  emailDomain: string
  industry: string
  size: string
  country: string
  subscriptionTier?: string
}

export interface UpdateCompanyInput {
  name?: string
  emailDomain?: string
  industry?: string
  size?: string
  country?: string
  subscriptionTier?: string
}

export async function listCompanies(baseUrl: string): Promise<Company[]> {
  const response = await authFetch(`${baseUrl}/admin/companies`)
  const body = (await response.json()) as { companies: Company[] }
  return body.companies
}

export async function createCompany(baseUrl: string, input: CreateCompanyInput): Promise<CompanyDetail> {
  const response = await authFetch(`${baseUrl}/admin/companies`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanyDetail>
}

export async function getCompany(baseUrl: string, id: string): Promise<CompanyDetail> {
  const response = await authFetch(`${baseUrl}/admin/companies/${id}`)
  return response.json() as Promise<CompanyDetail>
}

export async function updateCompany(baseUrl: string, id: string, input: UpdateCompanyInput): Promise<CompanyDetail> {
  const response = await authFetch(`${baseUrl}/admin/companies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanyDetail>
}

/**
 * What deleting a company would take, and what refuses it: `GET /admin/companies/{id}/deletion`
 * (ruled 2026-11-08, super admins only). `deletable` is false while the company holds any answer
 * (counted or excluded), a microclimate that took one, a link participation, or a super admin.
 */
export interface CompanyDeletionAssessment {
  id: string
  name: string
  domain: string | null
  deletable: boolean
  responses: number
  answeredMicroclimates: number
  linkParticipations: number
  superAdmins: number
  people: number
  surveys: number
  departments: number
}

export async function getCompanyDeletion(baseUrl: string, id: string): Promise<CompanyDeletionAssessment> {
  const response = await authFetch(`${baseUrl}/admin/companies/${id}/deletion`)
  return response.json() as Promise<CompanyDeletionAssessment>
}

/**
 * Deletes a company nobody has answered anything in, with everything under it:
 * `DELETE /admin/companies/{id}` with the company's name typed as the confirmation. Irreversible.
 * Throws the server's refusal (`company_name_mismatch`, `company_has_responses`,
 * `company_holds_super_admins`, `company_people_referenced`) for the dialog to say.
 */
export async function deleteCompany(baseUrl: string, id: string, confirmName: string): Promise<void> {
  await authFetch(`${baseUrl}/admin/companies/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmName }),
  })
}
