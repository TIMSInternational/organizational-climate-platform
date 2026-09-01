import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken, clearToken } from '../../../auth/token'
import {
  getMicroclimateInvitation,
  recordMicroclimateInvitationStep,
} from './microclimateLinks'

const baseUrl = 'http://api.test'

/**
 * The token is the only untrusted string this module ever interpolates into a URL, and it
 * comes straight out of `useParams()` — so it is whatever was in the address bar.
 *
 * A well-formed token is 43 base64url characters and percent-encoding leaves every one of
 * them alone, which is exactly why the guard is easy to delete and impossible to notice
 * missing. It bites on a mistyped or mangled one: a `#` truncates the path at the fragment
 * so the request goes to `/microclimate-invitations/` and the server answers about a route
 * that was never asked for, and a `/` or `?` reshapes the path into a different route
 * entirely.
 */
const MANGLED = 'abc/def?x=1#frag'

function urlOf(call: number): string {
  return String(vi.mocked(fetch).mock.calls[call][0])
}

describe('microclimateLinks URL construction', () => {
  beforeEach(() => {
    // A fresh Response per call, not a shared mockResolvedValue: one instance's body can
    // only be read once, so a shared value fails the second caller for a reason that has
    // nothing to do with the URL under test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearToken()
  })

  it('percent-encodes the token so a mangled one cannot reshape the path', async () => {
    await getMicroclimateInvitation(baseUrl, MANGLED)
    await recordMicroclimateInvitationStep(baseUrl, MANGLED, 'opened')

    expect(urlOf(0)).toBe(`${baseUrl}/microclimate-invitations/abc%2Fdef%3Fx%3D1%23frag`)
    expect(urlOf(1)).toBe(`${baseUrl}/microclimate-invitations/abc%2Fdef%3Fx%3D1%23frag/opened`)

    // The guard is a ceiling, not a mangler: an ordinary base64url token is passed through
    // character for character, so a page that works is not quietly sending a different token
    // than the one in the address bar.
    const real = 'Ab9-_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    await getMicroclimateInvitation(baseUrl, real)
    expect(urlOf(2)).toBe(`${baseUrl}/microclimate-invitations/${real}`)
  })

  it('encodes the language too, and omits the query entirely without one', async () => {
    await getMicroclimateInvitation(baseUrl, 'token', { lang: 'es&x=1' })
    await getMicroclimateInvitation(baseUrl, 'token')

    expect(urlOf(0)).toBe(`${baseUrl}/microclimate-invitations/token?lang=es%26x%3D1`)
    expect(urlOf(1)).toBe(`${baseUrl}/microclimate-invitations/token`)
  })

  /**
   * The claim the module's own header makes, asserted rather than described: the token in the
   * path IS the credential, so no bearer is attached even when one is sitting in storage.
   * An administrator checking an invitation link from the browser they administer in is the
   * routine case.
   */
  it('sends no Authorization header even when a session is stored', async () => {
    setToken('a-real-looking-jwt')
    await getMicroclimateInvitation(baseUrl, 'token')
    await recordMicroclimateInvitationStep(baseUrl, 'token', 'completed')

    for (const [, init] of vi.mocked(fetch).mock.calls) {
      const headers = new Headers((init as RequestInit | undefined)?.headers ?? {})
      expect(headers.get('Authorization')).toBeNull()
    }
  })
})
