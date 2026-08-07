export interface LoginResponse {
  token: string
}

/**
 * A failed `/auth/*` call, carrying what the server actually said.
 *
 * ## The bug this replaces
 *
 * `login()` used to throw `new Error(status === 401 ? 'Invalid email or password'
 * : \`Login failed: ${status}\`)`. That discarded two responses that matter and
 * one that is authored content:
 *
 * - **403** `"Login is currently disabled by an administrator."` — a deliberate
 *   platform kill switch. Shown as `Login failed: 403`, it read as a bug.
 * - **503** the maintenance message, which since #195 is *localized authored
 *   content* resolved per-locale by the server (`LocalizedContent.ResolveText`).
 *   Throwing it away and substituting a status code discarded the one string on
 *   this endpoint that an administrator wrote on purpose, in the reader's
 *   language.
 * - **404** on signup, `"No company found for this email domain…"` — the whole
 *   basis of the invitation-only branch of the register page.
 *
 * The two literals it substituted were also untranslated English, which the copy
 * guard cannot see in a `.ts` module unless the variable is named like copy.
 *
 * `status` is kept alongside the message because the *page* needs it: 403 and 503
 * are conditions to route to `/auth/error`, whereas 401 is a form-level "try
 * again". A caller cannot tell those apart from a message string.
 *
 * `AuthRequestError extends Error`, rather than a result union, so every existing
 * `catch (err) { err instanceof Error ? err.message : … }` call site keeps working
 * unchanged and shows the better message for free.
 */
export class AuthRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthRequestError'
    this.status = status
  }
}

/**
 * Reads `{ message }` off an error body, falling back to a translated-at-the-caller
 * key only when the server sent nothing usable.
 *
 * Every `/auth` failure is `ErrorResponse(string Message)` → `{"message": …}`, and
 * a body that is not JSON at all (a proxy's HTML 502 page) must not turn into a
 * thrown parse error on top of the original failure.
 */
async function toRequestError(response: Response): Promise<AuthRequestError> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null
  const message = typeof body?.message === 'string' && body.message.trim() !== '' ? body.message : ''
  return new AuthRequestError(response.status, message)
}

export async function login(baseUrl: string, email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw await toRequestError(response)
  }

  return response.json() as Promise<LoginResponse>
}

export interface SignupInput {
  name: string
  email: string
  password: string
}

/**
 * `POST /auth/signup`.
 *
 * Mints a `Roles.Employee` in the company whose `EmailDomain` matches the address
 * — there is no company picker and no approval step, and that association is the
 * one thing about this endpoint a new user cannot see. `RegisterPage` says it out
 * loud rather than leaving it implicit.
 *
 * Returns the same `{ token }` as login, and **201** rather than 200.
 */
export async function signup(baseUrl: string, input: SignupInput): Promise<LoginResponse> {
  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw await toRequestError(response)
  }

  return response.json() as Promise<LoginResponse>
}
