#!/usr/bin/env node
// @ts-check
/**
 * Screenshot harness: render any route of this app in a real browser and write a PNG.
 *
 *   npm run shot -- <route> <out.png> [--theme dark] [--width 1440] [--role company_admin]
 *
 * ## Why this exists
 *
 * The Vitest suite runs on happy-dom (`vite.config.ts`), which has no layout engine:
 * a component can be positioned wrongly, overlap, or collapse to zero height with
 * every assertion in the file still green. This script is the only way in this
 * repository to look at a screen.
 *
 * ## How it reaches authenticated screens
 *
 * `src/app/RequireAuth.tsx` gates the admin routes on `getToken()` and one claim: it
 * redirects to /login when `localStorage['climate_platform_token']` is absent, and to
 * /auth/inactive when the token's `isActive` claim is the string `'false'`.
 * `src/auth/jwt.ts` decodes the payload with `atob` and deliberately does not verify
 * the signature; the shell (`AdminLayout.tsx`, `SidebarUserMenu.tsx`,
 * `company-context/companyContext.ts`) reads `role`, `companyId` and `name` from that
 * same payload.
 *
 * So the harness writes an unsigned token into localStorage before the first script
 * runs. Nothing under `web/src` changes, which is the point: a dev-only bypass inside
 * `RequireAuth` would be a branch that exists in the shipped bundle, whereas this is a
 * branch that exists only inside this browser process.
 *
 * ## Why it is invisible to CI and to production
 *
 * Nothing here is imported by `src/`. `tsconfig.app.json` includes only `src` and
 * `tsconfig.node.json` only `vite.config.ts`, so `npm run typecheck` never sees this
 * file, and `npm run build` never bundles it. The one CI cost is the `playwright-core`
 * devDependency in `npm ci` — chosen over `playwright` precisely because
 * `playwright-core` has no postinstall step and downloads no browser.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import {
  API_ORIGIN,
  STORAGE_KEYS,
  buildDevToken,
  choosePort,
  classifyRequest,
  compileFixtures,
  matchFixture,
  waitForServer,
} from './shot-harness.mjs'

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_COMPANY_ID = '11111111-1111-1111-1111-111111111111'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: 'string', default: 'light' },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
    scale: { type: 'string', default: '2' },
    role: { type: 'string', default: 'super_admin' },
    name: { type: 'string', default: 'Ada Lovelace' },
    company: { type: 'string', default: DEFAULT_COMPANY_ID },
    lang: { type: 'string', default: 'en' },
    fixtures: { type: 'string' },
    server: { type: 'string' },
    port: { type: 'string', default: 'auto' },
    settle: { type: 'string', default: '400' },
    viewport: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

const USAGE = `
Usage: npm run shot -- <route> <out.png> [options]

  <route>            app route, e.g. /dev/chart-gallery or /admin/companies
  <out.png>          file to write (parent directories are created)

Options:
  --theme <t>        light | dark            (default light)
  --width <px>       viewport width          (default 1440)
  --height <px>      viewport height         (default 900)
  --scale <n>        device pixel ratio      (default 2)
  --role <r>         role claim: super_admin | company_admin | leader |
                     supervisor | employee   (default super_admin)
  --name <n>         name claim shown in the sidebar user menu
  --company <guid>   companyId claim + stored company context
  --lang <l>         en | es                 (default en)
  --fixtures <file>  JSON map of "METHOD /path" -> response body
                     (default scripts/shot-fixtures/default.json)
  --server <url>     reuse a dev server already running at this URL instead of
                     starting one. It must have been started with
                     VITE_API_BASE_URL=${API_ORIGIN}
  --port <n>         port for the dev server this script starts. Default 'auto':
                     a free port claimed from the OS, so two worktrees
                     screenshotting at once cannot photograph each other
  --settle <ms>      extra wait after network idle (default 400)
  --viewport         clip to the viewport instead of capturing the full page
  --help             show this
`.trim()

if (values.help || positionals.length < 2) {
  process.stdout.write(`${USAGE}\n`)
  process.exit(values.help ? 0 : 1)
}

const [route, outArg] = positionals
const outPath = isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg)
const theme = values.theme
const width = Number.parseInt(values.width, 10)
const height = Number.parseInt(values.height, 10)
const scale = Number.parseFloat(values.scale)
const settleMs = Number.parseInt(values.settle, 10)

function fail(message) {
  process.stderr.write(`shot: ${message}\n`)
  process.exit(1)
}

if (theme !== 'light' && theme !== 'dark') fail(`--theme must be light or dark, got ${theme}`)
if (!Number.isFinite(width) || !Number.isFinite(height)) fail('--width and --height must be numbers')
if (!Number.isFinite(scale) || scale <= 0) fail('--scale must be a positive number')
if (!Number.isFinite(settleMs)) fail('--settle must be a number')

const fixturesPath = values.fixtures
  ? resolve(process.cwd(), values.fixtures)
  : resolve(WEB_ROOT, 'scripts', 'shot-fixtures', 'default.json')

async function loadFixtures() {
  if (!existsSync(fixturesPath)) {
    process.stdout.write(`shot: no fixture file at ${fixturesPath}; every API call will 404\n`)
    return []
  }
  return compileFixtures(JSON.parse(await readFile(fixturesPath, 'utf8')))
}

/**
 * Starts `vite` and returns `{ origin, stop }`, or reuses `--server`.
 *
 * ## Two checks, because one of them was not enough
 *
 * The port is claimed from the OS (or proved free, when one was named) *before* vite
 * is spawned, and the wait then rejects if that vite dies. `--strictPort` alone was
 * not enough and the comment here used to say it was: it stops vite from moving to
 * another port, but the vite that refuses to move simply exits, and a poll that
 * accepts any listener then hands the browser to whatever already held the port. In
 * this repository that is a plausible-looking screenshot of a *different worktree* —
 * the thing a screenshot is evidence against.
 *
 * `--server` is the caller's own dev server and is deliberately not policed this way;
 * they said which one to use. The `/undefined/` and external-origin reports at the end
 * of `main()` are what cover a wrongly-configured one.
 */
