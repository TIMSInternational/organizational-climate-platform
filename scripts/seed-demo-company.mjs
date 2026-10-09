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
import { pathToFileURL } from 'node:url'
import { orderedEmployeesOf, demographicsFor } from './demo-roster.mjs'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:5080' },
    superEmail: { type: 'string', default: 'fede.super@acme.test' },
    superPassword: { type: 'string', default: 'Local1234!' },
    password: { type: 'string', default: 'Demo1234!' },
    profile: { type: 'string', default: 'meridiano' },
    domain: { type: 'string' },
    'company-name': { type: 'string' },
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

/**
 * The tenants this script can build. **Meridiano is unchanged, value for value** — it is the
 * one every screenshot, runbook and demo script in the repo already names, so a new profile
 * must not move it.
 *
 * A profile's `headcount` is the whole reason a demo reads as a product rather than as a wall
 * of "protegido": **every department must hold at least 5 people**, because the floor is
 * applied at write time against the department's population
 * (`SurveyResponsePrivacy.DepartmentFor`), so a department of 4 records no department at all
 * and can never disclose, however many people answer. `seed-demo-company.test.mjs` asserts it.
 */
export const PROFILES = {
  meridiano: {
    domain: 'meridiano.test',
    company: { name: 'Grupo Meridiano S.A.', industry: 'Servicios', size: 'medium', country: 'Costa Rica' },
    departments: [
      ['Ingeniería', 'Desarrollo de producto y plataforma'],
      ['Finanzas', 'Finanzas y contabilidad'],
      ['Operaciones', 'Operaciones y logística'],
      ['Personas', 'Talento humano y cultura'],
      ['Ventas', 'Equipos comerciales regionales'],
    ],
    headcount: { Ingeniería: 10, Finanzas: 5, Operaciones: 6, Personas: 6, Ventas: 6 },
    admin: ['Ana Rojas', 'ana.rojas'],
    leaders: [
      ['Luis Mora', 'luis.mora', 'leader', 'Ingeniería'],
      ['Carla Jiménez', 'carla.jimenez', 'leader', 'Finanzas'],
      ['Marco Castro', 'marco.castro', 'leader', 'Operaciones'],
      ['Elena Quesada', 'elena.quesada', 'leader', 'Personas'],
      ['Pablo Solís', 'pablo.solis', 'leader', 'Ventas'],
      ['Sofía Vargas', 'sofia.vargas', 'supervisor', 'Ingeniería'],
    ],
    demoEmployee: ['Diego Solano', 'diego.solano', 'employee', 'Ingeniería'],
    plans: [
      ['Programa de reconocimiento entre pares', 'Peer recognition programme', 'Personas', 20, 'high'],
      ['Reducir la carga de trabajo en Operaciones', 'Reduce the workload in Operations', 'Operaciones', 35, 'high'],
      ['Plan de desarrollo de carrera en Ingeniería', 'Career development plan in Engineering', 'Ingeniería', 60, 'medium'],
      ['Reuniones abiertas con la dirección', 'Open meetings with leadership', null, 45, 'medium'],
    ],
  },

  /**
   * A demonstration tenant for PROCOMER, the Costa Rican trade-promotion agency.
   *
   * **The name says "Demostración" and the domain is `.test` on purpose.** A tenant in
   * production that is indistinguishable from the real client is a tenant whose fabricated
   * results get read as real ones later; and `.test` is reserved by RFC 2606, so no mail this
   * tenant could ever emit can reach a real inbox. Override both with `--company-name` and
   * `--domain` if the demo needs it, understanding what each one buys.
   *
   * The units are plausible for a trade-promotion agency rather than taken from Procomer's own
   * chart, which we do not have — Diego owes the preliminary organisational structure. They are
   * what Procomer's documents call **nodos**; the product calls them departments.
   */
  procomer: {
    domain: 'procomer.test',
    company: { name: 'PROCOMER — Demostración', industry: 'Servicios', size: 'medium', country: 'Costa Rica' },
    departments: [
      ['Promoción Comercial', 'Promoción de exportaciones y desarrollo de mercados'],
      ['Ventanilla Única de Comercio Exterior', 'Trámites y servicios al exportador'],
      ['Inversión y Encadenamientos', 'Atracción de inversión y encadenamientos productivos'],
      ['Servicios Corporativos', 'Administración, finanzas y gestión de personas'],
      ['Tecnologías de Información', 'Plataformas y servicios digitales'],
    ],
    headcount: {
      'Promoción Comercial': 14,
      'Ventanilla Única de Comercio Exterior': 12,
      'Inversión y Encadenamientos': 12,
      'Servicios Corporativos': 12,
      'Tecnologías de Información': 6,
    },
    /**
     * The demographic fields this tenant answers, and how many of each department's
     * respondents sit at `puesto: gerencia`.
     *
     * ## Without this block the demographic crosses render NOTHING
     *
     * A response's demographics are not invented when it is submitted: `CaptureDemographicsAsync`
     * copies them from the respondent's stored `user_demographics`
     * (`SurveyResponseEndpoints.cs:812`). So a tenant whose people carry no demographic values
     * produces responses with none, every demographic breakdown comes back empty, and
     * `crossFieldsOf` — which offers only fields the payload already lists — offers nothing.
     * The panel then returns `null` and the feature is invisible. Departments still work,
     * because a department is a column on the response rather than a demographic.
     *
     * ## Why these counts, exactly
     *
     * A cross is answered only when EVERY selector survives `SurveyResultsFilter.MayDisclose`,
     * which runs the breakdown's own complement withholding per selector against the scope the
     * other selectors define. For `puesto:gerencia + department:D` that is two conditions at
     * once:
     *
     *  - inside D's respondents, every `puesto` cohort is 0 or >= 5, so no subtractable
     *    remainder is left for the complement rule to withhold against; and
     *  - across departments, every department cohort of `gerencia` is 0 or >= 5.
     *
     * Hence respondents of 12/10/10/10 split evenly down the middle, and Tecnologías de
     * Información deliberately carrying NO gerencia at all — that one cross comes back
     * protected, which is the honest half of the demonstration rather than a gap in it.
     *
     * `gerencia` is counted against RESPONDENTS, not headcount, and the values are assigned in
     * `orderedEmployeesOf`'s order — the same order `seed-surveys.mjs` takes its respondents in.
     * That is what makes "5 of the 10 who answered are gerencia" true rather than probable.
     * `seed-demo-company.test.mjs` computes both conditions from these numbers against that
     * script's respondent counts, so an edit that breaks a cross fails a test instead of a demo.
     *
     * ## `required: false`, deliberately
     *
     * The seeder sets every value explicitly, so enforcement buys nothing — and a REQUIRED
     * field is enforced on paths the demo also uses: `PUT /admin/users/{id}` validates with
     * `enforceRequired: true`, and `InvitationAcceptEndpoints` writes demographics when an
     * invitation is accepted. Marking these required would make this tenant's shape leak into
     * flows that have nothing to do with the crosses.
     *
     * Both are `select`. A `number` field never splits into cohorts, which is half of why the
     * live TIMS survey shows no crosses: its `edad` and `tiempo_de_laborar` are numbers.
     */
    demographics: {
      fields: [
        {
          field: 'puesto',
          order: 1,
          type: 'select',
          required: false,
          label: { es: 'Puesto', en: 'Role level' },
          options: [
            { value: 'gerencia', label: { es: 'Jefaturas y gerencias', en: 'Managers and leads' } },
            { value: 'colaborador', label: { es: 'Personal colaborador', en: 'Individual contributors' } },
          ],
        },
        {
          field: 'antiguedad',
          order: 2,
          type: 'select',
          required: false,
          // The bands from the call of 8 Oct, as the client said them. Their one-dimensional
          // breakdown discloses; crossed with a department they do not, because a department of
          // 12 split three ways holds no cohort of 5. That is the floor working, and the demo
          // is better for showing it than for hiding it.
          label: { es: 'Años de servicio', en: 'Years of service' },
          options: [
            { value: '0-1', label: { es: 'Menos de 1 año', en: 'Under 1 year' } },
            { value: '1-4', label: { es: 'De 1 a 4 años', en: '1 to 4 years' } },
            { value: '5+', label: { es: '5 años o más', en: '5 years or more' } },
          ],
        },
      ],
      gerencia: {
        'Promoción Comercial': 6,
        'Ventanilla Única de Comercio Exterior': 5,
        'Inversión y Encadenamientos': 5,
        'Servicios Corporativos': 5,
        'Tecnologías de Información': 0,
      },
    },
    admin: ['Marcela Induni', 'marcela.induni'],
    leaders: [
      ['Rodrigo Esquivel', 'rodrigo.esquivel', 'leader', 'Promoción Comercial'],
      ['Alejandra Bonilla', 'alejandra.bonilla', 'leader', 'Ventanilla Única de Comercio Exterior'],
      ['Fernando Lizano', 'fernando.lizano', 'leader', 'Inversión y Encadenamientos'],
      ['Gabriela Vega', 'gabriela.vega', 'leader', 'Servicios Corporativos'],
      ['Mauricio Rojas', 'mauricio.rojas', 'leader', 'Tecnologías de Información'],
      ['Tatiana Núñez', 'tatiana.nunez', 'supervisor', 'Promoción Comercial'],
    ],
    demoEmployee: ['Andrea Picado', 'andrea.picado', 'employee', 'Promoción Comercial'],
    plans: [
      ['Fortalecer el reconocimiento al desempeño', 'Strengthen performance recognition', 'Servicios Corporativos', 20, 'high'],
      ['Equilibrar la carga en Ventanilla Única', 'Balance the workload in the single window', 'Ventanilla Única de Comercio Exterior', 35, 'high'],
      ['Ruta de desarrollo para Promoción Comercial', 'Development path for trade promotion', 'Promoción Comercial', 60, 'medium'],
      ['Espacios abiertos con la dirección', 'Open spaces with leadership', null, 45, 'medium'],
    ],
  },
}

