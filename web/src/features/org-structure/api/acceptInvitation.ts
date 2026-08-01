export interface AcceptInvitationInput {
  email?: string
  name: string
  password: string
}

export async function acceptInvitation(baseUrl: string, token: string, input: AcceptInvitationInput): Promise<string> {
  const response = await fetch(`${baseUrl}/invitations/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }

  const result = (await response.json()) as { token: string }
  return result.token
}
