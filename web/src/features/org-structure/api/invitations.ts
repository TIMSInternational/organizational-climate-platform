import { authFetch } from '../../../api/authFetch'

export interface Invitation {
  id: string
  email: string | null
  companyId: string
  departmentId: string | null
  invitationType: string
  role: string
  status: string
  token: string
  expiresAt: string
  sentAt: string | null
  acceptedAt: string | null
  reminderCount: number
}

export interface CreateInvitationInput {
  invitationType: string
  email: string
  companyId: string
  departmentId?: string
  role: string
}

export interface CreateShareableLinkInput {
  companyId: string
  departmentId?: string
  role: string
}

export async function listInvitations(baseUrl: string, companyId: string): Promise<Invitation[]> {
  const response = await authFetch(`${baseUrl}/admin/invitations?companyId=${companyId}`)
  const body = (await response.json()) as { invitations: Invitation[] }
  return body.invitations
}

export async function createInvitation(baseUrl: string, input: CreateInvitationInput): Promise<Invitation> {
  const response = await authFetch(`${baseUrl}/admin/invitations`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Invitation>
}

export async function createShareableLink(baseUrl: string, input: CreateShareableLinkInput): Promise<Invitation> {
  const response = await authFetch(`${baseUrl}/admin/invitations/shareable-link`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Invitation>
}

export async function resendInvitation(baseUrl: string, id: string): Promise<Invitation> {
  const response = await authFetch(`${baseUrl}/admin/invitations/${id}/resend`, {
    method: 'POST',
  })
  return response.json() as Promise<Invitation>
}
