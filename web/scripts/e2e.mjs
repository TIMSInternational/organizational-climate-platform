/**
 * Drive the REAL UI against the REAL API, and write down everything that crosses the wire.
 *
 *   node scripts/e2e.mjs [--api http://127.0.0.1:5080] [--server http://localhost:5173]
 *                        [--roles company_admin,employee] [--out .e2e]
 *
 * ## Why this exists
 *
 * Nothing in this repository has ever checked that a screen works against the running
 * backend. `shot.mjs` answers every call from `scripts/shot-fixtures/*.json` and signs in
 * with an unsigned token the API would reject; 87 test files stub `fetch` and assert the
 * page against a hand-written response. Both are useful and neither can see a contract
 * drift, a 500, or a screen that renders its empty state because the request it made was
 * refused.
 *
 * ## CORS decides the port, so the port is not negotiable
 *
 * The API allows exactly one origin in Development — `http://localhost:5173`. A dev server
 * on any other port is answered with no `Access-Control-Allow-Origin` and every request
 * fails, which looks like a broken app rather than a misconfigured harness. So this runs on
 * 5173 or it does not run, and it says which when it refuses.
 *
 * ## The recording is the point
 *
 * Every request and response is appended to `<out>/journal.jsonl`. That corpus is what the
 * 29 fixture files can finally be checked against — until now they were a second,
 * unverified copy of the API contract.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { STORAGE_KEYS, waitForServer } from './shot-harness.mjs'
import {
  assertRouterShape,
  deriveMatrix,
  shapeOf,
  fillParams,
  isSignificantConsoleError,
  parseRouterPaths,
  resolveIds,
} from './e2e-harness.mjs'
import { PLATFORM_ROLES, reachableRoutes } from '../src/navigation/roleCapabilities.ts'

const WEB_ROOT = resolve(import.meta.dirname, '..')

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    tracking: { type: 'string', default: 'http://localhost:5091' },
    server: { type: 'string', default: 'http://localhost:5173' },
    roles: { type: 'string' },
    out: { type: 'string', default: '.e2e' },
    password: { type: 'string', default: 'Local1234!' },
    domain: { type: 'string', default: 'acme.test' },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('*/')[0])
  process.exit(0)
}

const API = values.api.replace(/\/$/, '')
const TRACKING = values.tracking.replace(/\/$/, '')
const ORIGIN = values.server.replace(/\/$/, '')
const OUT = resolve(WEB_ROOT, values.out)
mkdirSync(OUT, { recursive: true })
/**
 * Written to a run-scoped file and renamed into place at the end.
 *
 * The first version truncated `journal.jsonl` at startup, and then a run died on the
 * second route because the dev server had gone away — destroying the previous, good
 * journal and leaving an empty file. The recording is the reason this harness exists;
 * a failed run must not be able to delete the last successful one.
 */
const JOURNAL = resolve(OUT, 'journal.jsonl')
const JOURNAL_PARTIAL = resolve(OUT, `journal.${process.pid}.jsonl`)
writeFileSync(JOURNAL_PARTIAL, '')

/** The five local accounts from the documented dev stack. */
const ACCOUNT = {
  super_admin: 'fede.super',
  company_admin: 'fede.admin',
  leader: 'fede.leader',
  supervisor: 'fede.supervisor',
  employee: 'fede.employee',
}

/**
 * Routes that belong to no role, because they render outside the authenticated shell.
 * Declared here rather than derived: `roleCapabilities` is a map of what a SIGNED-IN user
 * may reach, and by construction says nothing about the pages reached without a token.
 *
 * `deriveMatrix` is what stops this list from silently rotting — a router path that is in
 * neither this list nor a role's capabilities fails the run.
 */
