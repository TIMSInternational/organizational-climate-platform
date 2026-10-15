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

/**
 * Sends a BATCH of people their sign-in details again -- the launch-day reminder.
 *
 * Every person sent gets a NEW password and their previous one stops working, exactly as the
 * single resend does (ruled 2026-10-14). Someone who kept the first password and was halfway
 * through the survey is signed out until they read the new mail, which is why the copy says
 * the details replace the previous ones.
 *
 * `MAX_CREDENTIALS_BATCH` is the API's cap, and it is a real one: the send is inline rather
 * than queued, because queueing would mean writing a plaintext password into a row and
 * leaving it there until a worker ran. Callers chunk and report progress.
 *
 * As with the single resend, A FAILED SEND IS A 200: the response names every id with its own
 * outcome, so a caller that treats "did not throw" as success reports delivery the server
 * denied.
 */
export const MAX_CREDENTIALS_BATCH = 100

export interface CredentialsResendOutcome {
  userId: string
  email: string | null
  delivered: boolean
  failureReason: string | null
  /** `not_found`, `not_mass_invite`, `inactive` or `send_failed`; null when it went out. */
  code: string | null
}

export interface CredentialsResendBatchResult {
  requested: number
  sent: number
  failed: number
  outcomes: CredentialsResendOutcome[]
}

export async function resendCredentialsBatch(
  baseUrl: string,
  userIds: readonly string[],
): Promise<CredentialsResendBatchResult> {
  const response = await authFetch(`${baseUrl}/admin/users/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  })
  return response.json() as Promise<CredentialsResendBatchResult>
}
