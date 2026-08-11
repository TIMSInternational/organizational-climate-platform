import { describe, it, expect, beforeEach } from 'vitest'
import {
  API_ORIGIN,
  STORAGE_KEYS,
  buildDevToken,
  classifyRequest,
  compileFixtures,
  matchFixture,
} from './shot-harness.mjs'
import { decodeJwtPayload } from '../src/auth/jwt.ts'
import { ADMIN_THEME_STORAGE_KEY } from '../src/theme/adminTheme.ts'
import { LOCALE_STORAGE_KEY } from '../src/i18n/locale.ts'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../src/company-context/companyContext.ts'
import { setToken } from '../src/auth/token.ts'

/**
 * The screenshot harness (`scripts/shot.mjs`) is the only thing in this repository
 * that looks at a rendered screen, and every way it can be wrong is silent: a key it
 * writes under the wrong name leaves the app on its own defaults, so the PNG comes out
 * signed out, in English, in the light theme — and still looks like a page.
 *
 * These tests are the part of it that can be checked without a browser. They import
 * the app's own modules for the keys and the decoder rather than restating the strings,
 * so a rename in `src/` fails here instead of quietly changing what gets screenshotted.
 *
 * Vitest picks this file up from `web/scripts/` because its default `include` covers
 * `**\/*.test.mjs` under the package root. It launches nothing.
 */

describe('shot harness: storage keys track the app', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes the theme under the key adminTheme.ts reads', () => {
    expect(STORAGE_KEYS.theme).toBe(ADMIN_THEME_STORAGE_KEY)
  })

  it('writes the locale under the key i18n/locale.ts reads', () => {
    expect(STORAGE_KEYS.locale).toBe(LOCALE_STORAGE_KEY)
  })

  it('writes the company context under the key companyContext.ts reads', () => {
    expect(STORAGE_KEYS.company).toBe(COMPANY_CONTEXT_STORAGE_KEY)
  })

  // `src/auth/token.ts` keeps its key module-private, so this asserts it behaviourally:
  // whatever name `setToken` uses is the name the harness has to write.
  it('writes the token under the key auth/token.ts writes', () => {
    setToken('a.b.c')
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBe('a.b.c')
  })
})

describe('shot harness: the dev token', () => {
  it('decodes with the app decoder and carries the claims the shell reads', () => {
    const token = buildDevToken({
      role: 'company_admin',
      companyId: '22222222-2222-2222-2222-222222222222',
      name: 'Grace Hopper',
    })

    const claims = decodeJwtPayload(token)

    expect(claims).not.toBeNull()
    expect(claims?.role).toBe('company_admin')
    expect(claims?.companyId).toBe('22222222-2222-2222-2222-222222222222')
    expect(claims?.name).toBe('Grace Hopper')
  })

  // RequireAuth redirects to /auth/inactive when `isActive` is the *string* 'false'.
  // A boolean `true` would also pass that check today, but the API emits strings, and
  // a harness that disagrees with the API about the type would be testing a shape the
  // app never sees.
  it('marks the session active as the string the API emits', () => {
    const claims = decodeJwtPayload(buildDevToken({ role: 'super_admin', companyId: 'c', name: 'n' }))
    expect(claims?.isActive).toBe('true')
    expect(claims?.isActive).not.toBe('false')
  })

  it('expires in the future', () => {
    const now = 1_700_000_000_000
    const claims = decodeJwtPayload(buildDevToken({ role: 'super_admin', companyId: 'c', name: 'n', now }))
    expect(claims?.exp).toBeGreaterThan(now / 1000)
  })

  it('has the three segments decodeJwtPayload requires', () => {
    expect(buildDevToken({ role: 'r', companyId: 'c', name: 'n' }).split('.')).toHaveLength(3)
  })
})

describe('shot harness: fixture matching', () => {
  const fixtures = compileFixtures({
    'GET /admin/companies': { companies: [] },
    'POST /admin/companies': { id: 'created' },
    '/notifications/mine': { notifications: [] },
    'GET /admin/companies/*/users': { users: [] },
    'GET /a.b': { dot: true },
  })

  it('matches method and path', () => {
    expect(matchFixture(fixtures, 'GET', '/admin/companies')).toMatchObject({
      body: { companies: [] },
    })
    expect(matchFixture(fixtures, 'POST', '/admin/companies')).toMatchObject({
      body: { id: 'created' },
    })
  })

  it('does not match a different method', () => {
    expect(matchFixture(fixtures, 'DELETE', '/admin/companies')).toBeNull()
  })

  it('reads a key with no method as GET', () => {
    expect(matchFixture(fixtures, 'GET', '/notifications/mine')).toMatchObject({
      body: { notifications: [] },
    })
    expect(matchFixture(fixtures, 'POST', '/notifications/mine')).toBeNull()
  })

  it('lets * stand for exactly one segment', () => {
    expect(matchFixture(fixtures, 'GET', '/admin/companies/abc-123/users')).not.toBeNull()
    // Two segments where the pattern has one.
    expect(matchFixture(fixtures, 'GET', '/admin/companies/abc/123/users')).toBeNull()
  })

  it('anchors both ends', () => {
    expect(matchFixture(fixtures, 'GET', '/x/admin/companies')).toBeNull()
    expect(matchFixture(fixtures, 'GET', '/admin/companies/1')).toBeNull()
  })

  it('treats a dot in the key as a literal dot', () => {
    expect(matchFixture(fixtures, 'GET', '/a.b')).not.toBeNull()
    expect(matchFixture(fixtures, 'GET', '/axb')).toBeNull()
  })

  it('returns null rather than undefined when nothing matches', () => {
    expect(matchFixture(fixtures, 'GET', '/nope')).toBeNull()
  })
})

describe('shot harness: request classification', () => {
  const app = 'http://127.0.0.1:5199'

  it('lets the dev server through', () => {
    expect(classifyRequest(`${app}/src/main.tsx`, app)).toBe('app')
    expect(classifyRequest(`${app}/admin/companies`, app)).toBe('app')
  })

  it('routes the stub API origin to the fixtures', () => {
    expect(classifyRequest(`${API_ORIGIN}/admin/companies`, app)).toBe('api')
  })

  // The reason this category exists: a dev server started with a real
  // VITE_API_BASE_URL would otherwise put live data in a screenshot.
  it('marks any other origin external', () => {
    expect(classifyRequest('http://localhost:5080/admin/companies', app)).toBe('external')
    expect(classifyRequest('https://fonts.googleapis.com/css', app)).toBe('external')
  })

  it('compares origins, not prefixes', () => {
    expect(classifyRequest('http://127.0.0.1:5200/x', app)).toBe('external')
    expect(classifyRequest('http://api.shot.invalid.example/x', app)).toBe('external')
  })

  // A data: URL's origin is the opaque string "null", so an origin-only rule would
  // abort it; a blob:'s origin is the inner one, so an origin-only rule would let it
  // through for the wrong reason. Neither is a network fetch worth policing.
  it('never aborts a non-HTTP scheme', () => {
    expect(classifyRequest('data:text/plain,x', app)).toBe('app')
    expect(classifyRequest(`blob:${app}/abc`, app)).toBe('app')
    expect(classifyRequest('blob:http://elsewhere.example/abc', app)).toBe('app')
  })
})
