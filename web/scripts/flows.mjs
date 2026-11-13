/**
 * Role-play the product against the REAL local stack, flow by flow, and say what broke.
 *
 *   node scripts/flows.mjs --domain meridiano.test --password Demo1234! \
 *        --admin ana.rojas --employee diego.solano --leader luis.mora --supervisor sofia.vargas
 *
 * `e2e.mjs` visits every route and records the wire; this walks the flows a person walks:
 * build a survey from a template and launch it, answer it, read its results, open a
 * finding, create an action plan, share a report and open the link anonymously, answer a
 * live microclimate. Each flow is a PASS or a FAIL with the reason and a screenshot under
 * `<out>/`, and a console error anywhere fails the flow it happened in.
 *
 * Signs in through `POST /auth/login` and hands the token to the page — the password
 * never touches a browser field. Runs on 5173 for the same CORS reason `e2e.mjs` does.
 *
 * What it leaves behind, by design of the API, is exactly one department and one plan —
 * `FIXED_DEPARTMENT_NAME` / `FIXED_PLAN_TITLE` in `flows-harness.mjs`, created only when
 * absent, reused otherwise, deactivated / cancelled at the end (neither can be deleted) — plus
 * one ARCHIVED survey per run in which the employee flow answered (a survey with a response
 * cannot be deleted). Every share link the run mints is revoked, and every test survey that
 * can be deleted is. A teardown request that does not succeed is printed as RESIDUE LEFT and
 * fails the run.
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { STORAGE_KEYS } from './shot-harness.mjs'
import {
  FIXED_DEPARTMENT_NAME,
  FIXED_PLAN_TITLE,
  MINT_PATH,
  findFixedDepartment,
  findFixedPlan,
  shareFromMint,
  teardownRequests,
  teardownFallback,
  summariseTeardown,
} from './flows-harness.mjs'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    server: { type: 'string', default: 'http://localhost:5173' },
    domain: { type: 'string', default: 'acme.test' },
    password: { type: 'string', default: 'Local1234!' },
    admin: { type: 'string', default: 'fede.admin' },
    employee: { type: 'string', default: 'fede.employee' },
    leader: { type: 'string', default: 'fede.leader' },
    supervisor: { type: 'string', default: 'fede.supervisor' },
    locale: { type: 'string', default: 'es' },
    out: { type: 'string', default: '.flows' },
    // Run only the flows whose name contains this text (case-insensitive), e.g. --only survey.
    only: { type: 'string' },
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
/** A write the flow depends on; throws with the status so a refused reactivation fails the flow. */
async function mutate(method, path, body, token) {
  const r = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`)
  return r
}

const browser = await chromium.launch()
const results = []
let shot = 0
/**
 * What this run must put back at the end — the survey it built, the plan and department it
 * created OR reused (both go back to cancelled / inactive either way), and every share link
 * the page minted. See `teardownRequests` for what happens to each.
 */
const created = { surveys: [], plans: [], departments: [], shares: [], microclimates: [] }

async function contextFor(who) {
  const { token, profile } = await login(who)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(([keys, t, company, locale]) => {
    try { localStorage.setItem(keys.token, t); localStorage.setItem(keys.locale, locale); localStorage.setItem(keys.theme, 'light'); if (company) localStorage.setItem(keys.company, company) } catch {}
  }, [STORAGE_KEYS, token, profile.companyId ?? '', values.locale])
  return { context, token, profile }
}

async function flow(name, who, run) {
  if (values.only && !name.toLowerCase().includes(values.only.toLowerCase())) return
  const errors = []
  const start = Date.now()
  // The sign-in is inside the try: a login that fails (an account the tenant does not have)
  // must fail THIS flow, not throw past every later flow and past the teardown at the end.
  let context = null
  let page = null
  try {
    const auth = await contextFor(who)
    context = auth.context
    page = await context.newPage()
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() !== 'error' || /favicon|net::ERR_ABORTED|Download the React DevTools/.test(m.text())) return
      // A new survey has no distribution row yet, and the API answers its read with 404 — "the
      // normal state of a new survey" (`useDistributionModel`), which the page handles. Only
      // that request, by its URL, is excused.
      if (/status of 404/.test(m.text()) && /\/surveys\/[0-9a-f-]{36}\/distribution(\?|$)/.test(m.location()?.url ?? '')) return
      errors.push(m.text())
    })
    const note = await run({ page, token: auth.token, profile: auth.profile })
    const status = errors.length ? 'FAIL' : 'PASS'
    results.push({ name, who, status, note, errors, ms: Date.now() - start })
    log(`${status}  ${name} (${who}) ${note ? '— ' + note : ''}${errors.length ? ' — console: ' + errors[0].slice(0, 140) : ''}`)
  } catch (error) {
    const file = page ? resolve(OUT, `${String(++shot).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) : ''
    if (page) await page.screenshot({ path: file, fullPage: true }).catch(() => {})
    results.push({ name, who, status: 'FAIL', reason: error.message.split('\n')[0], errors, screenshot: file })
    log(`FAIL  ${name} (${who}) — ${error.message.split('\n')[0].slice(0, 200)}${file ? `  [${file}]` : ''}`)
  } finally {
    if (context) await context.close()
  }
}

