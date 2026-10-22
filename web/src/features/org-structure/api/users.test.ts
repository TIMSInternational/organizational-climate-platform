import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { ApiError } from '../../../api/authFetch'
import { listUsers, getUser, updateUser, updateUserRole, resendCredentials, UserEmailError } from './users'

const baseUrl = 'http://api.test'

describe('users api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists users with query params', async () => {
    const users = [{ id: '1', email: 'a@b.com', name: 'A', role: 'employee', departmentId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ users }), { status: 200 }))

    const result = await listUsers(baseUrl, 'company-1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users?companyId=company-1`, expect.anything())
    expect(result).toEqual(users)
  })

  it('gets a single user', async () => {
    const user = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'A', role: 'employee', departmentId: null, managerId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(user), { status: 200 }))

    const result = await getUser(baseUrl, '1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1`, expect.anything())
    expect(result).toEqual(user)
  })

  it('updates a user', async () => {
    const updated = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'Renamed', role: 'employee', departmentId: null, managerId: null, isActive: false, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))

    const result = await updateUser(baseUrl, '1', { name: 'Renamed', isActive: false })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.name).toBe('Renamed')
  })

  it('carries the code of a refused address so the screen can translate it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'A user with this email already exists', code: 'email_taken' }), { status: 409 }),
    )

    const error = await updateUser(baseUrl, '1', { email: 'taken@b.com' }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(UserEmailError)
    expect((error as UserEmailError).code).toBe('email_taken')
    expect((error as UserEmailError).status).toBe(409)
  })

  it('still throws a plain ApiError, with the server message, for a 400 that is not about the address', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Department must exist in the same company' }), { status: 400 }),
    )

    const error = await updateUser(baseUrl, '1', { departmentId: 'x' }).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).not.toBeInstanceOf(UserEmailError)
    expect((error as Error).message).toBe('Department must exist in the same company')
  })

  it('updates a user role', async () => {
    const updated = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'A', role: 'supervisor', departmentId: null, managerId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))

    const result = await updateUserRole(baseUrl, '1', 'supervisor')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1/role`, expect.objectContaining({ method: 'PUT' }))
    expect(result.role).toBe('supervisor')
  })

  // The endpoint shipped with the mass invite and nothing called it, which is why an account
  // whose credentials email failed could not be recovered from inside the product.
  it('resends a mass-invite account its sign-in details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ delivered: true, failureReason: null }), { status: 200 }),
    )

    const result = await resendCredentials(baseUrl, 'u-7')

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/users/u-7/credentials`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual({ delivered: true, failureReason: null })
  })

  // The endpoint replaces the password BEFORE mailing, so it reports a failed send as a 200
  // body rather than an error status. A client that only watches for a thrown response would
  // announce a delivery the server just denied.
  it('carries back a 200 that says the mail did not go', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ delivered: false, failureReason: 'no email provider' }), { status: 200 }),
    )

    const result = await resendCredentials(baseUrl, 'u-7')

    expect(result.delivered).toBe(false)
    expect(result.failureReason).toBe('no email provider')
  })
})