const PUBLIC_ROUTES = {
  '/': { anonymous: true },
  '/login': { anonymous: true },
  '/register': { anonymous: true },
  '/auth/error': { anonymous: true },
  '/auth/inactive': { anonymous: true },
  '/auth/loading': { anonymous: true },
  '/auth/success': { anonymous: true },
  '/accept-invitation/:token': { anonymous: true, needs: 'token' },
  '/survey/:id': { anonymous: true, needs: 'survey' },
  '/s/:token': { anonymous: true, needs: 'token' },
  '/survey-invitations/:token': { anonymous: true, needs: 'token' },
  '/shared/reports/:token': { anonymous: true, needs: 'token' },
  '/microclimates/:id/respond': { anonymous: true, needs: 'microclimate' },
  // Dev-only routes. They deliberately depend on no backend, so they are listed to satisfy
  // the matrix and skipped rather than driven.
  '/dev/chart-gallery': { skip: 'dev-only, renders hardcoded sample data' },
  '/dev/question-library': { skip: 'dev-only' },
  '/dev/storefront': { skip: 'dev-only' },
  // Reached only from a notification or an invitation, with an id this harness does not
  // mint. Listed so the matrix stays honest about what is NOT covered.
  '/tracking/tablero': {},
  '/tracking': {},
  '/tracking/planes': {},
  '/tracking/planes/:id': { needs: 'plan' },
  '/tracking/mis-tareas': {},
}

/**
 * WHAT COUNTS AS BROKEN — and why it is not "a request failed".
 *
 * The first version of this runner failed a route whenever any call came back non-2xx.
 * It produced six failures across five roles and every single one was wrong:
 *
 *   - a company_admin is 403'd by `GET /admin/companies/{id}`, which is SuperAdmin-only,
 *     and CompanyDetailPage keeps three independent error states precisely so "the
 *     identity tile degrades to a note rather than the page degrading to an error";
 *   - a leader is 403'd by both tracking pickers, and PlanesAccionListPage calls that
 *     lookup "deliberately silent... blanking the listing over that would take the whole
 *     page down for the role the page most exists for";
 *   - two surveys answered 400/404 because the row happened to be CLOSED and to have no
 *     distribution — a state of the data, not of the code.
 *
 * A report whose every entry is a false positive is worse than no report: it teaches its
 * reader to skim. And the fix is not a whitelist — a whitelist would have hidden those
 * four AND anything that broke behind them.
 *
 * So the verdict is the OUTCOME on the screen, which is the thing anyone actually cares
 * about, and the app already states it: `ErrorState` renders `data-slot="error-state"`
 * with `role="alert"`, while an EmptyState of the same component uses `role="status"`
 * because "an empty list is not an error". That distinction is the app's own, not this
 * harness's guess.
 *
 * HTTP is still recorded in full — it is the corpus the 29 fixture files get checked
 * against — and 5xx is still surfaced, because a server error is worth knowing about even
 * when a screen swallows it gracefully.
 */
const BROKEN = 'a visible error state, a console error, or a page that would not load'

const log = (line) => process.stdout.write(`${line}\n`)
const record = (entry) => appendFileSync(JOURNAL_PARTIAL, `${JSON.stringify(entry)}\n`)

