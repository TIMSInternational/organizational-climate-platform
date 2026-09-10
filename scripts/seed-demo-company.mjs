/**
 * Seed a Spanish-speaking demo tenant THROUGH THE ENDPOINTS, never the database.
 *
 *   node scripts/seed-demo-company.mjs --phase company   # company, departments, people, roles
 *   node scripts/seed-surveys.mjs --email ana.rojas@meridiano.test   # three waves + an open one
 *   node scripts/seed-demo-company.mjs --phase content   # plans, a live microclimate, reports, a template, the demo employee
 *
 * Why two phases: `seed-surveys.mjs` resets every respondent's password to sign in as them,
 * so the one employee the demo answers a survey as is created AFTER it, with a password
 * that survives. Every write below is one the UI makes; a row this script cannot produce
 * through an endpoint is a row the demo has no business showing.
 *
 * Idempotent by name: re-running finds what exists and creates only what is missing.
 * Signup is rate-limited with login (20/min per IP), hence the 3.1s gap.
 */
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    superEmail: { type: 'string', default: 'fede.super@acme.test' },
    superPassword: { type: 'string', default: 'Local1234!' },
    password: { type: 'string', default: 'Demo1234!' },
    domain: { type: 'string', default: 'meridiano.test' },
    phase: { type: 'string', default: 'company' },
    loginGap: { type: 'string', default: '3.1' },
  },
})
const API = values.api.replace(/\/$/, '')
const GAP = Number(values.loginGap) * 1000
const log = (line) => process.stdout.write(`${line}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function json(url, init = {}, token) {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> ${response.status} ${body.slice(0, 300)}`)
  return body ? JSON.parse(body) : null
}
const post = (url, body, token) => json(url, { method: 'POST', body: JSON.stringify(body) }, token)
const put = (url, body, token) => json(url, { method: 'PUT', body: JSON.stringify(body) }, token)
const login = async (email, password) => (await post(`${API}/auth/login`, { email, password })).token
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString() }

const COMPANY = { name: 'Grupo Meridiano S.A.', emailDomain: values.domain, industry: 'Servicios', size: 'medium', country: 'Costa Rica' }

const DEPARTMENTS = [
  ['Ingeniería', 'Desarrollo de producto y plataforma'],
  ['Finanzas', 'Finanzas y contabilidad'],
  ['Operaciones', 'Operaciones y logística'],
  ['Personas', 'Talento humano y cultura'],
  ['Ventas', 'Equipos comerciales regionales'],
]

