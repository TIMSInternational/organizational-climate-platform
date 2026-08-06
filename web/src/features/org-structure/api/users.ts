import { authFetch } from '../../../api/authFetch'

export interface User {
  id: string
  email: string
  name: string
  role: string
  departmentId: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface UserDetail extends User {
  // Null for a user with no tenant -- a global super_admin. The API's UserDetail.CompanyId
  // became Guid? in #191, so this can genuinely arrive as null.
  companyId: string | null
  managerId: string | null
}

export interface UpdateUserInput {
  name?: string
  departmentId?: string
  managerId?: string
  isActive?: boolean
}

export async function listUsers(baseUrl: string, companyId: string): Promise<User[]> {
  const response = await authFetch(`${baseUrl}/admin/users?companyId=${companyId}`)
  const body = (await response.json()) as { users: User[] }
  return body.users
}

export async function getUser(baseUrl: string, id: string): Promise<UserDetail> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}`)
  return response.json() as Promise<UserDetail>
}

export async function updateUser(baseUrl: string, id: string, input: UpdateUserInput): Promise<UserDetail> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<UserDetail>
}

export async function updateUserRole(baseUrl: string, id: string, role: string): Promise<UserDetail> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
  return response.json() as Promise<UserDetail>
}
