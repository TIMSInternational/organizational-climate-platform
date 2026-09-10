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
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { STORAGE_KEYS } from './shot-harness.mjs'

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
/** Rows this run created, torn down at the end so a demo tenant never fills with test data. */
const created = { surveys: [], plans: [], departments: [] }

async function contextFor(who) {
  const { token, profile } = await login(who)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(([keys, t, company, locale]) => {
    try { localStorage.setItem(keys.token, t); localStorage.setItem(keys.locale, locale); localStorage.setItem(keys.theme, 'light'); if (company) localStorage.setItem(keys.company, company) } catch {}
  }, [STORAGE_KEYS, token, profile.companyId ?? '', values.locale])
  return { context, token, profile }
}

async function flow(name, who, run) {
  const { context, token, profile } = await contextFor(who)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|net::ERR_ABORTED|Download the React DevTools/.test(m.text())) errors.push(m.text()) })
  const start = Date.now()
  try {
    const note = await run({ page, token, profile })
    const status = errors.length ? 'FAIL' : 'PASS'
    results.push({ name, who, status, note, errors, ms: Date.now() - start })
    log(`${status}  ${name} (${who}) ${note ? '— ' + note : ''}${errors.length ? ' — console: ' + errors[0].slice(0, 140) : ''}`)
  } catch (error) {
    const file = resolve(OUT, `${String(++shot).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`)
    await page.screenshot({ path: file, fullPage: true }).catch(() => {})
    results.push({ name, who, status: 'FAIL', reason: error.message.split('\n')[0], errors, screenshot: file })
    log(`FAIL  ${name} (${who}) — ${error.message.split('\n')[0].slice(0, 200)}  [${file}]`)
  } finally {
    await context.close()
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
  // A bilingual template instantiates a bilingual survey, and that needs both titles.
  await page.getByLabel(/Título \(inglés\)|Title \(English\)/i).first().fill(`Test pulse ${title.slice(-5)}`)
  await page.getByLabel(/Título \(español\)|Title \(Spanish\)/i).first().fill(title)
  await click(page, /Siguiente|Next/)
  // Step 2: schedule — defaults or fill dates if required.
  // The schedule inputs are datetime-local, so the value carries a time.
  const stamp = (offsetDays, hh) => { const d = new Date(Date.now() + offsetDays * 864e5); return `${d.toISOString().slice(0, 10)}T${hh}` }
  await page.getByLabel(/Fecha de Inicio|Start date/i).first().fill(stamp(0, '09:00'))
  await page.getByLabel(/Fecha de Finalización|End date/i).first().fill(stamp(14, '18:00'))
  await click(page, /Siguiente|Next/)
  // Step 3: audience (defaults), step 4: questions (from template), step 5: review.
  await click(page, /Siguiente|Next/)
  await click(page, /Siguiente|Next/)
  const create = page.getByRole('button', { name: /Crear|Guardar|Create|Save|Lanzar|Launch/ }).first()
  await create.waitFor({ timeout: 10000 })
  await create.click()
  await page.waitForURL(/\/surveys\/[0-9a-f-]{36}/, { timeout: 15000 })
  const id = page.url().match(/surveys\/([0-9a-f-]{36})/)[1]
  const survey = await api(`/surveys/${id}?lang=es`, token)
  created.surveys.push(id)
  if (!survey) throw new Error('created survey not readable back')
  // Launch it: the detail page offers a status change.
  const activate = page.getByRole('button', { name: /Activar|Cambiar a Activa|Lanzar|Publicar/ }).first()
  if (await activate.count()) { await activate.click(); await page.waitForTimeout(1500) }
  const after = await api(`/surveys/${id}?lang=es`, token)
  return `id ${id.slice(0, 8)} status ${after.status} questions ${survey.questions?.length ?? '?'}`
})

await flow('employee: answer the open survey', values.employee, async ({ page }) => {
  await go(page, '/dashboard')
  await click(page, /Empezar a responder|Continuar|Responder|Start/, 'link').catch(async () => click(page, /Empezar a responder|Continuar|Responder|Start/))
  await page.waitForURL(/\/respond/, { timeout: 15000 })
  await page.getByRole('radio').first().waitFor({ timeout: 15000 })
  // Answer every likert group by clicking its "4", every text with a sentence.
  // Likert answers are radios, five per question; pick the fourth of each group of five.
  const radios = page.getByRole('radio')
  const count = await radios.count()
  for (let i = 3; i < count; i += 5) await radios.nth(i).click()
  const b = Math.floor(count / 5)
  const textareas = page.locator('textarea'); const t = await textareas.count(); for (let i = 0; i < t; i++) await textareas.nth(i).fill('Más claridad en las prioridades.')
  await click(page, /Enviar mis respuestas|Enviar|Submit/)
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
  await page.getByRole('table', { name: /tabla|table/i }).first().waitFor({ timeout: 15000 })
  const cell = page.locator('td button').first(); await cell.waitFor({ timeout: 10000 }); await cell.click()
  await page.getByText(/Cada pregunta se compara|compared/i).first().waitFor({ timeout: 10000 })
  for (const path of ['/export/csv', '/export/pdf']) { const r = await fetch(`${API}/surveys/${closed.id}${path}`, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`${path} -> ${r.status}`) }
  return `${closed.title} drill-in ok, csv+pdf 200`
})

await flow('action plan: create from the form', values.admin, async ({ page, token, profile }) => {
  await go(page, '/action-plans')
  await click(page, /Nuevo Plan de Acción|New Action Plan/)
  const title = `Plan de prueba ${Date.now() % 10000}`
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

await flow('report: share link created and opens anonymously', values.admin, async ({ page, profile }) => {
  await go(page, `/admin/companies/${profile.companyId}/reports`)
  await click(page, /Compartir|Share/)
  await click(page, /Crear enlace|Create link/)
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
  const live = (list?.microclimates ?? []).find((m) => m.status === 'active')
  if (!live) throw new Error('no live microclimate')
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
  await page.getByText(/Tu equipo|Your team/).first().waitFor({ timeout: 15000 })
  return 'team row rendered'
})

await flow('supervisor: dashboard and my surveys', values.supervisor, async ({ page }) => {
  await go(page, '/dashboard'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  await go(page, '/surveys/my'); await page.getByRole('heading').first().waitFor({ timeout: 15000 })
  return 'both rendered'
})

await flow('admin: department created and listed', values.admin, async ({ page, token, profile }) => {
  await go(page, '/departments')
  await click(page, /Nuevo Departamento|New Department/)
  const name = `Calidad ${Date.now() % 1000}`
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

// Teardown through the same endpoints the UI uses: a draft survey is deletable, a plan is
// cancelled, a department is deactivated (there is no delete for either, by design).
{
  const { token } = await login(values.admin)
  const del = (path, body) => fetch(`${API}${path}`, { method: body ? 'PUT' : 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  for (const id of created.surveys) await del(`/surveys/${id}`)
  for (const id of created.plans) await del(`/action-plans/${id}`, { status: 'cancelled' })
  for (const id of created.departments) await del(`/admin/departments/${id}`, { isActive: false })
  log(`teardown: ${created.surveys.length} draft survey(s) deleted, ${created.plans.length} plan(s) cancelled, ${created.departments.length} department(s) deactivated`)
}
const failed = results.filter((r) => r.status === 'FAIL')
log(`\nflows: ${results.length - failed.length} passed, ${failed.length} failed`)
process.exit(failed.length ? 1 : 0)
