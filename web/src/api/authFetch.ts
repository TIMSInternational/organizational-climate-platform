import { getToken, clearToken } from '../auth/token'

/**
 * Statuses the caller wants handed back as a `Response` instead of thrown.
 *
 * Added for the survey draft autosave (#266). `PUT /surveys/drafts/{id}` answers a
 * conflict with **409 and a body containing the draft that won** — the whole point of
 * the optimistic-concurrency token is that the loser learns what it lost to. Turning
 * that into `new Error(message)` discards the payload the endpoint went to the trouble
 * of sending, and reduces a recoverable conflict to a string.
 *
 * `401` is deliberately not overridable: it clears the token and redirects, and a caller
 * opting out of that would leave the app authenticated-looking with a dead session.
 */
export interface AuthFetchOptions {
  allowStatus?: readonly number[]
}

export async function authFetch(
  url: string,
  init: RequestInit = {},
  options: AuthFetchOptions = {},
): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    if (response.status === 401) {
      clearToken()
      window.location.href = '/login'
      throw new Error('Session expired')
    }
    if (options.allowStatus?.includes(response.status)) {
      return response
    }
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
  return response
}
