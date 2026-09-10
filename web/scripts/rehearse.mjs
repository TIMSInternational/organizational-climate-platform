/**
 * Walk `docs/runbooks/demo-script.md` on the REAL local stack, one full-page screenshot per
 * step, console errors and failed HTTP responses recorded per step. Read-only, and enforced:
 * the login `POST` is the only request this file sends with a method (it writes nothing), and
 * every browser context aborts any request that is not a GET/HEAD/OPTIONS and records it
 * against the step — the pages themselves are not read-only (the invitation page POSTs an
 * `opened` step on mount; the wizard offers to DELETE a leftover draft).
 *
 *   node scripts/rehearse.mjs                     # every step, as Grupo Meridiano, into .rehearsal/
 *   node scripts/rehearse.mjs --only 04           # one step (a case-insensitive name prefix)
 *   node scripts/rehearse.mjs --theme dark --out .rehearsal-dark
 *
 * The steps follow the runbook's numbering (01 login … 13 benchmarks), then two the runbook
 * mentions without numbering: 14 the live microclimate and its respond link opened as the
 * signed-in employee, 15 the supervisor's dashboard. Each PASSes or FAILs with a note that
 * quotes what the screen said, and `results.json` in the output directory holds all of them.
 *
 * Step 10b — actually answering a survey — is OPT-IN and is the one write: pass BOTH
 * `--answerer <local-part>` and `--answer-survey <survey id>` (a duplicated copy the caller
 * closes and archives afterwards, see the runbook's "Resetting between rehearsals"). Never
 * point it at the demo's unanswered respondent; a person answers once.
 *
 * Signs in through `POST /auth/login` and hands the token to the page — the password never
 * touches a browser field. Runs on 5173 for the same CORS reason `e2e.mjs` and `flows.mjs` do.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { STORAGE_KEYS, nextViewportHeight } from './shot-harness.mjs'
import { NAMES, allowRequest, matchesOnly, exitCode } from './rehearse-harness.mjs'

/**
 * The worst vertical overflow hidden inside any scroll container, in CSS px. Runs in the
 * browser, so no closure over this module — the same measurer `shot.mjs` uses.
 */
function worstInternalOverflow() {
  let worst = 0
  for (const el of document.querySelectorAll('*')) {
    const overflowY = getComputedStyle(el).overflowY
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue
    worst = Math.max(worst, el.scrollHeight - el.clientHeight)
  }
  return worst
}

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    server: { type: 'string', default: 'http://localhost:5173' },
    domain: { type: 'string', default: 'meridiano.test' },
    password: { type: 'string', default: 'Demo1234!' },
    admin: { type: 'string', default: 'ana.rojas' },
    // diego.solano has already answered, so nothing this account opens can spend the demo's
    // one unanswered respondent; pass --employee carlos.mata deliberately if you want his view.
    employee: { type: 'string', default: 'diego.solano' },
    answerer: { type: 'string', default: '' },
    'answer-survey': { type: 'string', default: '' },
    leader: { type: 'string', default: 'luis.mora' },
    supervisor: { type: 'string', default: 'sofia.vargas' },
    theme: { type: 'string', default: 'light' },
    only: { type: 'string', default: '' },
    out: { type: 'string', default: '.rehearsal' },
  },
})
const API = values.api.replace(/\/$/, '')
const ORIGIN = values.server.replace(/\/$/, '')
const OUT = resolve(import.meta.dirname, '..', values.out)
mkdirSync(OUT, { recursive: true })
const log = (line) => process.stdout.write(`${line}\n`)

