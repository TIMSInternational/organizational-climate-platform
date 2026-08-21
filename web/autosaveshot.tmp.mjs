// Answer a question and WAIT OUT THE DEBOUNCE, so the save state a respondent reads is
// looked at rather than assumed. `npm run shot` renders one route and cannot interact.
// Borrows the harness's own pieces exactly like scripts/submitshot.mjs does.
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import {
  STORAGE_KEYS,
  buildDevToken,
  compileFixtures,
  matchFixture,
} from '/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/organizational-climate-platform/.claude/worktrees/wf_2224d3bf-e5e-1/web/scripts/shot-harness.mjs'

const [, , appOrigin, fixturePath, outPath, theme, mode, widthArg] = process.argv
const fixtures = compileFixtures(JSON.parse(readFileSync(fixturePath, 'utf8')))
const failSaves = mode === 'fail'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: Number(widthArg ?? 1440), height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
})

await context.addInitScript(
  ([keys, token, chosenTheme]) => {
    try {
      localStorage.setItem(keys.token, token)
      localStorage.setItem(keys.locale, 'es')
      localStorage.setItem(keys.theme, chosenTheme)
    } catch {
      /* about:blank has an opaque origin */
    }
  },
  [STORAGE_KEYS, buildDevToken({ role: 'employee', name: 'Ana Ramos' }), theme],
)

const page = await context.newPage()
const unmatched = new Set()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const APP_ORIGIN = new URL(appOrigin).origin
await context.route(
  (url) => url.origin !== APP_ORIGIN,
  async (r) => {
    const url = new URL(r.request().url())
    const method = r.request().method()
    if (method === 'POST' && url.pathname.endsWith('/responses')) {
      if (failSaves) {
        return r.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Se ha alcanzado el límite de respuestas de esta encuesta' }),
        })
      }
      return r.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          responseId: '22222222-0000-0000-0000-000000000001',
          sessionId: '9f2c1ab84e5d4f0e9b3d7c6a15e80d42',
          isComplete: false,
          isAnonymous: true,
          alreadySubmitted: false,
          language: 'es',
          answeredQuestionCount: 3,
          questionCount: 5,
          suppressedDemographics: [],
        }),
      })
    }
    const body = matchFixture(fixtures, method, url.pathname)
    if (!body) {
      unmatched.add(`${method} ${url.pathname}`)
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no fixture"}' })
    }
    return r.fulfill({
      status: body.status,
      contentType: 'application/json',
      body: JSON.stringify(body.body),
    })
  },
)

await page.goto(`${appOrigin}/surveys/s1/respond`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

// Answer the yes/no question — the first unanswered one, and the one focus landed on.
await page.getByRole('radio', { name: 'Sí' }).first().check()
// Past the 1500ms debounce, plus the round trip.
await page.waitForTimeout(2400)

const bar = page.locator('[data-slot="respond-submit-bar"]')
await bar.scrollIntoViewIfNeeded()
await page.screenshot({ path: outPath, fullPage: false })
console.log('wrote', outPath)
console.log('save state:', await page.locator('[data-slot="respond-save-state"]').allInnerTexts())
console.log('bar:', (await bar.innerText()).replace(/\n/g, ' | '))
console.log('alerts:', (await page.getByRole('alert').allInnerTexts()).join(' || ') || 'none')
console.log(unmatched.size ? `UNMATCHED: ${[...unmatched].join(' | ')}` : 'no unmatched requests')
console.log(errors.length ? `ERRORS: ${[...new Set(errors)].join(' | ')}` : 'no JS errors')
await browser.close()
