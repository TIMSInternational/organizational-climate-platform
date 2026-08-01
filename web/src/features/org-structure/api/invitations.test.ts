import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listInvitations, createInvitation, createShareableLink, resendInvitation } from './invitations'

const baseUrl = 'http://api.test'

describe('invitations api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists invitations for a company', async () => {
    const invitations = [{ id: '1', email: 'a@b.com', companyId: 'company-1', departmentId: null, invitationType: 'employee_direct', role: 'employee', status: 'sent', token: 'tok1', expiresAt: '2026-02-01', sentAt: '2026-01-01', acceptedAt: null, reminderCount: 0 }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ invitations }), { status: 200 }))

    const result = await listInvitations(baseUrl, 'company-1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations?companyId=company-1`, expect.anything())
    expect(result).toEqual(invitations)
  })

  it('creates an invitation', async () => {
    const created = { id: '1', email: 'a@b.com', companyId: 'company-1', departmentId: null, invitationType: 'employee_direct', role: 'employee', status: 'sent', token: 'tok1', expiresAt: '2026-02-01', sentAt: '2026-01-01', acceptedAt: null, reminderCount: 0 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))

    const result = await createInvitation(baseUrl, { invitationType: 'employee_direct', email: 'a@b.com', companyId: 'company-1', departmentId: undefined, role: 'employee' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })

  it('creates a shareable link', async () => {
    const created = { id: '1', email: null, companyId: 'company-1', departmentId: null, invitationType: 'employee_self_signup', role: 'employee', status: 'sent', token: 'tok2', expiresAt: '2026-02-01', sentAt: '2026-01-01', acceptedAt: null, reminderCount: 0 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))

    const result = await createShareableLink(baseUrl, { companyId: 'company-1', departmentId: undefined, role: 'employee' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations/shareable-link`, expect.objectContaining({ method: 'POST' }))
    expect(result.email).toBeNull()
  })

  it('resends an invitation', async () => {
    const resent = { id: '1', email: 'a@b.com', companyId: 'company-1', departmentId: null, invitationType: 'employee_direct', role: 'employee', status: 'sent', token: 'tok3', expiresAt: '2026-02-08', sentAt: '2026-01-08', acceptedAt: null, reminderCount: 1 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(resent), { status: 200 }))

    const result = await resendInvitation(baseUrl, '1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/invitations/1/resend`, expect.objectContaining({ method: 'POST' }))
    expect(result.reminderCount).toBe(1)
  })
})
