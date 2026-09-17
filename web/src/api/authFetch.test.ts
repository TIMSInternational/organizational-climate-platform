import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { authFetch, ApiError } from './authFetch'
import { setToken, clearToken } from '../auth/token'
import { LOCALE_STORAGE_KEY } from '../i18n/locale'

/**
 * The transport half of the contract: what a caller is told when the request never
 * completed, versus when the server answered and said something.
 *
 * Sixty-two catch blocks in this app render `err.message` straight to the user, so this
 * one string is the difference between a sentence somebody can act on and the browser
 * talking to itself. It was photographed talking to itself on /tracking/mis-tareas for
 * all five roles.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken('header.eyJzdWIiOiJ1MSJ9.signature')
})

afterEach(() => {
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('authFetch, when the request never completes', () => {
  function unreachable() {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
  }

  it('does not hand the browser\'s own words to the caller', async () => {
    unreachable()
    await expect(authFetch('/x')).rejects.toThrow(/Network error/)
    await expect(authFetch('/x')).rejects.not.toThrow(/Failed to fetch/)
  })

  it('answers in the reader\'s language', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    unreachable()
    await expect(authFetch('/x')).rejects.toThrow(/Error de red/)
  })


  // CommandPalette aborts the in-flight search on every keystroke, so this branch runs
  // constantly and on purpose. An abort is not a connection problem.
  it('rethrows an abort untouched rather than calling it a network error', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    vi.mocked(fetch).mockRejectedValue(abort)
    const error = await authFetch('/x').catch((err) => err)
    expect(error).toBe(abort)
    expect((error as Error).message).not.toMatch(/Network error/)
  })
  // A separate guarantee, and separately losable: rewriting the message must not
  // discard the only record of what actually happened.
  it('keeps the original failure as `cause`', async () => {
    unreachable()
    const error = await authFetch('/x').catch((err) => err)
    expect((error as Error).cause).toBeInstanceOf(TypeError)
    expect(((error as Error).cause as Error).message).toBe('Failed to fetch')
  })
})

describe('authFetch, when the server answered', () => {
  // The server's message is the whole answer here. Replacing it with a generic would be
  // a downgrade, so this arm must stay untouched by the rewrite above.
  it('passes a server-authored message through unchanged', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This survey has no distribution configured yet.' }), { status: 404 }),
    )
    await expect(authFetch('/x')).rejects.toThrow('This survey has no distribution configured yet.')
  })

  it('falls back to the status when the body carries no message', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 403 }))
    await expect(authFetch('/x')).rejects.toThrow('Request failed: 403')
  })

  it('returns the response untouched on success', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    const response = await authFetch('/x')
    expect(response.status).toBe(200)
  })

  /**
   * The status has to survive as a FIELD, not as text in the sentence.
   *
   * Everything above asserts the message, and the message alone is what eight tracking
   * screens had to work from — so a 403 the service answered instantly was rendered as
   * "el módulo de seguimiento no respondió … vuelva a intentarlo en unos minutos", and
   * `scripts/e2e.mjs` reported those routes broken. A caller can now ask.
   */
  it('carries the status on the thrown error, whatever the message says', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"message":"Nope"}', { status: 403 }))
    const error = await authFetch('/x').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
    // Still an Error carrying the server's own words, so the ~178 call sites that read
    // `err.message` are untouched by this.
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Nope')
  })

  it('does not dress a transport failure as an answered status', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await authFetch('/x').catch((err: unknown) => err)

    // No response existed, so there is no status to carry and nothing may invent one.
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
  })
})