const go = async (page, path) => { await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 30000 }) }
const click = async (page, name, role = 'button') => { const el = page.getByRole(role, { name }).first(); await el.waitFor({ timeout: 10000 }); await el.click() }

// ---------------------------------------------------------------------------------------

await flow('survey: build from template and launch', values.admin, async ({ page, token }) => {
  await go(page, '/surveys/new')
  // A previous run's autosaved draft offers itself back; decline it so the run is deterministic.
  const discard = page.getByRole('button', { name: /Descartarla|Discard/ }).first(); if (await discard.count()) await discard.click()
  const title = `Pulso de prueba ${new Date().toISOString().slice(11, 16)}`
  // Step 1: pick the template, name it.
  // The template picker is a custom combobox (a <button role=combobox>), not a <select>.
  await page.getByRole('combobox', { name: /Partir de una plantilla|template/i }).first().click()
  await page.getByRole('option', { name: /Pulso de compromiso|Engagement pulse/ }).first().click()
  // One «Título» since the single-title builder: the content language is chosen in the step
  // bar, and the title is written in it.
  await page.getByLabel(/^Título|^Title/i).first().fill(title)
  await click(page, /Siguiente|Next/)
  // Step 2: schedule — defaults or fill dates if required.
  // The schedule inputs are datetime-local, so the value carries a time.
  // Local wall-clock, as a datetime-local input reads it. It was the UTC date with a local
  // 09:00, so from 18:00 in Costa Rica (already tomorrow in UTC) the survey opened tomorrow and
  // could not be activated. The start is a few minutes ago so «Activar» opens it now.
  const local = (at) => { const d = new Date(at); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
  await page.getByLabel(/Fecha de Inicio|Start date/i).first().fill(local(Date.now() - 5 * 60e3))
  await page.getByLabel(/Fecha de Finalización|End date/i).first().fill(local(Date.now() + 14 * 864e5))
  await click(page, /Siguiente|Next/)
  // Step 3: audience (defaults), step 4: questions (from template), step 5: settings
  // (defaults), step 6: review — six steps since the 11 Nov builder.
  await click(page, /Siguiente|Next/)
  await click(page, /Siguiente|Next/)
  await click(page, /Siguiente|Next/)
  // The review step's own action, by its exact name: a loose /Guardar/ matched the header's
  // «Guardar borrador», which saves and stays on the builder.
  const create = page.getByRole('button', { name: /^(Crear el borrador|Create the draft)$/ }).first()
  await create.waitFor({ timeout: 10000 })
  await create.click()
  await page.waitForURL(/\/surveys\/[0-9a-f-]{36}/, { timeout: 15000 })
  const id = page.url().match(/surveys\/([0-9a-f-]{36})/)[1]
  const survey = await api(`/surveys/${id}?lang=es`, token)
  created.surveys.push(id)
  if (!survey) throw new Error('created survey not readable back')
  // Launch it: the detail page offers a status change.
  await page.waitForLoadState('networkidle')
  const activate = page.getByRole('button', { name: /^Activar$|^Activate$/ }).first()
  // Waited for, not counted: the status card renders after the survey's own read, and a bare
  // `count()` ran before it and silently skipped the launch.
  if (await activate.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
    await activate.click()
    // A confirmation, when the page asks for one, is answered with the same verb.
    const confirm = page.locator('[role="dialog"], [role="alertdialog"]').getByRole('button', { name: /^Activar|^Activate|^Confirmar|^Confirm/ }).first()
    await confirm.waitFor({ state: 'visible', timeout: 3000 }).then(() => confirm.click()).catch(() => {})
    await page.waitForTimeout(2000)
  }
  const after = await api(`/surveys/${id}?lang=es`, token)
  // The flow is "build AND launch": a survey left in draft is a failure, said with what the page
  // offered, not a pass with "status draft" in its note.
  if (after?.status !== 'active') {
    const alerts = (await page.getByRole('alert').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean)
    throw new Error(`not launched (status ${after?.status}): ${alerts.join(' / ').slice(0, 160) || 'no alert on the page'}`)
  }
  return `id ${id.slice(0, 8)} status ${after.status} questions ${survey.questions?.length ?? '?'}`
})

await flow('employee: answer the open survey', values.employee, async ({ page }) => {
  await go(page, '/dashboard')
  await click(page, /Empezar a responder|Continuar|Responder|Start/, 'link').catch(async () => click(page, /Empezar a responder|Continuar|Responder|Start/))
  await page.waitForURL(/\/respond/, { timeout: 15000 })
  // One question per page since the paged respond form: answer what this page shows (the «4»
  // of a scale, a sentence in a text box), then Siguiente, until the last page offers
  // «Enviar mis respuestas».
  const submit = page.getByRole('button', { name: /^Enviar mis respuestas|^Enviar$|^Submit/ }).first()
  const next = page.getByRole('button', { name: /^Siguiente|^Next/ }).first()
  let b = 0
  for (let guard = 0; guard < 80; guard += 1) {
    await page.waitForTimeout(150)
    const radios = page.getByRole('radio')
    const count = await radios.count()
    if (count > 0) { await radios.nth(Math.min(3, count - 1)).click(); b += 1 }
    const boxes = page.locator('textarea'); const t = await boxes.count()
    for (let k = 0; k < t; k += 1) await boxes.nth(k).fill('Más claridad en las prioridades.')
    if (await submit.isVisible().catch(() => false)) break
    if (!(await next.isVisible().catch(() => false))) break
    await next.click()
  }
  await submit.click()
  await page.waitForTimeout(2000)
  const done = await page.getByText(/gracias|enviad|recibid|thank/i).first().count()
  if (b === 0) throw new Error('no likert radios found on the respond page')
  return `answered ${b} questions, confirmation ${done ? 'shown' : 'NOT shown'}`
})

await flow('results: closed survey, drill into a finding, exports answer', values.admin, async ({ page, token }) => {
  const list = await api(`/surveys?lang=es`, token)
  const closed = (list?.surveys ?? []).find((s) => s.status === 'closed' && (s.responseCount ?? 0) >= 20)
  if (!closed) throw new Error('no closed survey with responses')
  await go(page, `/surveys/${closed.id}/results`)
  // The redesigned page opens on «Resumen», whose climate grid is the drill-in: a disclosed
  // cell is a button, and it opens the cell panel beside the grid.
  const grid = page.locator('[data-testid="climate-grid"]').first()
  await grid.waitFor({ timeout: 15000 })
  const cell = grid.locator('td button').first(); await cell.waitFor({ timeout: 10000 }); await cell.click()
  await page.locator('[data-testid="cell-panel"]').first().waitFor({ timeout: 10000 })
  for (const path of ['/export/csv', '/export/pdf']) { const r = await fetch(`${API}/surveys/${closed.id}${path}`, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${path} -> ${r.status}`) }
  return `${closed.title} drill-in ok, csv+pdf 200`
})

await flow('action plan: the driver\'s own plan, created from the form when absent', values.admin, async ({ page, token, profile }) => {
  const title = FIXED_PLAN_TITLE
  // One plan by a fixed title, ever: a plan cannot be deleted, only cancelled, so a fresh one
  // per run is one more cancelled row on the client's screen per run.
  const before = await api(`/action-plans?companyId=${profile.companyId}&lang=es`, token)
  const existing = findFixedPlan(before?.actionPlans, title)
  if (existing) {
    if (existing.reopen) await mutate('PUT', `/action-plans/${existing.id}`, { status: 'not_started' }, token)
    created.plans.push(existing.id)
    await go(page, '/action-plans')
    await page.getByText(title, { exact: false }).first().waitFor({ timeout: 15000 })
    return `${title} reused (${existing.reopen ? 'reopened' : 'already open'}) and listed`
  }
  await go(page, '/action-plans')
  await click(page, /Nuevo Plan de Acción|New Action Plan/i)
  await page.getByLabel(/^Título|Title/i).first().fill(title)
  await page.getByLabel(/^Descripción|Description/i).first().fill('Creado por el recorrido automatizado; se puede borrar.')
  const due = page.getByLabel(/vencimiento|due/i).first(); if (await due.count()) await due.fill(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))
  await click(page, /Crear Plan|Crear|Guardar|Create|Save/)
  await page.waitForTimeout(3000)
  const plans = await api(`/action-plans?companyId=${profile.companyId}&lang=es`, token)
  const plan = plans?.actionPlans?.find((p) => p.title === title)
  if (plan) created.plans.push(plan.id)
  if (!plan) {
    const alerts = await page.getByRole('alert').allInnerTexts().catch(() => [])
    const invalid = await page.locator('[aria-invalid="true"]').count().catch(() => 0)
    throw new Error(`plan not found after create; alerts: ${alerts.join(' / ').slice(0, 200)}; invalid fields: ${invalid}; url ${page.url()}`)
  }
  return title
})

await flow('report: share link created, opens anonymously, revoked at teardown', values.admin, async ({ page, profile }) => {
  await go(page, `/admin/companies/${profile.companyId}/reports`)
  // Compartir lives in each row's «Más acciones» menu since the redesign.
  await click(page, /^Más acciones para|^More actions for/)
  await click(page, /^Compartir|^Share/, 'menuitem')
  // The mint response is the only place the share id ever appears (`reportShares.ts`), so it
  // is caught on the wire, before the click that causes it, and revoked at teardown.
  const minted = page.waitForResponse((r) => r.request().method() === 'POST' && MINT_PATH.test(r.url()), { timeout: 15000 })
  await click(page, /Crear enlace|Create link/)
  const response = await minted
  const share = shareFromMint(response.url(), await response.json().catch(() => null))
  if (!share) throw new Error(`mint answered ${response.status()} without a share id`)
  created.shares.push(share)
  await page.waitForTimeout(1500)
  const linkText = await page.getByRole('dialog').first().innerText()
  const m = linkText.match(/\/shared\/reports\/([A-Za-z0-9_-]+)/)
  if (!m) throw new Error(`no share url in dialog: ${linkText.slice(0, 200)}`)
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pub = await anon.newPage()
  await pub.goto(`${ORIGIN}/shared/reports/${m[1]}`, { waitUntil: 'networkidle' })
  const ok = await pub.getByRole('heading').first().count()
  await anon.close()
  return `token ${m[1].slice(0, 8)}… public page heading ${ok ? 'rendered' : 'MISSING'}`
})

await flow('microclimate: live page shows the respond link, and it opens anonymously', values.admin, async ({ page, token, profile }) => {
  const list = await api(`/microclimates?companyId=${profile.companyId}&lang=es`, token)
  let live = (list?.microclimates ?? []).find((m) => m.status === 'active')
  if (!live) {
    // The tenant has no session running: open one for this walk, through the endpoints the
    // create page calls, and close it at teardown (`teardownRequests`).
    const now = Date.now()
    const response = await mutate('POST', '/microclimates', {
      title: 'Recorrido automatizado', companyId: profile.companyId,
      startTime: new Date(now - 60e3).toISOString(), endTime: new Date(now + 2 * 3600e3).toISOString(),
      targetParticipantCount: 10, anonymousResponses: true, timezone: 'America/Costa_Rica',
      questions: [{ text: '¿Cómo va la semana?', type: 'likert', required: true, order: 0 }],
    }, token)
    const draft = await response.json()
    created.microclimates.push(draft.id)
    await mutate('PUT', `/microclimates/${draft.id}/status`, { status: 'active' }, token)
    live = { id: draft.id, title: draft.title }
  }
  await go(page, `/microclimates/${live.id}/live`)
  const text = await page.locator('main').innerText()
  const m = text.match(/https?:\/\/[^\s]+\/(microclimate-invitations|s|m)\/[A-Za-z0-9_-]+|\/microclimate[^\s]*respond[^\s]*/)
  if (!m) throw new Error(`no respond link on the live page: ${text.slice(0, 200).replace(/\n/g, ' | ')}`)
  const url = m[0].startsWith('http') ? m[0] : `${ORIGIN}${m[0]}`
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const pub = await anon.newPage()
  await pub.goto(url, { waitUntil: 'networkidle' })
  const radios = await pub.getByRole('radio').count(); const alert = await pub.getByRole('alert').allInnerTexts().catch(() => [])
  await anon.close()
  if (!radios) throw new Error(`respond link opened but no question controls; alerts: ${alert.join(' / ').slice(0, 160)}`)
  return `${live.title}: link ${url.replace(ORIGIN, '')} opens with ${radios} radios`
})

await flow('leader: dashboard reads the team, not a person', values.leader, async ({ page }) => {
  await go(page, '/dashboard')
  await page.getByText(/Su equipo|Your team/).first().waitFor({ timeout: 15000 })
  return 'team row rendered'
})

await flow('supervisor: dashboard and my surveys', values.supervisor, async ({ page }) => {
  await go(page, '/dashboard'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await go(page, '/surveys/my'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  return 'both rendered'
})

await flow('admin: the driver\'s own department, created from the form when absent, listed', values.admin, async ({ page, token, profile }) => {
  const name = FIXED_DEPARTMENT_NAME
  // One department by a fixed name, ever: a department cannot be deleted, only deactivated,
  // and the create endpoint refuses a duplicate name at the same level anyway.
  const before = await api(`/admin/departments?companyId=${profile.companyId}`, token)
  const existing = findFixedDepartment(before?.departments, name)
  if (existing) {
    if (existing.reactivate) await mutate('PUT', `/admin/departments/${existing.id}`, { isActive: true }, token)
    created.departments.push(existing.id)
    await go(page, '/departments')
    await page.getByText(name, { exact: false }).first().waitFor({ timeout: 15000 })
    return `${name} reused (${existing.reactivate ? 'reactivated' : 'already active'}) and listed`
  }
  await go(page, '/departments')
  await click(page, /Nuevo Departamento|New Department/i)
  await page.getByLabel(/^Nombre|Name/i).first().fill(name)
  await click(page, /Crear|Guardar|Create|Save/)
  await page.waitForTimeout(1500)
  const { departments } = await api(`/admin/departments?companyId=${profile.companyId}`, token)
  const department = departments.find((d) => d.name === name)
  if (!department) throw new Error('department not created')
  created.departments.push(department.id)
  return name
})

await browser.close()

// Teardown through the same endpoints the UI uses — the plan is in `flows-harness.mjs`: every
// share link revoked, the survey deleted (or closed and archived when it holds a response),
// the plan cancelled, the department deactivated. Each status is recorded, and anything the
// server refused is printed as residue and fails the run.
const teardown = await (async () => {
  const { token } = await login(values.admin)
  const send = async ({ method, path, body, headers }) => {
    const r = await fetch(`${API}${path}`, { method, headers: { ...headers, Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    return r.status
  }
  const outcomes = []
  for (const request of teardownRequests(created)) {
    let last = { ...request, status: await send(request) }
    for (const fallback of teardownFallback(request, last.status)) last = { ...fallback, status: await send(fallback) }
    outcomes.push(last)
  }
  return summariseTeardown(outcomes)
})()
log(teardown.line)
const failed = results.filter((r) => r.status === 'FAIL')
log(`\nflows: ${results.length - failed.length} passed, ${failed.length} failed${teardown.failed.length ? `, ${teardown.failed.length} teardown request(s) refused` : ''}`)
process.exit(failed.length || teardown.failed.length ? 1 : 0)