async function login(role) {
  const email = `${ACCOUNT[role]}@${values.domain}`
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: values.password }),
  })
  if (!response.ok) throw new Error(`login failed for ${email}: ${response.status}`)
  const { token } = await response.json()
  const profile = await (await fetch(`${API}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()
  return { token, profile }
}

/**
 * Real ids from the real API, so a route with a parameter is driven against a row that
 * exists. Anything not found stays undefined and `fillParams` turns the route into a SKIP
 * — never a navigation to a literal ':id'.
 */
async function discoverIds(token, companyId) {
  const get = async (path, origin = API) => {
    try {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }
  const first = (payload, key) => {
    const list = Array.isArray(payload) ? payload : payload?.[key]
    return Array.isArray(list) && list.length > 0 ? list[0].id : undefined
  }

  // A super_admin carries companyId NULL to match production shape (#191), and the
  // company-scoped list endpoints all require `?companyId=`. Without this, every scoped
  // query for that role answered 400 and the run reported twelve routes SKIPPED for
  // "no id available" — which reads as a data problem and is actually the harness
  // failing to ask the question properly. Borrowing the first visible company makes the
  // super_admin's own screens drivable.
  const scope = companyId ?? first(await get('/admin/companies'), 'companies')
  const q = scope ? `?companyId=${scope}` : ''

  const [surveys, micros, plans, templates] = await Promise.all([
    get(`/surveys${q}`), get(`/microclimates${q}`), get(`/action-plans${q}`),
    get('/survey-templates'),
  ])

  // The tracking service, which lives on its own origin. `resolveIds` maps
  // `/tracking/planes/:id` to `plan`, and nothing was supplying it — so that route
  // reported SKIP "no id available" forever, which reads as missing DATA and was really
  // the harness never asking. It asks now.
  const planes = await get('/api/planes-accion', TRACKING)

  return {
    plan: first(planes, 'planes'),
    survey: first(surveys, 'surveys'),
    microclimate: first(micros, 'microclimates'),
    actionPlan: first(plans, 'actionPlans'),
    template: first(templates, 'templates'),
    company: scope,
    companyId: scope,
    surveyId: first(surveys, 'surveys'),
  }
}

async function main() {
  const routerSource = readFileSync(resolve(WEB_ROOT, 'src/app/router.tsx'), 'utf8')

  const shape = assertRouterShape(routerSource)
  if (shape.length > 0) {
    for (const problem of shape) log(`e2e: FATAL ${problem}`)
    process.exit(2)
  }

  const routerPaths = parseRouterPaths(routerSource)

  // Coverage is the union of what the app's OWN capability map says each role can reach,
  // plus the unauthenticated routes above. Using roleCapabilities rather than a table of
  // this harness's own means the two cannot drift apart.
  const coverage = { ...PUBLIC_ROUTES }
  for (const role of PLATFORM_ROLES) {
    for (const route of reachableRoutes(role, true)) coverage[route] ??= {}
  }

  const matrix = deriveMatrix(routerPaths, coverage)
  log(`e2e: ${routerPaths.length} routes in router.tsx, ${matrix.covered.length} covered`)
  if (matrix.unknown.length > 0) log(`e2e: stale coverage entries: ${matrix.unknown.join(', ')}`)
  if (matrix.missing.length > 0) {
    log(`e2e: FATAL ${matrix.missing.length} route(s) in the router that nothing covers:`)
    for (const path of matrix.missing) log(`e2e:   ${path}`)
    log('e2e: add them to PUBLIC_ROUTES or to src/navigation/roleCapabilities.ts.')
    process.exit(2)
  }

  await waitForServer(ORIGIN).catch(() => {
    log(`e2e: FATAL no dev server at ${ORIGIN}.`)
    log('e2e: start one with: npm run dev -- --port 5173 --strictPort')
    log('e2e: the port is not negotiable — the API allows only http://localhost:5173.')
    process.exit(2)
  })

  const roles = values.roles ? values.roles.split(',') : [...PLATFORM_ROLES]
  const browser = await chromium.launch()
  const results = []

  for (const role of roles) {
    const { token, profile } = await login(role)
    const ids = await discoverIds(token, profile.companyId)
    const routes = [...reachableRoutes(role, true)]
    log(`\ne2e: ${role} — ${routes.length} reachable routes (company ${profile.companyId ?? 'none'})`)

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(
      ([keys, tokenValue, companyId]) => {
        try {
          localStorage.setItem(keys.token, tokenValue)
          if (companyId) localStorage.setItem(keys.company, companyId)
        } catch { /* opaque origin on about:blank */ }
      },
      [STORAGE_KEYS, token, profile.companyId ?? ''],
    )

    for (const route of routes) {
      const target = fillParams(route, resolveIds(route, ids))
      if (target === null) {
        results.push({ role, route, status: 'SKIP', reason: 'no id available' })
        continue
      }

      const page = await context.newPage()
      const consoleErrors = []
      const apiCalls = []
      const bodies = []

      page.on('console', (message) => {
        if (message.type() === 'error' && isSignificantConsoleError(message.text())) {
          consoleErrors.push(message.text())
        }
      })
      page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
      // BOTH services, and the second one was the point. An earlier version of this
      // listener recorded only the climate API, so every call the tracking module makes
      // to :5091 — the whole Procomer surface, and the one on the client's critical
      // path — crossed the wire unrecorded. The run still went green for those routes,
      // which is exactly the shape of failure this harness was built to stop.
      page.on('response', (response) => {
        const url = response.url()
        if (!url.startsWith(API) && !url.startsWith(TRACKING)) return
        const path = new URL(url).pathname
        const call = { method: response.request().method(), path, status: response.status() }
        apiCalls.push(call)
        // The SHAPE of the body, not the body. Comparing fixtures against reality needs
        // the key structure and nothing else, and a shape carries no names, no emails and
        // no free text — so the journal can be read, shared and diffed without handling
        // anybody's answers. `bodies` is awaited before the page closes, because a
        // response body is not readable after that.
        bodies.push(
          response.json().then(
            (json) => { call.shape = shapeOf(json) },
            () => {},
          ),
        )
      })

      try {
        await page.goto(`${ORIGIN}${target}`, { waitUntil: 'networkidle', timeout: 20000 })
      } catch (error) {
        results.push({ role, route, target, status: 'NAV-FAIL', reason: error.message.split('\n')[0] })
        await page.close()
        continue
      }

      await Promise.allSettled(bodies)

      // The app's own verdict on itself. `role="alert"` is an error; `role="status"` on
      // the same component is an empty state, which is not one.
      const errorStates = await page.$$eval(
        '[data-slot="error-state"][role="alert"]',
        (nodes) => nodes.map((node) => node.textContent?.trim().slice(0, 200) ?? ''),
      ).catch(() => [])

      const serverErrors = apiCalls.filter((call) => call.status >= 500)
      const refusals = apiCalls.filter((call) => call.status >= 400 && call.status < 500)
      const broken = errorStates.length > 0 || consoleErrors.length > 0
      const status = broken ? 'FAIL' : serverErrors.length > 0 ? 'WARN' : 'PASS'

      results.push({ role, route, target, status, apiCalls, consoleErrors, errorStates, serverErrors, refusals })
      record({ role, route, target, apiCalls, consoleErrors, errorStates })
      await page.close()
    }

    await context.close()
  }

  await browser.close()

  // ---- report ----
  const fails = results.filter((r) => r.status === 'FAIL' || r.status === 'NAV-FAIL')
  const warns = results.filter((r) => r.status === 'WARN')
  const skips = results.filter((r) => r.status === 'SKIP')
  const passes = results.filter((r) => r.status === 'PASS')
  log(`\ne2e: ${results.length} route visits — ${passes.length} pass, ${warns.length} warn, ${fails.length} broken, ${skips.length} skipped`)
  log(`e2e: broken means ${BROKEN}.`)

  for (const fail of fails) {
    log(`\ne2e: BROKEN ${fail.role} ${fail.route}`)
    if (fail.reason) log(`e2e:   ${fail.reason}`)
    for (const state of (fail.errorStates ?? []).slice(0, 2)) log(`e2e:   on screen: ${state}`)
    for (const error of (fail.consoleErrors ?? []).slice(0, 3)) log(`e2e:   console: ${error.slice(0, 160)}`)
  }

  for (const warn of warns) {
    log(`\ne2e: WARN ${warn.role} ${warn.route} — screen is fine, server errored`)
    for (const call of warn.serverErrors) log(`e2e:   ${call.status} ${call.method} ${call.path}`)
  }

  // Refusals are reported once, in aggregate. Individually they are noise; as a set they
  // are a map of where the client's capability table and the API's rules disagree.
  const refusals = new Map()
  for (const result of results) {
    for (const call of result.refusals ?? []) {
      const key = `${call.status} ${call.method} ${call.path.replace(/[0-9a-f-]{36}/gi, '{id}')}`
      refusals.set(key, (refusals.get(key) ?? new Set()).add(result.role))
    }
  }
  if (refusals.size > 0) {
    log(`\ne2e: 4xx observed on screens that handled them (${refusals.size} distinct):`)
    for (const [key, roles] of [...refusals].sort()) log(`e2e:   ${key}  <- ${[...roles].join(', ')}`)
  }

  if (skips.length > 0) {
    log(`\ne2e: skipped (no id to drive them with): ${[...new Set(skips.map((s) => s.route))].join(', ')}`)
  }

  renameSync(JOURNAL_PARTIAL, JOURNAL)
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(results, null, 2))
  log(`\ne2e: journal -> ${JOURNAL}`)
  log(`e2e: summary -> ${resolve(OUT, 'summary.json')}`)
  process.exit(fails.length > 0 ? 1 : 0)
}

await main()
