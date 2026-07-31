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