export function profileFor(name) {
  const profile = PROFILES[name]
  if (!profile) throw new Error(`unknown --profile ${name} (have: ${Object.keys(PROFILES).join(', ')})`)
  return profile
}

const PROFILE = profileFor(values.profile)
const DOMAIN = values.domain ?? PROFILE.domain
const COMPANY = { ...PROFILE.company, name: values['company-name'] ?? PROFILE.company.name, emailDomain: DOMAIN }
const DEPARTMENTS = PROFILE.departments
const ADMIN_LOCAL = PROFILE.admin[1]

const PEOPLE = [
  [PROFILE.admin[0], PROFILE.admin[1], 'company_admin', null],
  ...PROFILE.leaders,
]
const FIRST = ['María', 'José', 'Laura', 'Andrés', 'Valeria', 'Daniel', 'Camila', 'Esteban', 'Paula', 'Gabriel', 'Natalia', 'Sebastián', 'Fernanda', 'Alejandro', 'Mariana', 'Ricardo', 'Isabel', 'Javier', 'Adriana', 'Rodrigo', 'Carolina', 'Felipe', 'Daniela', 'Óscar', 'Lucía', 'Mauricio', 'Verónica', 'Ignacio', 'Patricia', 'Jorge', 'Silvia', 'Roberto', 'Melissa']
const LAST = ['Chaves', 'Alvarado', 'Salas', 'Brenes', 'Campos', 'Zúñiga', 'Ramírez', 'Arias', 'Herrera', 'Montero', 'Céspedes', 'Villalobos', 'Umaña', 'Guzmán', 'Barrantes', 'Sandoval', 'Méndez', 'Cordero', 'Fallas', 'Ulate', 'Araya', 'Segura', 'Bolaños', 'Madrigal', 'Espinoza', 'Retana', 'Coto', 'Marín', 'Porras', 'Vindas', 'Aguilar', 'Pacheco', 'Leiva']
const HEADCOUNT = PROFILE.headcount
/**
 * The nth generated employee's display name and email local part.
 *
 * `+ floor(n / LAST.length)` shifts the surname by one on each wrap of the first-name list.
 * Without it the (first, last) PAIR repeats with period 33 — both lists are 33 long and 7 is
 * coprime to 33 — so the 34th employee regenerates the 1st one's name and `POST /auth/signup`
 * answers **409 User with this email already exists**, half-way through seeding. Meridiano has
 * exactly 33 employees and never hit it; the first profile with more did, immediately. The
 * term is 0 for every n < 33, so Meridiano's addresses are unchanged.
 */
