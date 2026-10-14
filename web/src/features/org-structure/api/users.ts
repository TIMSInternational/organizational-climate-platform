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
  /**
   * The generated sign-in name a MASS INVITE gave this account, and null for everyone else --
   * the API has always sent it (`UserListItem.Username`), the client just never read it.
   *
   * It is the only thing that distinguishes an account whose password the platform chose and
   * mailed from one whose holder chose their own, which is what decides whether resending
   * sign-in details means anything for this person.
   */
  username: string | null
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

/**
 * Sends this person a FRESH username and password, replacing the pair the mass invite mailed.
 *
 * The endpoint has existed since the mass invite shipped and nothing called it, so an account
 * whose credentials email failed could not be recovered from inside the product at all: unlike
 * an invitation, which stays `pending` and is listed for resending, a mass-invite account is
 * created active and looks identical to one whose owner has simply not signed in yet.
 *
 * 409 `not_mass_invite` is the API refusing an account that signs in by email and therefore has
 * no generated details to resend.
 *
 * A FAILED SEND IS A 200. The endpoint replaces the password first and mails second, so it
 * answers `{ delivered: false, failureReason }` rather than an error status -- the new pair is
 * in force either way and only the email is in doubt. A caller that treats "did not throw" as
 * success therefore reports delivery the server just denied, which is the exact defect this
 * whole change exists to remove.
 */
export interface CredentialsResendResult {
  delivered: boolean
  failureReason: string | null
}

export async function resendCredentials(baseUrl: string, id: string): Promise<CredentialsResendResult> {
  const response = await authFetch(`${baseUrl}/admin/users/${id}/credentials`, { method: 'POST' })
  return response.json() as Promise<CredentialsResendResult>
}