/** [name, email local part, role, department]. Employees fill the seed profile: 10/5/6/6/6. */
const PEOPLE = [
  ['Ana Rojas', 'ana.rojas', 'company_admin', null],
  ['Luis Mora', 'luis.mora', 'leader', 'Ingeniería'],
  ['Carla Jiménez', 'carla.jimenez', 'leader', 'Finanzas'],
  ['Marco Castro', 'marco.castro', 'leader', 'Operaciones'],
  ['Elena Quesada', 'elena.quesada', 'leader', 'Personas'],
  ['Pablo Solís', 'pablo.solis', 'leader', 'Ventas'],
  ['Sofía Vargas', 'sofia.vargas', 'supervisor', 'Ingeniería'],
]
const FIRST = ['María', 'José', 'Laura', 'Andrés', 'Valeria', 'Daniel', 'Camila', 'Esteban', 'Paula', 'Gabriel', 'Natalia', 'Sebastián', 'Fernanda', 'Alejandro', 'Mariana', 'Ricardo', 'Isabel', 'Javier', 'Adriana', 'Rodrigo', 'Carolina', 'Felipe', 'Daniela', 'Óscar', 'Lucía', 'Mauricio', 'Verónica', 'Ignacio', 'Patricia', 'Jorge', 'Silvia', 'Roberto', 'Melissa']
const LAST = ['Chaves', 'Alvarado', 'Salas', 'Brenes', 'Campos', 'Zúñiga', 'Ramírez', 'Arias', 'Herrera', 'Montero', 'Céspedes', 'Villalobos', 'Umaña', 'Guzmán', 'Barrantes', 'Sandoval', 'Méndez', 'Cordero', 'Fallas', 'Ulate', 'Araya', 'Segura', 'Bolaños', 'Madrigal', 'Espinoza', 'Retana', 'Coto', 'Marín', 'Porras', 'Vindas', 'Aguilar', 'Pacheco', 'Leiva']
const HEADCOUNT = { Ingeniería: 10, Finanzas: 5, Operaciones: 6, Personas: 6, Ventas: 6 }
let n = 0
for (const [department, count] of Object.entries(HEADCOUNT)) {
  for (let i = 0; i < count; i++, n++) {
    const first = FIRST[n % FIRST.length]; const last = LAST[(n * 7) % LAST.length]
    const local = `${first}.${last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    PEOPLE.push([`${first} ${last}`, local, 'employee', department])
  }
}
/** Created in the `content` phase so `seed-surveys.mjs` never resets this password. */
const DEMO_EMPLOYEE = ['Diego Solano', 'diego.solano', 'employee', 'Ingeniería']

async function signupOrFind(person, users, superToken, companyId) {
  const [name, local, role, department] = person
  const email = `${local}@${values.domain}`
  let user = users.find((u) => u.email === email)
  if (!user) {
    await post(`${API}/auth/signup`, { name, email, password: values.password })
    await sleep(GAP)
    const { users: fresh } = await json(`${API}/admin/users?companyId=${companyId}`, {}, superToken)
    user = fresh.find((u) => u.email === email)
    if (!user) throw new Error(`signup did not create ${email}`)
    log(`  + ${name} <${email}>`)
  }
  return { user, role, department }
}

async function phaseCompany() {
  const superToken = await login(values.superEmail, values.superPassword)
  const companies = await json(`${API}/admin/companies`, {}, superToken)
  let company = (companies.companies ?? companies).find((c) => c.emailDomain === values.domain)
  if (!company) { company = await post(`${API}/admin/companies`, COMPANY, superToken); log(`company created: ${company.name} (${company.id})`) }
  else log(`company exists: ${company.name} (${company.id})`)
  const companyId = company.id

  const { departments: existing } = await json(`${API}/admin/departments?companyId=${companyId}`, {}, superToken)
  const byName = new Map(existing.map((d) => [d.name, d]))
  for (const [name, description] of DEPARTMENTS) {
    if (byName.has(name)) continue
    const created = await post(`${API}/admin/departments`, { companyId, name, description, parentDepartmentId: null, isActive: true }, superToken)
    byName.set(name, created); log(`  + department ${name}`)
  }

  const { users } = await json(`${API}/admin/users?companyId=${companyId}`, {}, superToken)
  for (const person of PEOPLE) {
    const { user, role, department } = await signupOrFind(person, users, superToken, companyId)
    const departmentId = department ? byName.get(department).id : null
    if (user.role !== role) await put(`${API}/admin/users/${user.id}/role`, { role }, superToken)
    if ((user.departmentId ?? null) !== departmentId) await put(`${API}/admin/users/${user.id}`, { departmentId }, superToken)
  }
  log(`people in place: ${PEOPLE.length}. Next: node scripts/seed-surveys.mjs --email ana.rojas@${values.domain} --password ${values.password}`)
}

async function phaseContent() {
  const admin = await login(`ana.rojas@${values.domain}`, values.password)
  const profile = await json(`${API}/profile`, {}, admin)
  const companyId = profile.companyId
  const { departments } = await json(`${API}/admin/departments?companyId=${companyId}`, {}, admin)
  const dept = (name) => departments.find((d) => d.name === name)?.id ?? null

  const { actionPlans } = await json(`${API}/action-plans?companyId=${companyId}`, {}, admin)
  const PLANS = [
    ['Programa de reconocimiento entre pares', 'Peer recognition programme', 'Personas', 20, 'high'],
    ['Reducir la carga de trabajo en Operaciones', 'Reduce the workload in Operations', 'Operaciones', 35, 'high'],
    ['Plan de desarrollo de carrera en Ingeniería', 'Career development plan in Engineering', 'Ingeniería', 60, 'medium'],
    ['Reuniones abiertas con la dirección', 'Open meetings with leadership', null, 45, 'medium'],
  ]
  for (const [es, en, department, due, priority] of PLANS) {
    if (actionPlans.some((p) => p.title === es || p.title === en)) continue
    await post(`${API}/action-plans`, { title: { en, es }, description: { en: `Follows the Q3 finding for ${department ?? 'the whole company'}.`, es: `Atiende el hallazgo del T3 en ${department ?? 'toda la empresa'}.` }, companyId, departmentId: dept(department), dueDate: day(due), priority, tags: ['clima', 'demo'] }, admin)
    log(`  + plan ${es}`)
  }

  const { microclimates } = await json(`${API}/microclimates?companyId=${companyId}`, {}, admin)
  if (!microclimates.some((m) => m.title.startsWith('Pulso semanal'))) {
    const micro = await post(`${API}/microclimates`, {
      title: { en: 'Weekly pulse — how did the week go?', es: 'Pulso semanal — ¿cómo fue la semana?' },
      description: { en: 'Five minutes, two questions, anonymous.', es: 'Cinco minutos, dos preguntas, anónimo.' },
      companyId, startTime: day(0), endTime: day(2), targetParticipantCount: 20, anonymousResponses: true,
      questions: [
        { text: { en: 'How did this week feel?', es: '¿Cómo se sintió esta semana?' }, type: 'likert', scaleMin: 1, scaleMax: 5, scaleLabelMin: { en: 'Very hard', es: 'Muy dura' }, scaleLabelMax: { en: 'Very good', es: 'Muy buena' }, required: true, order: 0 },
        { text: { en: 'In one word, what would help most?', es: 'En una palabra, ¿qué ayudaría más?' }, type: 'open_ended', required: false, order: 1 },
      ],
    }, admin)
    await post(`${API}/microclimates/${micro.id}/activate`, {}, admin).catch((error) => log(`  (activate: ${error.message.slice(0, 120)})`))
    log(`  + microclimate ${micro.id} (live)`)
  }

  const reports = await json(`${API}/admin/reports?companyId=${companyId}`, {}, admin)
  for (const [es, en, format] of [['Clima organizacional — T3 2026', 'Organisational climate — Q3 2026', 'pdf'], ['Datos de clima — T3 2026', 'Climate data — Q3 2026', 'csv']]) {
    if (reports.some((r) => r.title === es || r.title === en)) continue
    await post(`${API}/admin/reports`, { title: { en, es }, description: { en: 'Company-wide, floored.', es: 'Toda la empresa, con el piso de 5.' }, type: 'climate_summary', companyId, format, templateId: null }, admin)
    log(`  + report ${es}`)
  }

  const { templates } = await json(`${API}/survey-templates?companyId=${companyId}`, {}, admin)
  if (!templates.some((t) => t.name.startsWith('Pulso de compromiso'))) {
    const Q = [['recognition', 'My work is recognised when I do it well.', 'Mi trabajo es reconocido cuando lo hago bien.'], ['growth', 'I have learned something useful for my career this quarter.', 'Este trimestre aprendí algo útil para mi carrera.'], ['belonging', 'I feel part of my team.', 'Me siento parte de mi equipo.'], ['workload', 'My workload this month has been manageable.', 'Mi carga de trabajo este mes ha sido manejable.'], ['trust', 'I trust the decisions my direct manager makes.', 'Confío en las decisiones que toma mi jefatura directa.']]
    await post(`${API}/survey-templates`, {
      name: { en: 'Engagement pulse (5 questions)', es: 'Pulso de compromiso (5 preguntas)' },
      description: { en: 'A five-minute pulse between climate waves.', es: 'Un pulso de cinco minutos entre olas de clima.' },
      category: 'pulse', companyId, industry: COMPANY.industry, companySize: COMPANY.size, isPublic: false, tags: ['pulse', 'demo'],
      questions: Q.map(([category, en, es], order) => ({ text: { en, es }, type: 'likert', category, scaleMin: 1, scaleMax: 5, scaleLabelMin: { en: 'Strongly disagree', es: 'Muy en desacuerdo' }, scaleLabelMax: { en: 'Strongly agree', es: 'Muy de acuerdo' }, required: true, commentRequired: false, order })),
    }, admin)
    log('  + template Pulso de compromiso')
  }

  const superToken = await login(values.superEmail, values.superPassword)
  const { users } = await json(`${API}/admin/users?companyId=${companyId}`, {}, superToken)
  const { user, role, department } = await signupOrFind(DEMO_EMPLOYEE, users, superToken, companyId)
  if (user.role !== role) await put(`${API}/admin/users/${user.id}/role`, { role }, superToken)
  if (user.departmentId !== dept(department)) await put(`${API}/admin/users/${user.id}`, { departmentId: dept(department) }, superToken)
  log(`demo employee ready: diego.solano@${values.domain} / ${values.password}`)
}

if (values.phase === 'company') await phaseCompany()
else if (values.phase === 'content') await phaseContent()
else throw new Error(`unknown --phase ${values.phase}`)