export function personAt(n) {
  const first = FIRST[n % FIRST.length]
  const last = LAST[(n * 7 + Math.floor(n / LAST.length)) % LAST.length]
  return { name: `${first} ${last}`, local: `${first}.${last}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }
}

let n = 0
for (const [department, count] of Object.entries(HEADCOUNT)) {
  for (let i = 0; i < count; i++, n++) {
    const { name, local } = personAt(n)
    PEOPLE.push([name, local, 'employee', department])
  }
}
/** Created in the `content` phase so `seed-surveys.mjs` never resets this password. */
const DEMO_EMPLOYEE = PROFILE.demoEmployee

async function signupOrFind(person, users, superToken, companyId) {
  const [name, local, role, department] = person
  const email = `${local}@${DOMAIN}`
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

/**
 * Define the company's demographic fields and answer them for every seeded employee.
 *
 * A no-op for a profile that declares none, which is how Meridiano stays unchanged.
 *
 * The `PUT` is unconditional rather than diffed first. `ReplaceForUserAsync` replaces a user's
 * values wholesale, so writing the same values twice lands in the same state, and the
 * alternative — a `GET /admin/users/{id}` per person to compare — is one request per employee
 * to avoid a request per employee. The list endpoint cannot help: `UserListItem` carries no
 * demographics.
 */
async function seedDemographics(companyId, byName, superToken) {
  const plan = PROFILE.demographics
  if (!plan) return

  const { fields: existingFields } = await json(`${API}/admin/demographic-fields?companyId=${companyId}`, {}, superToken)
  const haveField = new Set((existingFields ?? []).map((f) => f.field))
  for (const field of plan.fields) {
    if (haveField.has(field.field)) continue
    await post(`${API}/admin/demographic-fields`, { companyId, ...field }, superToken)
    log(`  + demographic field ${field.field} (${field.options.map((o) => o.value).join(', ')})`)
  }

  const { users } = await json(`${API}/admin/users?companyId=${companyId}`, {}, superToken)
  const tally = {}
  for (const [name] of DEPARTMENTS) {
    const departmentId = byName.get(name).id
    const members = orderedEmployeesOf(users, departmentId)
    const gerencia = plan.gerencia[name] ?? 0
    for (let i = 0; i < members.length; i++) {
      const assigned = demographicsFor(i, gerencia)
      await put(`${API}/admin/users/${members[i].id}`, { demographics: assigned }, superToken)
      tally[assigned.puesto] = (tally[assigned.puesto] ?? 0) + 1
    }
    log(`  demographics: ${name} -> ${members.length} people, ${Math.min(gerencia, members.length)} gerencia`)
  }
  log(`demographics assigned: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')}`)
}

async function phaseCompany() {
  const superToken = await login(values.superEmail, values.superPassword)
  const companies = await json(`${API}/admin/companies`, {}, superToken)
  let company = (companies.companies ?? companies).find((c) => c.emailDomain === DOMAIN)
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
  // AFTER the department assignments above and BEFORE seed-surveys.mjs runs: a response
  // copies the respondent's demographics at completion, so a value assigned later never
  // reaches a response that already exists.
  await seedDemographics(companyId, byName, superToken)

  log(`people in place: ${PEOPLE.length}. Next: node scripts/seed-surveys.mjs --email ${ADMIN_LOCAL}@${DOMAIN} --password ${values.password}`)
}

async function phaseContent() {
  const admin = await login(`${ADMIN_LOCAL}@${DOMAIN}`, values.password)
  const profile = await json(`${API}/profile`, {}, admin)
  const companyId = profile.companyId
  const { departments } = await json(`${API}/admin/departments?companyId=${companyId}`, {}, admin)
  const dept = (name) => departments.find((d) => d.name === name)?.id ?? null

  const { actionPlans } = await json(`${API}/action-plans?companyId=${companyId}`, {}, admin)
  const PLANS = PROFILE.plans
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
  log(`demo employee ready: ${DEMO_EMPLOYEE[1]}@${DOMAIN} / ${values.password}`)
}

// Guarded like `import-climate-workbook.mjs`, so `seed-demo-company.test.mjs` can import the
// profiles without seeding anything.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (values.phase === 'company') await phaseCompany()
  else if (values.phase === 'content') await phaseContent()
  else throw new Error(`unknown --phase ${values.phase}`)
}
