import { authFetch } from '../../../api/authFetch'

export interface Department {
  id: string
  companyId: string
  name: string
  description: string | null
  parentDepartmentId: string | null
  isActive: boolean
  employeeCount: number
}

export interface CreateDepartmentInput {
  companyId: string
  name: string
  description?: string
  parentDepartmentId?: string
  isActive: boolean
}

export interface UpdateDepartmentInput {
  name?: string
  description?: string
  isActive?: boolean
}

export async function listDepartments(baseUrl: string, companyId: string): Promise<Department[]> {
  const response = await authFetch(`${baseUrl}/admin/departments?companyId=${companyId}`)
  const body = (await response.json()) as { departments: Department[] }
  return body.departments
}

export async function createDepartment(baseUrl: string, input: CreateDepartmentInput): Promise<Department> {
  const response = await authFetch(`${baseUrl}/admin/departments`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Department>
}

export async function updateDepartment(baseUrl: string, id: string, input: UpdateDepartmentInput): Promise<Department> {
  const response = await authFetch(`${baseUrl}/admin/departments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Department>
}
