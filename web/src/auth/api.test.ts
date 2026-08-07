import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AuthRequestError, login, signup } from './api'

const BASE = 'https://api.test'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function respond(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

describe('login', () => {
  it('returns the token on success', async () => {
    respond(200, { token: 'jwt' })
    await expect(login(BASE, 'a@b.com', 'pw')).resolves.toEqual({ token: 'jwt' })
  })

  /**
   * The regression this file exists for. `login` used to throw
   * `new Error(status === 401 ? 'Invalid email or password' : \`Login failed: ${status}\`)`,
   * which discarded the body — so the deliberate 403 kill switch and the 503
   * maintenance message (localized authored content since #195) both reached the
   * user as a status code.
   */
  it('preserves the server message and status for a 503 maintenance response', async () => {
    respond(503, { message: 'Estamos en mantenimiento hasta las 14:00.' })

    const error = await login(BASE, 'a@b.com', 'pw').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(AuthRequestError)
    expect((error as AuthRequestError).status).toBe(503)
    expect((error as Error).message).toBe('Estamos en mantenimiento hasta las 14:00.')
  })

  it('preserves the 403 disabled-login message', async () => {
    respond(403, { message: 'Login is currently disabled by an administrator.' })

    const error = await login(BASE, 'a@b.com', 'pw').catch((err: unknown) => err)

    expect((error as AuthRequestError).status).toBe(403)
    expect((error as Error).message).toBe('Login is currently disabled by an administrator.')
  })

  it('still carries the status when the body is not JSON at all', async () => {
    // A proxy's HTML 502 page. Parsing must not throw on top of the failure.
    vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }))

    const error = await login(BASE, 'a@b.com', 'pw').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(AuthRequestError)
    expect((error as AuthRequestError).status).toBe(502)
    expect((error as Error).message).toBe('')
  })
})

describe('signup', () => {
  it('posts name, email and password and returns the 201 token', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ token: 'jwt' }), { status: 201 }))

    await expect(signup(BASE, { name: 'Ana', email: 'ana@acme.com', password: 'longenough' })).resolves.toEqual({
      token: 'jwt',
    })

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`${BASE}/auth/signup`)
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Ana', email: 'ana@acme.com', password: 'longenough' })
  })

  it('carries the 404 no-company-for-domain message, which is a routing outcome and not a fault', async () => {
    respond(404, { message: 'No company found for this email domain. Please contact your administrator for an invitation.' })

    const error = await signup(BASE, { name: 'Ana', email: 'ana@nowhere.dev', password: 'longenough' }).catch(
      (err: unknown) => err,
    )

    expect((error as AuthRequestError).status).toBe(404)
    expect((error as Error).message).toContain('contact your administrator for an invitation')
  })

  it('carries the 409 duplicate-email message', async () => {
    respond(409, { message: 'User with this email already exists' })

    const error = await signup(BASE, { name: 'Ana', email: 'ana@acme.com', password: 'longenough' }).catch(
      (err: unknown) => err,
    )

    expect((error as AuthRequestError).status).toBe(409)
    expect((error as Error).message).toBe('User with this email already exists')
  })
})
