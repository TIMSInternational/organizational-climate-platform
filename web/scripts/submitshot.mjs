// Actually ANSWER a survey and press submit, so the confirmation screen is LOOKED AT
// rather than assumed. Unit tests cover it; nobody had rendered it.
//
// `npm run shot` renders one route and cannot interact, so this borrows the harness's own
// pieces — buildDevToken, STORAGE_KEYS, compileFixtures, matchFixture — instead of
// reimplementing them. Reimplementing the token was the first attempt and it failed exactly
// as it should have: /surveys/:id/respond sits behind RequireAuth, so a script with no token
// is looking at the login page while it waits for a submit button.
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import {
  STORAGE_KEYS,
  buildDevToken,
  compileFixtures,
  matchFixture,
} from './shot-harness.mjs'

const [, , appOrigin, route, fixturePath, outPath] = process.argv
const fixtures = compileFixtures(JSON.parse(readFileSync(fixturePath, 'utf8')))

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
})

await context.addInitScript(
  ([keys, token]) => {
    try {
      localStorage.setItem(keys.token, token)
      localStorage.setItem(keys.locale, 'es')
    } catch {
      /* about:blank has an opaque origin; the real navigation runs this again */
    }
  },
  [STORAGE_KEYS, buildDevToken({ role: 'employee', name: 'Ana Ramos' })],
)

const page = await context.newPage()
const unmatched = new Set()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

// NOT `url.origin === API_ORIGIN`: that constant is the invalid host the harness points
// ITS OWN vite at. This drives the dev server already running on :5173, whose
// VITE_API_BASE_URL is the real API — so intercept everything that is not the app itself,
// which also guarantees no live data reaches the screenshot.
const APP_ORIGIN = new URL(appOrigin).origin
await context.route(
  (url) => url.origin !== APP_ORIGIN,
  async (r) => {
    const url = new URL(r.request().url())
    const body = matchFixture(fixtures, r.request().method(), url.pathname)
    if (!body) {
      unmatched.add(`${r.request().method()} ${url.pathname}`)
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no fixture"}' })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.body) })
  },
)

await page.goto(appOrigin + route, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
console.log('landed on:', new URL(page.url()).pathname)

// Answer every scale question by clicking a middle segment, and every native radio group.
for (const g of await page.locator('[role="radiogroup"]').all()) {
  const opts = await g.locator('[role="radio"]').all()
  if (opts.length) await opts[Math.floor(opts.length / 2)].click()
}
for (const fs of await page.locator('fieldset').all()) {
  const natives = await fs.locator('input[type="radio"]').all()
  if (natives.length) await natives[0].check().catch(() => {})
}
await page.waitForTimeout(400)

const submit = page.getByRole('button', { name: /enviar mis respuestas|submit my answers/i }).first()
await submit.click()
await page.waitForTimeout(1800)

await page.screenshot({ path: outPath, fullPage: true })
console.log('wrote', outPath)
console.log('headings after submit:', (await page.locator('h1, h2').allInnerTexts()).slice(0, 4).join(' | '))
console.log(unmatched.size ? `UNMATCHED: ${[...unmatched].join(' | ')}` : 'no unmatched requests')
console.log(errors.length ? `ERRORS: ${[...new Set(errors)].join(' | ')}` : 'no JS errors')
await browser.close()
