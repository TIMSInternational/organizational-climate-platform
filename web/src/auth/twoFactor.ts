import { AuthRequestError, type LoginResponse } from './api'
import { setToken } from './token'
import { resolveInitialRoute } from '../app/resolveInitialRoute'

/**
 * The second step of signing in (two-factor login, ruled 2026-11-15): required for TIMS super
 * administrators, optional for everyone else who signs in with a password, never seen by a
 * respondent.
 *
 * `POST /auth/login` and `POST /auth/google` answer `{ token }` exactly as before when no second
 * step is needed. Otherwise they answer a **challenge** instead — `twoFactor: "verify"` (the
 * account has an authenticator) or `"enroll"` (a super administrator who has none yet) — and no
 * `token` at all. The challenge token is NOT a session: the API refuses it as a bearer on every
 * endpoint, and it travels only in the JSON body of the three `/auth/two-factor/*` calls below.
 */
export type TwoFactorMode = 'verify' | 'enroll'

export interface TwoFactorChallengeResponse {
  twoFactor: TwoFactorMode
  challengeToken: string
  expiresInSeconds: number
}

export type SignInResponse = LoginResponse | TwoFactorChallengeResponse

/** The route the second step lives on, inside the same auth frame as `/login`. */
export const TWO_FACTOR_PATH = '/login/two-factor'

/**
 * Where the pending challenge is held between `/login` (or the Google return trip) and
 * `/login/two-factor`: **in memory only**, in this module.
 *
 * Not `localStorage` and not `sessionStorage`: the challenge token is a credential (it is
 * half of a sign-in), it is good for five minutes, and nothing about it should be readable
 * from storage or outlive this page. Both routes into the second step reach it by a
 * client-side `navigate` (the Google path too: `AuthTransitionNextPage` exchanges the id
 * token and then navigates within the app), so module state survives the hop. A reload of
 * the second step finds nothing and sends the reader back to sign in, which is the safe
 * failure.
 */
let pending: PendingChallenge | null = null

export interface PendingChallenge {
  mode: TwoFactorMode
  challengeToken: string
  /** Epoch milliseconds after which the server will refuse the challenge. */
  expiresAt: number
  /** Where the reader was going before `/login` stopped them, if anywhere. */
  returnPath: string | null
}

export function isChallenge(response: SignInResponse): response is TwoFactorChallengeResponse {
  const mode = (response as Partial<TwoFactorChallengeResponse>).twoFactor
  return (mode === 'verify' || mode === 'enroll') && typeof (response as Partial<TwoFactorChallengeResponse>).challengeToken === 'string'
}

export function saveChallenge(challenge: PendingChallenge): void {
  pending = { ...challenge }
}

export function readChallenge(): PendingChallenge | null {
  return pending ? { ...pending } : null
}

export function clearChallenge(): void {
  pending = null
}

/**
 * Takes a sign-in answer and returns where to go next: the destination with the session stored,
 * or the second step with the challenge stored. Every sign-in path goes through this one seam so
 * none of them can store a token the server did not send.
 *
 * The destination is resolved AFTER `setToken`, because `resolveInitialRoute` reads the role
 * out of the stored token.
 */
export function acceptSignIn(response: SignInResponse, returnPath: string | null, now: number = Date.now()): string {
  if (isChallenge(response)) {
    saveChallenge({
      mode: response.twoFactor,
      challengeToken: response.challengeToken,
      expiresAt: now + Math.max(0, response.expiresInSeconds) * 1000,
      returnPath,
    })
    return TWO_FACTOR_PATH
  }
  clearChallenge()
  setToken(response.token)
  return returnPath ?? resolveInitialRoute()
}

export interface TwoFactorVerifyResponse {
  token: string
  /** A number only when a recovery code was spent; otherwise null. */
  recoveryCodesRemaining: number | null
}

export interface TwoFactorEnrollmentKey {
  secret: string
  otpauthUri: string
}

export interface TwoFactorEnrollmentResult {
  token: string
  recoveryCodes: string[]
}

async function postAnonymous<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: unknown } | null
    const message = typeof payload?.message === 'string' ? payload.message : ''
    throw new AuthRequestError(response.status, message)
  }
  return response.json() as Promise<T>
}

/** `POST /auth/two-factor/verify` — an authenticator code, or a recovery code. 401 on a wrong code. */
export function verifyTwoFactor(baseUrl: string, challengeToken: string, code: string): Promise<TwoFactorVerifyResponse> {
  return postAnonymous(`${baseUrl}/auth/two-factor/verify`, { challengeToken, code })
}

/** `POST /auth/two-factor/enrollment/start` — an "enroll" challenge only. */
export function startEnrollment(baseUrl: string, challengeToken: string): Promise<TwoFactorEnrollmentKey> {
  return postAnonymous(`${baseUrl}/auth/two-factor/enrollment/start`, { challengeToken })
}

/** `POST /auth/two-factor/enrollment/confirm` — answers the session AND the ten recovery codes. */
export function confirmEnrollment(baseUrl: string, challengeToken: string, code: string): Promise<TwoFactorEnrollmentResult> {
  return postAnonymous(`${baseUrl}/auth/two-factor/enrollment/confirm`, { challengeToken, code })
}

/**
 * What a reader typed, as the server compares it: an authenticator code is its digits; a
 * recovery code is case-insensitive and ignores spaces and hyphens, so both are stripped here
 * and the server's canonical `XXXXX-XXXXX` form is rebuilt.
 */
export function normaliseCode(raw: string, kind: 'totp' | 'recovery'): string {
  if (kind === 'totp') return raw.replace(/\D/g, '')
  const compact = raw.replace(/[\s-]/g, '').toUpperCase()
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact
}

/** The Base32 secret in groups of four, as an authenticator's manual-entry field reads it. */
export function groupSecret(secret: string): string {
  return (secret.replace(/\s/g, '').match(/.{1,4}/g) ?? []).join(' ')
}