async function login(local) {
  const email = `${local}@${values.domain}`
  const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: values.password }) })
  if (!response.ok) throw new Error(`login ${email}: ${response.status}`)
  const { token } = await response.json()
  const profile = await (await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${token}` } })).json()
  return { token, profile }
}
async function api(path, token) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return r.ok ? r.json() : null
}

const browser = await chromium.launch()
const results = []
let shot = 0

async function contextFor(who, { allowWrites = false } = {}) {
  const auth = who ? await login(who) : { token: '', profile: {} }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // The read-only guard. A blocked request is a fact about the screen, not a failure of it.
  const blocked = []
  await context.route('**/*', (route) => {
    const request = route.request()
    if (allowRequest(request.method(), { allowWrites })) return route.continue()
    blocked.push(`${request.method()} ${request.url().replace(API, '').replace(ORIGIN, '')}`)
    return route.abort()
  })
  await context.addInitScript(([keys, t, company, locale, theme]) => {
    try { if (t) localStorage.setItem(keys.token, t); localStorage.setItem(keys.locale, locale); localStorage.setItem(keys.theme, theme); if (company) localStorage.setItem(keys.company, company) } catch {}
  }, [STORAGE_KEYS, auth.token, auth.profile.companyId ?? '', 'es', values.theme])
  return { context, blocked, ...auth }
}

const go = async (page, path) => { await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 30000 }) }
const click = async (page, name, role = 'button') => { const el = page.getByRole(role, { name }).first(); await el.waitFor({ timeout: 10000 }); await el.click() }
const VIEWPORT = { width: 1440, height: 900 }
const snap = async (page, name) => {
  const file = resolve(OUT, `${String(++shot).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`)
  // Grow the window until nothing is left hidden inside a scroll container, then put it
  // back. `fullPage` alone captures exactly one viewport of an `AdminLayout` screen and
  // calls it the screen — `nextViewportHeight` in shot-harness.mjs has the history.
  let height = VIEWPORT.height
  for (let pass = 0; pass < 8; pass += 1) {
    const next = nextViewportHeight({ innerHeight: height, overflow: await page.evaluate(worstInternalOverflow) })
    if (next === null) break
    await page.setViewportSize({ width: VIEWPORT.width, height: next })
    height = next
    await page.waitForTimeout(150)
  }
  await page.screenshot({ path: file, fullPage: true })
  if (height !== VIEWPORT.height) await page.setViewportSize(VIEWPORT)
  return file
}
const mainText = async (page) => (await page.locator('main').first().innerText().catch(() => page.locator('body').innerText())).replace(/\n{2,}/g, '\n')

async function step(name, who, run, { allowWrites = false } = {}) {
  if (!matchesOnly(name, values.only)) { log(`skip  ${name}`); return }
  const { context, token, profile, blocked } = await contextFor(who, { allowWrites })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR_ABORTED|Download the React DevTools/.test(m.text())) errors.push(m.text()) })
  const failed = []
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '').replace(ORIGIN, '')}`) })
  const tail = () => `${errors.length ? ' — console: ' + errors[0].slice(0, 160) : ''}${failed.length ? ' — http: ' + failed.join('; ').slice(0, 160) : ''}${blocked.length ? ' — blocked writes: ' + blocked.join('; ').slice(0, 160) : ''}`
  try {
    const note = await run({ page, token, profile, blocked })
    const status = errors.length ? 'FAIL' : 'PASS'
    results.push({ name, who, status, note, errors, http: failed, blocked })
    log(`${status}  ${name} (${who ?? 'anonymous'}) ${note ? '— ' + note : ''}${tail()}`)
  } catch (error) {
    const file = await snap(page, `${name}-FAILED`).catch(() => '')
    results.push({ name, who, status: 'FAIL', reason: error.message.split('\n')[0], errors, http: failed, blocked, screenshot: file })
    log(`FAIL  ${name} (${who ?? 'anonymous'}) — ${error.message.split('\n')[0].slice(0, 200)}${tail()}  [${file}]`)
  } finally {
    await context.close()
  }
}

// ------------------------------------------------------------------------------------------

await step('01 login', null, async ({ page }) => {
  await go(page, '/login'); await page.getByRole('button', { name: NAMES.signIn }).first().waitFor({ timeout: 15000 })
  const t = await page.locator('body').innerText()
  await snap(page, '01-login')
  // The line reads "… Nunca se vincula …" with a capital N; the first run said NOT found.
  return /nunca se vincula/i.test(t) ? 'anonymity line present' : 'anonymity line NOT found'
})

