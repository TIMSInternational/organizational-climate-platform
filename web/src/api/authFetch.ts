import { getToken, clearToken } from '../auth/token'
import { CATALOGUES, FALLBACK_LOCALE, detectLocale } from '../i18n/locale'
import { createTranslator } from '../i18n/translate'

/**
 * `errors.networkError` in the reader's language, resolved outside React.
 *
 * The key already existed in both catalogues and was wired to nothing. `detectLocale()`
 * is the same source `TranslationProvider` seeds itself from, and `setLocale` calls
 * `persistLocale`, so a mid-session language switch keeps the two in agreement rather
 * than leaving this one behind.
 */
function networkErrorMessage(): string {
  return createTranslator(CATALOGUES[detectLocale()], CATALOGUES[FALLBACK_LOCALE])('errors.networkError')
}

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

  let response: Response
  try {
    response = await fetch(url, { ...init, headers })
  } catch (cause) {
    // A TRANSPORT failure, and the browser's own words for it are not fit to show
    // anyone. `fetch` rejects with `TypeError: Failed to fetch` when the request never
    // completed — the service is stopped, DNS failed, the origin is not in the CORS
    // allow-list. Sixty-two catch blocks in this app do
    // `err instanceof Error ? err.message : …`, so those three words travelled
    // unchanged onto the screen. They were photographed doing it on
    // /tracking/mis-tareas for all five roles.
    //
    // Converted HERE rather than at the call sites for two reasons. It is the single
    // chokepoint — the tracking client goes through it too — so no site can be missed
    // and no future one has to remember. And the alternative, editing sixty-two catch
    // blocks, would have to decide at each one whether the message was worth showing,
    // when the answer only ever depends on how the request failed.
    //
    // Only this branch is rewritten. A message the SERVER authored still passes through
    // untouched below, because "This survey has no distribution configured yet" is the
    // whole answer and replacing it with a generic would be a downgrade.
    //
    // `cause` keeps the original TypeError, so nothing is lost for debugging — the
    // string stops being the only copy of what happened.
    // An ABORT is not a failure, and must not be dressed as one. `CommandPalette`
    // aborts the in-flight search on every keystroke, so this branch runs constantly
    // and on purpose; calling that "Network error. Please check your connection." would
    // be false. The palette happens to swallow it today (`.catch(() => setResults([]))`),
    // which is exactly why this is worth getting right now rather than after some later
    // caller surfaces the message and nobody can explain the flicker.
    if ((cause as { name?: string } | null)?.name === 'AbortError') {
      throw cause
    }
    throw new Error(networkErrorMessage(), { cause })
  }
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
