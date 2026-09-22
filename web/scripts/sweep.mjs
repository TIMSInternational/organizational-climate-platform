#!/usr/bin/env node
/**
 * Photograph EVERY route in the router, once, into one directory plus a manifest.
 *
 * `shot.mjs` photographs one route and is the instrument the mockup ruling names
 * (2026-08-18: "a mockup for this project is a branch, not an artifact... build the
 * candidate screen in the real app with real components, `npm run shot` it"). This drives
 * it across the whole application so the output is a map OF THE PRODUCT rather than a
 * drawing of it — every frame is the real shell, the real components and the real tokens.
 *
 * ## The route list is derived, never typed here
 *
 * `parseRouterPaths` reads `src/app/router.tsx` and `reachableRoutes` reads
 * `src/navigation/roleCapabilities.ts`, which are the same two sources `e2e.mjs` derives
 * its matrix from. A second hand-written list of routes is exactly the thing that rots:
 * the router gained `/microclimate-invitations/:token` once and the harness that kept its
 * own copy exited before it launched a browser. Add a route to the router and it appears
 * here on the next run, with no edit to this file.
 *
 * ## One dev server, N browsers
 *
 * `shot.mjs` starts its own vite unless given `--server`, and a cold vite is about five
 * seconds. Paying that sixty times is five minutes of nothing; this starts one server with
 * the origin the fixture layer expects and hands every shot the same URL.
 *
 * ## What a missing fixture means here, and why it is not an error
 *
 * Any endpoint with no fixture is answered 404 by `shot.mjs`, and since 2026-09-21 the
 * screens render that as ABSENCE — a dash, an empty state, a notice naming the region —
 * rather than substituting sample data. So a route with thin fixtures still photographs
 * something true about the product. The manifest records which endpoints 404'd per route
 * so a thin frame can be read as "not fixtured" rather than "broken".
 *
 * Usage:
 *   node scripts/sweep.mjs --out .sweep [--theme light|dark] [--lang es|en] [--only <substr>]
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fillParams, parseRouterPaths } from './e2e-harness.mjs'
import { choosePort, waitForServer } from './shot-harness.mjs'
import { PLATFORM_ROLES, reachableRoutes } from '../src/navigation/roleCapabilities.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '.sweep' },
    theme: { type: 'string', default: 'light' },
    lang: { type: 'string', default: 'es' },
    only: { type: 'string' },
    port: { type: 'string', default: 'auto' },
  },
})

/**
 * Which role each route is photographed as.
 *
 * A route reachable by several roles is shot as the FIRST of these that can reach it, and
 * the order is the one the product is designed around: the company administrator is the
 * primary audience of the admin surfaces, the super admin owns only what nobody else can
 * see, and the three team roles own the screens named for them. Shooting `/dashboard` as
 * an employee would photograph a real screen that is not the one anybody means by it.
 */
const ROLE_ORDER = ['company_admin', 'super_admin', 'leader', 'supervisor', 'employee']

/**
 * Routes reached without a session. Taken from `e2e.mjs`'s own list, which is checked
 * against the router by `deriveMatrix` on every e2e run, so it cannot silently rot.
 */
const ANONYMOUS = new Set([
  '/',
  '/login',
  '/register',
  '/auth/error',
  '/auth/inactive',
  '/auth/loading',
  '/auth/success',
  '/accept-invitation/:token',
  '/survey/:id',
  '/s/:token',
  '/survey-invitations/:token',
  '/microclimate-invitations/:token',
  '/shared/reports/:token',
  '/microclimates/:id/respond',
])

/**
 * Stand-ins for `:params`.
 *
 * `default.json` matches a path segment with `*` (`GET /admin/companies/*`), so a made-up
 * id still resolves against it and the screen photographs populated. Where a fixture keys
 * a concrete id, that id is used instead so the row and its detail agree.
 */
const IDS = {
  id: 'sv-q3',
  companyId: '11111111-1111-1111-1111-111111111111',
  surveyId: 'sv-q3',
  token: 'demo-token',
}

/** A per-route fixture, when one paints the screen better than the shared default. */
const FIXTURES = {
  '/dashboard': 'default.json',
  '/departments': 'org-structure.json',
  '/surveys': 'admin-authoring.json',
  '/surveys/templates': 'admin-authoring.json',
  '/microclimates': 'microclimates-meridiano.json',
  '/admin/companies': 'default.json',
}

function roleFor(route) {
  if (ANONYMOUS.has(route)) return null
  for (const role of ROLE_ORDER) {
    if (!PLATFORM_ROLES.includes(role)) continue
    // Tracking is a separate deployment; asking for it here is what makes its routes
    // reachable at all, and the nav hides them when no tracking service is configured.
    if (reachableRoutes(role, true).has(route)) return role
  }
  return 'company_admin'
}

function slugFor(route) {
  const slug = route.replace(/^\//, '').replace(/[/:]+/g, '-').replace(/-+$/, '')
  return slug === '' ? 'root' : slug
}

async function main() {
  const router = await readFile(join(WEB, 'src/app/router.tsx'), 'utf8')
  const routes = parseRouterPaths(router)
    .filter((route) => !route.startsWith('/dev/'))
    .filter((route) => (values.only ? route.includes(values.only) : true))
    .sort()

  const outDir = resolve(WEB, values.out)
  await mkdir(outDir, { recursive: true })

  const port = await choosePort(values.port)
  const origin = `http://127.0.0.1:${port}`
  console.log(`sweep: ${routes.length} routes, ${values.theme}, ${values.lang}`)

  const vite = spawn(
    'npx',
    ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: WEB, env: { ...process.env, VITE_API_BASE_URL: 'http://api.shot.invalid' }, stdio: 'ignore' },
  )
  const results = []
  try {
    await waitForServer(origin, { timeoutMs: 60_000 })

    for (const [index, route] of routes.entries()) {
      const filled = fillParams(route, IDS)
      const slug = slugFor(route)
      const file = join(outDir, `${slug}.png`)
      const role = roleFor(route)
      const fixture = FIXTURES[route] ?? 'default.json'

      if (filled === null) {
        results.push({ route, slug, ok: false, skipped: 'no id for a parameter' })
        continue
      }

      const args = [
        'scripts/shot.mjs',
        filled,
        file,
        '--server', origin,
        '--theme', values.theme,
        '--lang', values.lang,
        '--fixtures', join('scripts/shot-fixtures', fixture),
      ]
      if (role) args.push('--role', role)

      const started = Date.now()
      const { code, output } = await run('node', args)
      const unfixtured = [...output.matchAll(/^\s+(GET|POST|PUT|DELETE) (\/\S*)$/gm)].map((m) => `${m[1]} ${m[2]}`)
      results.push({
        route,
        filled,
        slug,
        role: role ?? 'anonymous',
        fixture,
        file: `${slug}.png`,
        ok: code === 0,
        ms: Date.now() - started,
        unfixtured,
        error: code === 0 ? null : output.trim().split('\n').slice(-3).join(' | '),
      })
      const mark = code === 0 ? 'ok  ' : 'FAIL'
      console.log(`sweep: ${mark} [${index + 1}/${routes.length}] ${filled}`)
    }
  } finally {
    vite.kill()
  }

  const manifest = {
    takenAt: new Date().toISOString(),
    theme: values.theme,
    lang: values.lang,
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    results,
  }
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`sweep: ${manifest.ok}/${manifest.total} into ${outDir}`)
  process.exitCode = manifest.ok === manifest.total ? 0 : 1
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: WEB })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('close', (code) => resolvePromise({ code, output }))
  })
}

await main()
