/**
 * One respondent, end to end, against the REAL API: open a public link signed out, answer
 * every question, submit, and prove the API counted it.
 *
 *   node scripts/respondent-smoke.mjs --api http://127.0.0.1:5080 --app http://localhost:5173 \
 *        --email admin@acme.test --password '…' [--locale es] [--out .respondent-smoke]
 *
 * ## Why this exists
 *
 * The respondent's path is the one thing the product asks of every employee, and nothing
 * walked it against a running backend: `shot.mjs` and `submitshot.mjs` answer every call
 * from fixtures, `flows.mjs` signs the employee in (a respondent never signs in — ruled
 * 2026-10-12), and the Vitest suite stubs `fetch`. A contract drift between the public link,
 * the respond view and the submit endpoint was invisible to all of them.
 *
 * ## What it does, in order
 *
 *   1. Signs in as a company admin (`POST /auth/login`) — the admin, never the respondent.
 *   2. Creates an anonymous, English-only survey of three likert questions through the same
 *      endpoints the UI calls (`POST /surveys`, `PUT /surveys/{id}/status`,
 *      `PUT /surveys/{id}/distribution` with `accessType: 'public'`). No departments, no
 *      demographics, no identity step — the shortest real path.
 *   3. Opens `publicLink` in a browser context with NO token, presses the landing button,
 *      answers each scale, presses Next, then Submit — by the accessible names the i18n
 *      catalogue gives them, so a copy change cannot silently break the selectors.
 *   4. Waits for `data-slot="respond-thanks"` and its title.
 *   5. Reads `GET /surveys/{id}` as the admin and requires `responseCount` to have grown by
 *      exactly one. The screen saying "thank you" is not evidence the answer was stored.
 *
 * Any console error or uncaught page error fails the run. On failure a full-page PNG is
 * written to `<out>/`.
 *
 * ## What it leaves behind
 *
 * One survey per run with one anonymous response, closed at the end (a survey with a
 * response cannot be deleted). Point it at a scratch or local database, never production:
 * it refuses an API whose `GET /version` reports `Production`.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { STORAGE_KEYS } from './shot-harness.mjs'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    app: { type: 'string', default: 'http://localhost:5173' },
    email: { type: 'string', default: 'fede.admin@acme.test' },
    password: { type: 'string', default: 'Local1234!' },
    locale: { type: 'string', default: 'es' },
    out: { type: 'string', default: '.respondent-smoke' },
    help: { type: 'boolean', default: false },
  },
})
if (values.help) {
  process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('*/')[0])
  process.exit(0)
}

const WEB_ROOT = resolve(import.meta.dirname, '..')
const API = values.api.replace(/\/$/, '')
const APP = values.app.replace(/\/$/, '')
const OUT = resolve(WEB_ROOT, values.out)
const log = (line) => process.stdout.write(`respondent-smoke: ${line}\n`)

if (values.locale !== 'en' && values.locale !== 'es') throw new Error('--locale must be en or es')
const catalogue = JSON.parse(readFileSync(resolve(WEB_ROOT, 'src/i18n', `${values.locale}.json`), 'utf8'))
const copy = (key) => {
  const value = key.split('.').reduce((node, part) => node?.[part], catalogue)
  if (typeof value !== 'string') throw new Error(`i18n key ${key} missing from ${values.locale}.json`)
  return value
}
const LABEL = {
  start: copy('surveyRespond.next.entryStart'),
  next: copy('surveyRespond.next.next'),
  submit: copy('surveyRespond.submitResponse'),
  thanks: copy('surveyRespond.thankYouTitle'),
}

