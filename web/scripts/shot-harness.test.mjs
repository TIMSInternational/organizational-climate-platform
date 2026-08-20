import { describe, it, expect, beforeEach } from 'vitest'
import {
  API_ORIGIN,
  STORAGE_KEYS,
  buildDevToken,
  choosePort,
  parseViteOrigin,
  stripAnsi,
  classifyRequest,
  compileFixtures,
  matchFixture,
  waitForServer,
  nextViewportHeight,
  SCROLL_TOLERANCE,
} from './shot-harness.mjs'
import { createServer } from 'node:net'
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

/**
 * The harness could produce exactly two outcomes before this: 200 for a matched fixture
 * and 404 for everything else. Every error state below the 404 was therefore
 * unphotographable — including the pair this repository cares most about getting right,
 * a revoked survey invitation and an expired one, which share a 410 and differ only in
 * the body.
 */
describe('shot harness: fixture statuses', () => {
  const fixtures = compileFixtures({
    'GET /admin/companies': { companies: [] },
    'GET /survey-invitations/*': { message: 'gone', reason: 'revoked' },
    'GET /survey-links/* 404': { message: 'This link is not valid.' },
    'POST /survey-invitations/*/opened 429': { message: 'slow down' },
  })

  it('defaults to 200, so every fixture written before this keeps its meaning', () => {
    expect(matchFixture(fixtures, 'GET', '/admin/companies').status).toBe(200)
    expect(matchFixture(fixtures, 'GET', '/survey-invitations/abc').status).toBe(200)
  })

  it('reads a trailing integer in the key as the status', () => {
    expect(matchFixture(fixtures, 'GET', '/survey-links/abc').status).toBe(404)
    expect(matchFixture(fixtures, 'POST', '/survey-invitations/abc/opened').status).toBe(429)
  })

  it('does not fold the status into the path it matches', () => {
    // The obvious bug in a whitespace-split parser is taking the path as everything
    // after the method, so `"/survey-links/* 404"` becomes the pattern and the fixture
    // matches nothing a browser would ever request.
    expect(matchFixture(fixtures, 'GET', '/survey-links/abc')).not.toBeNull()
    expect(matchFixture(compileFixtures({ 'GET /x 404': {} }), 'GET', '/x')).not.toBeNull()
  })

  /**
   * A typo in that position must fail the run rather than quietly photograph a 200 —
   * a screenshot of the wrong state is worse than no screenshot, because it is evidence.
   */
  it('refuses a third token that is not an HTTP status', () => {
    expect(() => compileFixtures({ 'GET /x maybe': {} })).toThrow(/not an HTTP status/)
    expect(() => compileFixtures({ 'GET /x 99': {} })).toThrow(/not an HTTP status/)
    expect(() => compileFixtures({ 'GET /x 600': {} })).toThrow(/not an HTTP status/)
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

/**
 * The defect these two describes exist for.
 *
 * `--strictPort` was believed to make a busy port an error. It makes it an error *for
 * vite*, which exits — and the poll that followed accepted any listener on that port,
 * so the browser attached to whatever was already there. Screenshotting two worktrees
 * of this repository at once on the shared default port produced a PNG of the other
 * one's code, with nothing in the output saying so: the harness printed "dev server
 * started" as usual.
 *
 * That matters more than a wrong image. "Render it and look at it" is the primary
 * evidence standard on this project, so a harness that can photograph the wrong
 * application can launder a stale or foreign screen into a verification report.
 */
describe('shot harness: the port is proved free before vite is started', () => {
  /** Binds a port the way another lane's dev server would. */
  function occupy() {
    return new Promise((resolve) => {
      const server = createServer()
      server.listen(0, '127.0.0.1', () =>
        resolve({
          port: server.address().port,
          release: () => new Promise((done) => server.close(done)),
        }),
      )
    })
  }

  it('takes a free port from the OS by default', async () => {
    const port = await choosePort('auto')
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThan(0)
  })

  it('refuses a port something else is already listening on', async () => {
    const taken = await occupy()
    try {
      await expect(choosePort(String(taken.port))).rejects.toThrow(/already in use/)
    } finally {
      await taken.release()
    }
  })

  it('accepts a named port that is genuinely free', async () => {
    // The counterpart to the test above: a guard that rejects everything is not a
    // guard. The port is free precisely because it has just been released.
    const taken = await occupy()
    const { port } = taken
    await taken.release()
    expect(await choosePort(String(port))).toBe(port)
  })

  it('rejects a port that is not a port', async () => {
    await expect(choosePort('5199x')).rejects.toThrow(/must be "auto" or a port number/)
    await expect(choosePort('70000')).rejects.toThrow(/must be "auto" or a port number/)
  })
})

describe('shot harness: waiting for the server watches the server', () => {
  const answers = async () => ({ status: 200 })
  const noSleep = async () => {}

  it('resolves when the server this harness started answers', async () => {
    await expect(
      waitForServer('http://127.0.0.1:1/', { fetchImpl: answers, sleep: noSleep }),
    ).resolves.toBeUndefined()
  })

  it('refuses to accept an answer once the spawned server has died', async () => {
    // The exact laundering path: vite exits on EADDRINUSE, the foreign process on
    // that port answers 200, and the old poll returned happily.
    await expect(
      waitForServer('http://127.0.0.1:1/', {
        fetchImpl: answers,
        deadReason: () => 'exited with code 1',
        sleep: noSleep,
      }),
    ).rejects.toThrow(/not this working tree/)
  })

  it('says that something else answered, because that is the confusing case', async () => {
    await expect(
      waitForServer('http://127.0.0.1:1/', {
        fetchImpl: answers,
        deadReason: () => 'exited with code 1',
        sleep: noSleep,
      }),
    ).rejects.toThrow(/something else answered on that port/)
  })

  it('gives up rather than hanging when nothing ever answers', async () => {
    await expect(
      waitForServer('http://127.0.0.1:1/', {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED')
        },
        attempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/never answered/)
  })

  it('keeps polling while the server is still starting up', async () => {
    // Guard the guard: if the liveness check were wired to reject on a *live*
    // child, every test above would still pass and the harness would never start.
    let calls = 0
    const slowStart = async () => {
      calls += 1
      if (calls < 3) throw new Error('ECONNREFUSED')
      return { status: 200 }
    }
    await expect(
      waitForServer('http://127.0.0.1:1/', {
        fetchImpl: slowStart,
        deadReason: () => null,
        sleep: noSleep,
      }),
    ).resolves.toBeUndefined()
    expect(calls).toBe(3)
  })
})

describe('parseViteOrigin', () => {
  /**
   * `choosePort` makes a collision unlikely; this makes a wrong screenshot impossible.
   * The two are not the same guarantee — a port proved free is released before vite
   * binds it, and that gap is where a concurrent run can steal it.
   */
  it('reads the port vite reports', () => {
    expect(parseViteOrigin('  ➜  Local:   http://127.0.0.1:5200/')).toBe('http://127.0.0.1:5200')
  })

  it('survives the ANSI escapes vite puts INSIDE the URL', () => {
    // The shape that actually broke a first attempt at this: vite bolds the port, so
    // the digits do not follow the colon and a naive `:(\d+)` finds nothing. The
    // symptom was "no URL printed" against a server that had printed one.
    const real =
      '\n  \u001b[32m\u001b[1mVITE\u001b[22m v8.2.0\u001b[39m ready\n\n' +
      '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   ' +
      '\u001b[36mhttp://127.0.0.1:\u001b[1m5411\u001b[22m/\u001b[39m\n'
    expect(parseViteOrigin(real)).toBe('http://127.0.0.1:5411')
  })

  it('returns null on a partial banner, so a caller keeps waiting', () => {
    expect(parseViteOrigin('')).toBeNull()
    expect(parseViteOrigin('  VITE v8.2.0  ready in 407 ms')).toBeNull()
  })

  it('grows the window by exactly the hidden height', () => {
    // 900 tall showing 1320 of content: the window has to gain the missing 420.
    expect(nextViewportHeight({ innerHeight: 900, overflow: 420 })).toBe(1320)
  })

  it('stops once nothing is hidden', () => {
    expect(nextViewportHeight({ innerHeight: 1320, overflow: 0 })).toBeNull()
  })

  it('ignores sub-pixel overflow rather than looping on it', () => {
    // A container a fraction of a pixel taller than its content is not a clipped
    // screen; treating it as one is how a grow loop fails to terminate.
    expect(nextViewportHeight({ innerHeight: 900, overflow: SCROLL_TOLERANCE })).toBeNull()
    expect(nextViewportHeight({ innerHeight: 900, overflow: SCROLL_TOLERANCE + 1 })).toBe(903)
  })

  it('clamps at the cap instead of asking for an unbounded PNG', () => {
    expect(nextViewportHeight({ innerHeight: 900, overflow: 999_999, cap: 5000 })).toBe(5000)
  })

  it('gives up at the cap rather than returning it forever', () => {
    // Without this the caller loops: handed 5000 on every pass, it resizes to the same
    // height, measures the same overflow and never reaches its exit condition.
    expect(nextViewportHeight({ innerHeight: 5000, overflow: 800, cap: 5000 })).toBeNull()
  })

  it('takes the first 127.0.0.1 URL, so a later Network line cannot displace it', () => {
    expect(parseViteOrigin('Local: http://127.0.0.1:5200/\nNetwork: http://127.0.0.1:5201/'))
      .toBe('http://127.0.0.1:5200')
  })
})

describe('stripAnsi', () => {
  it('removes colour escapes and leaves the text', () => {
    expect(stripAnsi('\u001b[36mhttp://x\u001b[39m')).toBe('http://x')
    expect(stripAnsi('plain')).toBe('plain')
  })
})
