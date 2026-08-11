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

import { createServer } from 'node:net'

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

/**
 * Binds `port` on the loopback interface to prove it is free, then releases it and
 * reports the port that was bound. `0` asks the OS for any free port.
 */
function probePort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', (error) => {
      reject(
        error.code === 'EADDRINUSE' || error.code === 'EACCES'
          ? new Error(
              `port ${port} is already in use. Something else is listening there — `
                + 'another worktree\'s dev server, or the previous shot\'s vite still '
                + 'shutting down — and screenshotting it would photograph a different '
                + 'application. Re-run without --port to take a free one.',
            )
          : error,
      )
    })
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      const address = probe.address()
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : port))
    })
  })
}

/**
 * The port the dev server will be started on: `'auto'` takes a free one from the OS,
 * a number is used only after being proved free.
 *
 * ## Why the default is not a fixed port any more
 *
 * `--strictPort` stops *vite* from moving to another port, and the comment in
 * `shot.mjs` used to claim that was enough. It is not: vite exits, and the poll that
 * follows accepts *any* listener on that port, so the browser attaches to whatever was
 * already there and the PNG is of another codebase. That is not hypothetical — it
 * happened on the default port 5199 while two worktrees of this repository were being
 * screenshotted at once, and the wrong PNG looked entirely plausible.
 *
 * A port claimed from the OS a moment before vite is spawned cannot collide with a
 * server that is already running, which removes the failure at its source rather than
 * detecting it afterwards. `waitForServer` still watches the child, for the case where
 * something takes the port in the gap or vite dies for an unrelated reason.
 */
export async function choosePort(requested) {
  if (requested === 'auto' || requested === undefined) return probePort(0)
  const port = Number.parseInt(requested, 10)
  if (!Number.isInteger(port) || String(port) !== String(requested).trim() || port < 1 || port > 65535) {
    throw new Error(`--port must be "auto" or a port number, got ${JSON.stringify(requested)}`)
  }
  return probePort(port)
}

/**
 * Resolves once the dev server answers — and rejects if the process that was supposed
 * to be answering has died.
 *
 * ## The check that matters
 *
 * Polling a port only establishes that *something* is listening on it. The harness
 * cares that the thing listening is the vite it just spawned, because the whole
 * evidentiary value of a screenshot is that it shows this working tree. So the caller
 * passes `deadReason`, which reports how the child exited, and every attempt — and the
 * successful one especially — is rejected if it has. Without that, a vite killed by
 * `EADDRINUSE` leaves the harness happily photographing the process that took the port.
 *
 * `fetchImpl` and `sleep` are injected so the failure can be tested without a socket
 * or a real 30 seconds.
 */
export async function waitForServer(url, options = {}) {
  const {
    fetchImpl = fetch,
    deadReason = () => null,
    attempts = 150,
    delayMs = 200,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = options

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let answered = false
    try {
      const response = await fetchImpl(url, { redirect: 'manual' })
      answered = response.status < 500
    } catch {
      // Not listening yet.
    }

    // After the fetch, not before it: the answer and the death race each other, and
    // the order that is safe to be wrong about is "assume the answer is not ours".
    const dead = deadReason()
    if (dead !== null && dead !== undefined) {
      throw new Error(
        `the dev server this harness started ${dead} before ${url} was screenshotted`
          + `${answered ? ', while something else answered on that port' : ''}. `
          + 'Whatever is listening there is not this working tree.',
      )
    }
    if (answered) return
    await sleep(delayMs)
  }
  throw new Error(`dev server never answered at ${url}`)
}
