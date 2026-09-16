import { authFetch } from '../../../api/authFetch'

/** One metered climate service's licence state for a company (super-admin surface). */
export interface CompanyServiceLicense {
  serviceType: string
  seatsTotal: number
  seatsUsed: number
  status: 'active' | 'suspended'
  licensed: boolean
  notes: string | null
  updatedAt: string | null
}

export interface GrantLicenseInput {
  seatsTotal: number
  notes?: string | null
}

export async function listServiceLicenses(baseUrl: string, companyId: string): Promise<CompanyServiceLicense[]> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/licenses`)
  const body = (await response.json()) as { services: CompanyServiceLicense[] }
  return body.services
}

export async function grantServiceLicense(
  baseUrl: string,
  companyId: string,
  serviceType: string,
  input: GrantLicenseInput,
): Promise<CompanyServiceLicense> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/licenses/${serviceType}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanyServiceLicense>
}

export async function suspendServiceLicense(
  baseUrl: string,
  companyId: string,
  serviceType: string,
): Promise<CompanyServiceLicense> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/licenses/${serviceType}/suspend`, {
    method: 'POST',
  })
  return response.json() as Promise<CompanyServiceLicense>
}

export async function reactivateServiceLicense(
  baseUrl: string,
  companyId: string,
  serviceType: string,
): Promise<CompanyServiceLicense> {
  const response = await authFetch(`${baseUrl}/admin/companies/${companyId}/licenses/${serviceType}/reactivate`, {
    method: 'POST',
  })
  return response.json() as Promise<CompanyServiceLicense>
}