async function startServer() {
  if (values.server) {
    const origin = values.server.replace(/\/$/, '')
    await waitForServer(origin)
    process.stdout.write(`shot: reusing dev server at ${origin}\n`)
    return { origin, stop: async () => {} }
  }

  const port = await choosePort(values.port)
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(
    process.execPath,
    [
      resolve(WEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: WEB_ROOT,
      // Vite's loadEnv applies prefixed variables from process.env after the ones
      // parsed out of .env files, so this wins over any local .env.
      env: { ...process.env, VITE_API_BASE_URL: API_ORIGIN, VITE_TRACKING_API_BASE_URL: API_ORIGIN },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))

  let exit = null
  child.on('exit', (code, signal) => {
    exit = signal === null ? `exited with code ${code}` : `was killed by ${signal}`
  })

  await waitForServer(origin, { deadReason: () => exit })
  process.stdout.write(`shot: dev server started at ${origin}\n`)
  return { origin, stop: async () => void child.kill('SIGTERM') }
}

async function main() {
  const fixtures = await loadFixtures()
  const server = await startServer()
  const unmatched = new Set()
  const blocked = new Set()
  const undefinedBase = new Set()
  const consoleErrors = []

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      // Deterministic frames: every transition in this app is CSS (framer-motion is
      // banned here) and every one is required to stop under prefers-reduced-motion,
      // so this also exercises that rule.
      reducedMotion: 'reduce',
      colorScheme: theme,
    })

    await context.addInitScript(
      ([keys, token, themeValue, locale, companyId]) => {
        try {
          localStorage.setItem(keys.token, token)
          localStorage.setItem(keys.theme, themeValue)
          localStorage.setItem(keys.locale, locale)
          localStorage.setItem(keys.company, companyId)
        } catch {
          // about:blank has an opaque origin and no usable storage; the real
          // navigation that follows runs this again with a real one.
        }
      },
      [
        STORAGE_KEYS,
        buildDevToken({ role: values.role, companyId: values.company, name: values.name }),
        theme,
        values.lang,
        values.company,
      ],
    )

    // A predicate rather than a glob, because "any origin except this one" is not a
    // glob. A request that matches no registered route is continued by Playwright
    // without invoking a handler, so the hundreds of module requests the dev server
    // serves never reach the code below.
    await context.route(
      (url) => classifyRequest(url.href, server.origin) !== 'app',
      async (routeRequest) => {
        const request = routeRequest.request()
        const method = request.method().toUpperCase()
        const url = new URL(request.url())
        if (classifyRequest(url.href, server.origin) === 'external') {
          blocked.add(`${method} ${url.origin}${url.pathname}`)
          await routeRequest.abort()
          return
        }
        const match = matchFixture(fixtures, method, url.pathname)
        if (!match) {
          unmatched.add(`${method} ${url.pathname}`)
          await routeRequest.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ message: `shot: no fixture for ${method} ${url.pathname}` }),
          })
          return
        }
        await routeRequest.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(match.body),
        })
      },
    )

    const page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(String(error)))
    // `${import.meta.env.VITE_API_BASE_URL}/x` with the variable unset produces the
    // relative URL `undefined/x`, which the browser resolves against the current
    // route — from /admin/companies that is `/admin/undefined/admin/companies`, so
    // the marker is `/undefined/` anywhere in the path, not at the start. Measured
    // against a dev server started without the variable; the SPA fallback answers
    // those paths with index.html and a 200, which is the one misconfiguration that
    // would otherwise look like an empty page rather than an error.
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.includes('/undefined/')) undefinedBase.add(path)
    })

    const target = `${server.origin}${route.startsWith('/') ? route : `/${route}`}`
    await page.goto(target, { waitUntil: 'load' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(settleMs)

    const applied = await page.evaluate(() =>
      document.documentElement.getAttribute('data-admin-theme'),
    )
    if (applied !== theme) {
      throw new Error(
        `expected data-admin-theme="${theme}" on <html>, found ${JSON.stringify(applied)}`,
      )
    }

    await mkdir(dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath, fullPage: !values.viewport })
    process.stdout.write(
      `shot: wrote ${outPath} (${route}, ${theme}, ${width}x${height}@${scale}x)\n`,
    )
  } finally {
    await browser.close()
    await server.stop()
  }

  if (undefinedBase.size > 0) {
    process.stdout.write(
      'shot: VITE_API_BASE_URL was not set for this dev server -- requests went to '
        + `${[...undefinedBase].sort().join(', ')}. Drop --server, or restart it with `
        + `VITE_API_BASE_URL=${API_ORIGIN}.\n`,
    )
  }
  if (blocked.size > 0) {
    process.stdout.write(
      `shot: ${blocked.size} request(s) to an unexpected origin were aborted (see --server):\n`,
    )
    for (const call of [...blocked].sort()) process.stdout.write(`  ${call}\n`)
  }
  if (unmatched.size > 0) {
    process.stdout.write(
      `shot: ${unmatched.size} API call(s) had no fixture and were answered 404:\n`,
    )
    for (const call of [...unmatched].sort()) process.stdout.write(`  ${call}\n`)
    process.stdout.write(`shot: add them to ${fixturesPath} to render this screen with data.\n`)
  }
  if (consoleErrors.length > 0) {
    process.stdout.write(`shot: ${consoleErrors.length} console error(s):\n`)
    for (const error of consoleErrors.slice(0, 10)) process.stdout.write(`  ${error}\n`)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("Executable doesn't exist")) {
    process.stderr.write(
      'shot: chromium is not installed. Run: npx playwright-core install chromium\n',
    )
  }
  process.stderr.write(`shot: ${message}\n`)
  process.exitCode = 1
})
