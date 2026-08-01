import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listUsers, getUser, updateUser, updateUserRole } from './users'

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

  it('updates a user role', async () => {
    const updated = { id: '1', companyId: 'company-1', email: 'a@b.com', name: 'A', role: 'supervisor', departmentId: null, managerId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))

    const result = await updateUserRole(baseUrl, '1', 'supervisor')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/users/1/role`, expect.objectContaining({ method: 'PUT' }))
    expect(result.role).toBe('supervisor')
  })
})
