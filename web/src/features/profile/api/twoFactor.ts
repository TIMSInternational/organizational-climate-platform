import { ApiError, authFetch } from '../../../api/authFetch'
import { getToken } from '../../../auth/token'
import type { TwoFactorEnrollmentKey, TwoFactorEnrollmentResult } from '../../../auth/twoFactor'

/** `GET /profile/two-factor`. `available` is false when the feature is off: the page then shows nothing. */
export interface ProfileTwoFactorStatus {
  available: boolean
  enabled: boolean
  /** True for a super administrator while the feature is on: no disable control is offered. */
  required: boolean
  recoveryCodesRemaining: number
  enabledAt: string | null
}

const PATH = '/profile/two-factor'

/**
 * The code-checking calls answer **401** for a wrong code. `authFetch` cannot be used for them:
 * it treats EVERY 401 as "the session is over" — it clears the stored token and leaves for
 * `/login` before `allowStatus` is even consulted (`api/authFetch.ts`) — so one mistyped code
 * would sign the reader out mid-form. Measured: `TwoFactorCard.test.tsx` "a wrong code keeps
 * the session" failed with "Session expired" while these calls went through `authFetch`.
 *
 * So they send the bearer themselves and turn any refusal into an `ApiError` the card explains.
 * A session that genuinely ended reads here as a wrong code; the page's next ordinary request
 * (through `authFetch`) then signs the reader out as usual.
 */
async function postCode<T>(url: string, body: unknown): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: unknown } | null
    throw new ApiError(response.status, typeof payload?.message === 'string' ? payload.message : '')
  }
  return response.json() as Promise<T>
}

/** `null` when the endpoint is absent (404): an API without the feature shows nothing either. */
export async function getProfileTwoFactor(baseUrl: string): Promise<ProfileTwoFactorStatus | null> {
  const response = await authFetch(`${baseUrl}${PATH}`, {}, { allowStatus: [404] })
  if (response.status === 404) return null
  return response.json() as Promise<ProfileTwoFactorStatus>
}

/** `POST /profile/two-factor/start`. `currentCode` is required when an authenticator is already set (a device change). */
export function startProfileTwoFactor(baseUrl: string, currentCode: string | null): Promise<TwoFactorEnrollmentKey> {
  return postCode(`${baseUrl}${PATH}/start`, { currentCode })
}

/** `POST /profile/two-factor/confirm`. The answer's token REPLACES the stored one: the old session is dead. */
export function confirmProfileTwoFactor(baseUrl: string, code: string): Promise<TwoFactorEnrollmentResult> {
  return postCode(`${baseUrl}${PATH}/confirm`, { code })
}

/** `POST /profile/two-factor/disable`. 403 for a super administrator. Answers a NEW token. */
export async function disableProfileTwoFactor(baseUrl: string, code: string): Promise<string> {
  return (await postCode<{ token: string }>(`${baseUrl}${PATH}/disable`, { code })).token
}
