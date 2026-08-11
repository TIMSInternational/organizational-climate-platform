// @ts-check
/**
 * The pure parts of the screenshot harness, split out from `shot.mjs` so they can be
 * unit tested. `shot.mjs` starts a browser the moment it is imported; this file starts
 * nothing.
 *
 * `shot-harness.test.mjs` sits beside it and is picked up by a plain `npx vitest run`
 * (Vitest's default `include` covers `**\/*.test.mjs` and this package's root is `web/`).
 * It launches no browser and imports nothing from `playwright-core`, so it costs CI
 * milliseconds — the browser half of the harness is never run there.
 */

/**
 * The storage keys the harness writes before the app's first script runs.
 *
 * Each one is asserted against the module that owns it in `shot-harness.test.mjs`,
 * because a renamed key would not break anything loudly: the app would simply fall
 * back to its default and every screenshot would come out in the light theme, in
 * English, signed out — silently wrong rather than failed.
 */
export const STORAGE_KEYS = {
  token: 'climate_platform_token',
  theme: 'admin-theme',
  locale: 'preferredLocale',
  company: 'admin-company-context',
}

/**
 * The origin every API call is pointed at, injected as `VITE_API_BASE_URL` when the
 * harness starts the dev server. `.invalid` is reserved by RFC 2606 and can never
 * resolve, so an endpoint the fixtures forgot fails locally and loudly instead of
 * quietly reaching a real backend.
 */
export const API_ORIGIN = 'http://api.shot.invalid'

/** base64url, which is what a JWT segment is. */
function b64url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

/**
 * An unsigned token whose payload carries the claims the client reads.
 *
 * `src/auth/jwt.ts` requires exactly three dot-separated parts and only ever decodes
 * the middle one, so the third segment is filler rather than a signature — it says so
 * itself: "this deliberately does not verify the signature". `isActive` is the string
 * `'true'` and not a boolean because `RequireAuth` compares it to the string
 * `'false'`, which is what the API emits.
 *
 * The real API rejects this token. It is only ever good enough for the client-side
 * gate, and every request the page then makes is answered from a fixture.
 */
export function buildDevToken({ role, companyId, name, userId = '00000000-0000-0000-0000-000000000001', now = Date.now() }) {
  const claims = {
    sub: userId,
    name,
    email: 'shot@example.invalid',
    role,
    companyId,
    isActive: 'true',
    exp: Math.floor(now / 1000) + 60 * 60 * 24,
  }
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.unsigned-dev-token`
}

/**
 * Turns a fixture map into matchers.
 *
 * Keys are `"<METHOD> <path>"`, e.g. `"GET /admin/companies"`; a key with no space is
 * read as a GET. A `*` stands for exactly one path segment, so
 * `"GET /admin/companies/&#42;/users"` covers any id. Every other regex metacharacter in
 * the key is escaped, so a literal `.` in a path cannot match any character.
 */
export function compileFixtures(raw) {
  return Object.entries(raw).map(([key, body]) => {
    const trimmed = key.trim()
    const space = trimmed.search(/\s/)
    const method = space === -1 ? 'GET' : trimmed.slice(0, space).toUpperCase()
    const path = space === -1 ? trimmed : trimmed.slice(space).trim()
    const pattern = path
      .split('/')
      .map((segment) => (segment === '*' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    return { key, method, regex: new RegExp(`^${pattern}$`), body }
  })
}

/**
 * The first fixture whose method and path match, or `null`.
 *
 * The query string never reaches here — callers pass `new URL(...).pathname` — because
 * several endpoints append `?lang=` or `?unreadOnly=true` and a fixture should not have
 * to spell that out.
 */
export function matchFixture(fixtures, method, path) {
  const wanted = method.toUpperCase()
  return fixtures.find((fixture) => fixture.method === wanted && fixture.regex.test(path)) ?? null
}

/**
 * How a request to `url` should be handled, given the dev server's origin.
 *
 * `'app'` is the dev server itself (the HTML, the modules, the fonts) and is let
 * through untouched. `'api'` is answered from the fixtures. `'external'` is anything
 * else, which the harness aborts: with `VITE_API_BASE_URL` pointed at `API_ORIGIN`
 * there should be no third category, so one appearing means the dev server being used
 * was started with a different API base — including a real one — and letting it
 * through would put live data in a screenshot.
 *
 * Non-HTTP schemes are `'app'` rather than `'external'`, because none of them is a
 * network fetch this harness has any business second-guessing. The check is on the
 * protocol and not on the origin because the origins disagree with each other:
 * measured in Node, `new URL('data:text/plain,x').origin` is the opaque string
 * `"null"` — which would be aborted as external — while
 * `new URL('blob:http://127.0.0.1:5199/abc').origin` is `http://127.0.0.1:5199`, so
 * a `blob:` (which `src/lib/downloadTextFile.ts` creates) would have been let through
 * by accident rather than on purpose.
 */
export function classifyRequest(url, appOrigin) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'app'
  if (parsed.origin === new URL(appOrigin).origin) return 'app'
  if (parsed.origin === API_ORIGIN) return 'api'
  return 'external'
}