async function call(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString()
const QUESTIONS = [
  'I have the tools I need to do my job well.',
  'My manager gives me useful feedback.',
  'I would recommend this organisation as a place to work.',
]

async function seedSurvey(token, companyId) {
  const survey = await call('POST', '/surveys', token, {
    title: { en: `Respondent smoke ${new Date().toISOString()}` },
    companyId,
    type: 'periodic',
    language: 'en',
    startDate: day(-1),
    endDate: day(7),
    settings: {
      anonymous: true,
      allowPartialResponses: true,
      showProgress: true,
      selfDeclaredDemographics: false,
      collectParticipantIdentity: false,
    },
    questions: QUESTIONS.map((en, order) => ({
      text: { en },
      type: 'likert',
      category: 'smoke',
      scaleMin: 1,
      scaleMax: 5,
      required: true,
      order,
    })),
  })
  await call('PUT', `/surveys/${survey.id}/status`, token, { status: 'active' })
  const distribution = await call('PUT', `/surveys/${survey.id}/distribution`, token, {
    accessType: 'public',
    accessRules: { requireLogin: false, allowAnonymous: true, singleResponse: true, activeOutsideSchedule: false },
  })
  if (!distribution?.publicLink) throw new Error('distribution minted no publicLink')
  return { id: survey.id, link: distribution.publicLink }
}

async function answerAsRespondent(link) {
  const browser = await chromium.launch()
  const errors = []
  const failedCalls = []
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    // No token is written: the respondent has none. Only the locale, so the labels the
    // script presses are the ones it read from the catalogue.
    await context.addInitScript(([key, locale]) => {
      try {
        localStorage.setItem(key, locale)
      } catch { /* about:blank */ }
    }, [STORAGE_KEYS.locale, values.locale])
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error' && !/Download the React DevTools/.test(message.text())) errors.push(message.text())
    })
    page.on('response', (response) => {
      if (response.url().startsWith(API) && response.status() >= 400) {
        failedCalls.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`)
      }
    })

    try {
      await page.goto(`${APP}${link}`, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.getByRole('button', { name: LABEL.start }).click({ timeout: 15_000 })

      for (let index = 0; index < QUESTIONS.length; index += 1) {
        const scale = page.getByRole('radiogroup').first()
        await scale.waitFor({ timeout: 15_000 })
        // The fourth of five points: any answer will do, and a fixed one keeps runs comparable.
        await scale.getByRole('radio').nth(3).click()
        const last = index === QUESTIONS.length - 1
        await page.getByRole('button', { name: last ? LABEL.submit : LABEL.next, exact: true }).click()
      }

      const thanks = page.locator('[data-slot="respond-thanks"]')
      await thanks.waitFor({ timeout: 15_000 })
      const text = (await thanks.innerText()).trim()
      if (!text.includes(LABEL.thanks)) throw new Error(`thank-you screen says "${text.slice(0, 120)}"`)
    } catch (error) {
      mkdirSync(OUT, { recursive: true })
      const file = resolve(OUT, 'failure.png')
      await page.screenshot({ path: file, fullPage: true }).catch(() => {})
      throw new Error(`${error.message.split('\n')[0]}  [screenshot ${file}]`
        + `${failedCalls.length ? `; API refusals: ${failedCalls.join(', ')}` : ''}`)
    }
    if (errors.length > 0) throw new Error(`console errors on the respond path: ${errors.slice(0, 3).join(' | ')}`)
  } finally {
    await browser.close()
  }
}

async function main() {
  const version = await call('GET', '/version')
  if (/^prod/i.test(version?.environment ?? '')) throw new Error(`refusing: ${API} reports environment ${version.environment}`)

  const { token } = await call('POST', '/auth/login', null, { email: values.email, password: values.password })
  const profile = await call('GET', '/profile', token)
  if (!profile.companyId) throw new Error(`${values.email} has no company; use a company_admin`)

  const survey = await seedSurvey(token, profile.companyId)
  log(`survey ${survey.id} active, public link ${survey.link}`)
  const before = (await call('GET', `/surveys/${survey.id}`, token)).responseCount

  let failure = null
  try {
    await answerAsRespondent(survey.link)
    log(`answered ${QUESTIONS.length} questions and reached the thank-you screen (${values.locale})`)
    const after = (await call('GET', `/surveys/${survey.id}`, token)).responseCount
    if (after !== before + 1) throw new Error(`responseCount went ${before} -> ${after}, expected +1`)
    log(`API counts the response: responseCount ${before} -> ${after}`)
  } catch (error) {
    failure = error
  }

  // Closed whatever happened, so a failed run does not leave a live public link behind.
  await call('PUT', `/surveys/${survey.id}/status`, token, { status: 'closed' }).catch((error) => {
    log(`RESIDUE LEFT: could not close ${survey.id}: ${error.message}`)
    failure ??= error
  })

  if (failure) {
    log(`FAIL ${failure.message}`)
    process.exit(1)
  }
  log('PASS')
}

await main()
