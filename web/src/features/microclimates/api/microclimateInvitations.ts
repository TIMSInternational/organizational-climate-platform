import { authFetch } from '../../../api/authFetch'
import type { MicroclimateAnonymityGuarantee } from './microclimateLinks'

/**
 * The administrator's half of the microclimate invitations — two routes that already exist
 * (`MicroclimateInvitationEndpoints.cs:158-159`, `GET` and `POST
 * /microclimates/{id}/invitations`) and had no caller in the web until the redesigned
 * Detalle de microclima put "Invitaciones por correo" on screen. No endpoint is new here.
 *
 * The shapes mirror `MicroclimateInvitationDtos.cs`. Note what they do not carry: a token.
 * "NO READ DTO CARRIES A TOKEN" is the DTO file's own rule — an admin who could list tokens
 * could open any employee's pulse as them — so neither does this module.
 */

/** `MicroclimateInvitationSummaryDto`: per-status counts, aggregates only. */
export interface MicroclimateInvitationSummary {
  total: number
  pending: number
  sent: number
  opened: number
  started: number
  completed: number
  revoked: number
  expired: number
}

/** `MicroclimateInvitationDetail`: one invitation as an admin sees it. */
export interface MicroclimateInvitation {
  id: string
  microclimateId: string
  userId: string
  email: string
  status: string
  isExpired: boolean
  sentAt: string | null
  openedAt: string | null
  startedAt: string | null
  completedAt: string | null
  reminderCount: number
  lastReminderSent: string | null
  expiresAt: string
  createdAt: string
}

/** `MicroclimateInvitationListResponse`. */
export interface MicroclimateInvitationList {
  invitations: MicroclimateInvitation[]
  summary: MicroclimateInvitationSummary
  anonymity: MicroclimateAnonymityGuarantee
}

/**
 * `CreateMicroclimateInvitationsRequest`: exactly one selector. An empty request is a 400 on
 * the server, never a silent "everyone" — the failure mode of guessing is mailing a company.
 */
export type CreateMicroclimateInvitationsInput =
  | { allCompanyUsers: true }
  | { departmentIds: string[] }
  | { userIds: string[] }

/** `MicroclimateInvitationBatchResult`. */
export interface MicroclimateInvitationBatchResult {
  requested: number
  created: number
  invitationIds: string[]
  skippedUserIds: string[]
  notificationsQueued: number
  undeliverableRecipients: number
  note: string | null
}

export async function listMicroclimateInvitations(
  baseUrl: string,
  microclimateId: string,
  offset = 0,
): Promise<MicroclimateInvitationList> {
  const query = offset > 0 ? `?offset=${offset}` : ''
  const response = await authFetch(`${baseUrl}/microclimates/${encodeURIComponent(microclimateId)}/invitations${query}`)
  return response.json() as Promise<MicroclimateInvitationList>
}

/** Rows one `GET /microclimates/{id}/invitations` page carries (`MaxInvitationPageSize`). */
export const INVITATION_PAGE_SIZE = 500

/** A ceiling on pages, so a server that never shortens a page cannot loop this for ever. */
const MAX_INVITATION_PAGES = 40

/**
 * The WHOLE invitation list (G23): every page of `GET /microclimates/{id}/invitations?offset=`,
 * concatenated. The summary and the anonymity contract are the first page's — they describe
 * the session, not the page.
 */
export async function listAllMicroclimateInvitations(
  baseUrl: string,
  microclimateId: string,
): Promise<MicroclimateInvitationList> {
  const first = await listMicroclimateInvitations(baseUrl, microclimateId)
  const invitations = [...first.invitations]
  let page = first.invitations
  for (let pages = 1; page.length >= INVITATION_PAGE_SIZE && invitations.length < first.summary.total && pages < MAX_INVITATION_PAGES; pages++) {
    page = (await listMicroclimateInvitations(baseUrl, microclimateId, invitations.length)).invitations
    invitations.push(...page)
  }
  return { ...first, invitations }
}

export async function createMicroclimateInvitations(
  baseUrl: string,
  microclimateId: string,
  input: CreateMicroclimateInvitationsInput,
): Promise<MicroclimateInvitationBatchResult> {
  const response = await authFetch(`${baseUrl}/microclimates/${encodeURIComponent(microclimateId)}/invitations`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateInvitationBatchResult>
}