await step('02 admin dashboard', values.admin, async ({ page }) => {
  await go(page, '/dashboard'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const t = await mainText(page)
  await snap(page, '02-dashboard')
  const attention = t.split('\n').filter((l) => /respuestas completadas|atenci/i.test(l)).slice(0, 3).join(' | ')
  return attention.slice(0, 220)
})

await step('03 surveys list', values.admin, async ({ page }) => {
  await go(page, '/surveys'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  const t = await mainText(page)
  await snap(page, '03-surveys')
  const titles = t.split('\n').filter((l) => /^Encuesta de Clima/.test(l.trim()))
  return `${titles.length} survey titles: ${titles.join(' / ').slice(0, 200)}`
})

await step('04 results Q3 and drill-in', values.admin, async ({ page, token }) => {
  const list = await api(`/surveys?lang=es`, token)
  const q3 = (list?.surveys ?? []).find((s) => /Q3/.test(s.title) && s.status === 'closed')
  if (!q3) throw new Error('no closed Q3')
  await go(page, `/surveys/${q3.id}/results`)
  await page.getByRole('table').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  const before = await mainText(page)
  await snap(page, '04a-results-q3')
  const opRow = page.locator('tr', { hasText: 'Operaciones' }).first()
  const cell = (await opRow.count()) ? opRow.locator('td button').first() : page.locator('td button').first()
  await cell.waitFor({ timeout: 10000 }); await cell.click()
  await page.getByText(NAMES.drillIn).first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(800)
  await snap(page, '04b-results-q3-drill-in')
  for (const path of ['/export/csv', '/export/pdf']) { const r = await fetch(`${API}/surveys/${q3.id}${path}`, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${path} -> ${r.status}`) }
  const hatched = /Finanzas/.test(before) ? 'Finanzas row present' : 'Finanzas row NOT found'
  const heads = ['Seguridad psicológica', 'Carga de trabajo', 'Confianza', 'Reconocimiento', 'Desarrollo', 'Pertenencia'].filter((h) => before.includes(h))
  return `${q3.id.slice(0, 8)} ${hatched}; ${heads.length}/6 Spanish headings; csv+pdf 200`
})

await step('05 climate trends', values.admin, async ({ page }) => {
  await go(page, '/surveys/climate-trends'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  await snap(page, '05-climate-trends')
  const t = await mainText(page)
  return (t.match(/Q[1-4]/g) ?? []).length + ' wave labels'
})

await step('06 action plans and one detail', values.admin, async ({ page }) => {
  await go(page, '/action-plans'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  const t = await mainText(page)
  await snap(page, '06a-action-plans')
  const link = page.getByRole('link', { name: NAMES.openPlan }).first()
  if (await link.count()) { await link.click(); await page.waitForTimeout(1500); await snap(page, '06b-action-plan-detail') }
  return `${(t.match(/Cancelad/g) ?? []).length} cancelled labels visible; detail ${await link.count() ? 'opened' : 'NOT opened'}`
})

await step('07 tracking consolidado and planes', values.admin, async ({ page }) => {
  await go(page, '/tracking'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const t1 = await mainText(page)
  await snap(page, '07a-tracking')
  await go(page, '/tracking/planes'); await page.waitForTimeout(1500)
  const t2 = await mainText(page)
  await snap(page, '07b-tracking-planes')
  return `Calidad mentioned: ${(t1 + t2).split('Calidad').length - 1}; nodos: ${['Finanzas', 'Ingeniería', 'Operaciones'].filter((n) => (t1 + t2).includes(n)).join(',')}`
})

await step('08 templates and preview', values.admin, async ({ page }) => {
  await go(page, '/surveys/templates'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  await snap(page, '08a-templates')
  const t = await mainText(page)
  // "Vista Previa" is a link styled as a button (`SurveyTemplateCard.tsx`), named
  // "Vista previa de <template>"; the first run looked for a button and reported none.
  const links = page.getByRole('link', { name: NAMES.preview })
  const previews = await links.count()
  const preview = links.first()
  if (previews) { await preview.click(); await page.waitForURL(/\/surveys\/templates\/[0-9a-f-]{36}/, { timeout: 15000 }); await page.waitForTimeout(1200); await snap(page, '08b-template-preview') }
  return `Pulso de compromiso ${t.includes('Pulso de compromiso') ? 'listed' : 'NOT listed'}; ${previews} preview link(s), ${previews ? 'first opened' : 'NONE opened'}`
})

await step('09 new survey wizard step 1', values.admin, async ({ page }) => {
  await go(page, '/surveys/new')
  await page.waitForTimeout(800)
  // A leftover autosaved draft offers itself back here. It is photographed, not discarded:
  // "Descartarla" is a DELETE, and the morning wants to know the offer will appear.
  const offered = await page.getByRole('button', { name: NAMES.discardDraft }).first().count()
  await snap(page, '09-new-survey')
  const t = await mainText(page)
  return `${offered ? 'a saved draft is offered back; ' : ''}${t.split('\n').slice(0, 4).join(' | ').slice(0, 160)}`
})

await step('10a employee dashboard', values.employee, async ({ page }) => {
  await go(page, '/dashboard'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  await snap(page, '10a-employee-dashboard')
  const t = await mainText(page)
  return t.split('\n').filter((l) => /encuesta|responder|complet/i.test(l)).slice(0, 4).join(' | ').slice(0, 220)
})

// The one write, and only when both flags are given — see the header.
if (values.answerer && values['answer-survey']) {
  await step('10b answer the survey', values.answerer, async ({ page }) => {
    await go(page, '/dashboard'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(1200)
    await snap(page, '10b1-answerer-dashboard')
    await go(page, `/surveys/${values['answer-survey']}/respond`)
    await page.getByRole('radio').first().waitFor({ timeout: 15000 })
    await snap(page, '10b2-respond-page')
    const radios = page.getByRole('radio'); const count = await radios.count()
    for (let i = 3; i < count; i += 5) await radios.nth(i).click()
    const textareas = page.locator('textarea'); const t = await textareas.count(); for (let i = 0; i < t; i++) await textareas.nth(i).fill('Más claridad en las prioridades.')
    await snap(page, '10b3-respond-filled')
    await click(page, NAMES.submitAnswers)
    await page.waitForTimeout(2500)
    await snap(page, '10b4-respond-submitted')
    const done = await page.getByText(/gracias|enviad|recibid|thank/i).first().count()
    return `answered ${Math.floor(count / 5)} likert groups, ${t} text; confirmation ${done ? 'shown' : 'NOT shown'}`
  }, { allowWrites: true })
}

await step('11 leader dashboard', values.leader, async ({ page }) => {
  await go(page, '/dashboard'); await page.getByText(NAMES.yourTeam).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)
  await snap(page, '11-leader-dashboard')
  const t = await mainText(page)
  return t.split('\n').filter((l) => /equipo|Ingenier/i.test(l)).slice(0, 3).join(' | ').slice(0, 200)
})

await step('12 reports and share dialog', values.admin, async ({ page, profile }) => {
  await go(page, `/admin/companies/${profile.companyId}/reports`); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)
  const t = await mainText(page)
  await snap(page, '12a-reports')
  // Opens the dialog and photographs it; it does NOT press "Crear enlace" — that would mint.
  await click(page, NAMES.share)
  await page.getByRole('dialog').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(800)
  await snap(page, '12b-share-dialog')
  const d = await page.getByRole('dialog').first().innerText()
  return `${(t.match(/T3 2026/g) ?? []).length} report titles; dialog mentions contraseña: ${/contraseña|password/i.test(d)}`
})

await step('13 benchmarks', values.admin, async ({ page }) => {
  await go(page, '/analytics/benchmarks'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  await snap(page, '13-benchmarks')
  const t = await mainText(page)
  return t.split('\n').filter((l) => /0,00|Puntaje|mediana/i.test(l)).slice(0, 3).join(' | ').slice(0, 200)
})

await step('14 microclimate live page and respond link as a signed-in employee', values.admin, async ({ page, token, profile }) => {
  const list = await api(`/microclimates?companyId=${profile.companyId}&lang=es`, token)
  const live = (list?.microclimates ?? []).find((m) => m.status === 'active')
  if (!live) throw new Error('no live microclimate')
  await go(page, `/microclimates/${live.id}/live`); await page.waitForTimeout(1500)
  await snap(page, '14a-microclimate-live')
  const text = await page.locator('main').innerText()
  const m = text.match(/https?:\/\/[^\s]+\/(microclimate-invitations|s|m)\/[A-Za-z0-9_-]+|\/microclimate[^\s]*respond[^\s]*/)
  if (!m) throw new Error(`no respond link on the live page: ${text.slice(0, 200).replace(/\n/g, ' | ')}`)
  const url = m[0].startsWith('http') ? m[0] : `${ORIGIN}${m[0]}`
  // The employee's context carries the same read-only guard: the invitation page POSTs an
  // `opened` step as it mounts, and that is exactly the request the guard is for.
  const { context: employeeContext, blocked: employeeBlocked } = await contextFor(values.employee)
  const pub = await employeeContext.newPage()
  const pubErrors = []
  pub.on('console', (msg) => { if (msg.type() === 'error' && !/favicon|net::ERR_ABORTED|DevTools/.test(msg.text())) pubErrors.push(msg.text()) })
  await pub.goto(url, { waitUntil: 'networkidle' })
  await pub.waitForTimeout(1200)
  // Counts the controls; clicks none of them.
  const radios = await pub.getByRole('radio').count(); const alert = await pub.getByRole('alert').allInnerTexts().catch(() => [])
  await snap(pub, '14b-microclimate-respond-signed-in-employee')
  await employeeContext.close()
  if (!radios) throw new Error(`signed-in employee got no question controls; alerts: ${alert.join(' / ').slice(0, 160)}`)
  return `${url.replace(ORIGIN, '')} opens for ${values.employee} with ${radios} radios${pubErrors.length ? '; console: ' + pubErrors[0].slice(0, 100) : ''}${employeeBlocked.length ? '; blocked writes: ' + employeeBlocked.join('; ').slice(0, 120) : ''}`
})

await step('15 supervisor dashboard', values.supervisor, async ({ page }) => {
  await go(page, '/dashboard'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)
  await snap(page, '15-supervisor-dashboard')
  return 'rendered'
})

await browser.close()
writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => r.status === 'FAIL')
const code = exitCode(results)
log(code === 2
  ? `\nrehearsal: --only "${values.only}" matched no step`
  : `\nrehearsal: ${results.length - failed.length} passed, ${failed.length} failed — screenshots in ${OUT}`)
process.exit(code)
