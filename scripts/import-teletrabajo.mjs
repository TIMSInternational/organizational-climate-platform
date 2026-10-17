/**
 * Import ESPH's teletrabajadores and create the Teletrabajo survey aimed at exactly them.
 *
 *   node scripts/import-teletrabajo.mjs --domain esph-sa.com --new-department 'Junta Directiva' \
 *     --start 2026-10-19T14:00:00Z --end 2026-10-27T05:59:00Z \
 *     --api https://api.climate.timsint.com --email <super-admin> --password <pw> [--apply]
 *
 * Review by default: without `--apply` it reads, compares against the company as it actually
 * is, prints every decision it would take, and writes nothing. `--apply` WRITES and SENDS MAIL
 * (credential emails for the accounts it creates, then the survey's invitations).
 *
 * ## Why this is not `import-climate-workbook.mjs`
 *
 * That script reads a TIMS four-sheet workbook and creates a company, its demographic fields,
 * its people and a survey built from the workbook's own questions. Teletrabajo has none of that
 * shape: the people are a raw client roster, the company and its fields already exist from the
 * Clima import, and the instrument is a hand-built payload (`build_teletrabajo.py`) because its
 * numbering is broken and its four answer scales cannot be parsed. What is left is the two steps
 * below, and the reason they are one script is that step 2 must refuse unless step 1 reached
 * every single person.
 *
 * ## Phase 1 — the people
 *
 * `POST /admin/users/bulk-import/rows` with `withCredentials: true`, which writes a real `User`
 * with a generated username and password (BulkImportEndpoints.cs:358) rather than an invitation
 * — so the ids phase 2 needs exist the moment it returns.
 *
 * Most of the roster is already in the company from the Clima import. Those rows come back
 * `duplicate` and are NOT re-sent: a duplicate is never written, so its demographics would be
 * ignored anyway, and sending them is not free — see the next paragraph.
 *
 * ## Phase 1's trap: a value outside a select field's options is a HARD ERROR
 *
 * `DemographicValueValidation` refuses a value the field does not list, which makes the row
 * `status: "error"` — and the `already_user` issue is in the same else-if chain, so a person who
 * already exists AND carries an unlisted value is reported as an error rather than a duplicate.
 * The fields were created by the Clima import from the Clima roster's values, and the
 * Teletrabajo roster holds values it never saw. Measured on ESPH, 2026-10-16:
 *
 *     proceso   'Junta Directiva', 'Proyectos',
 *               'Servicio al Cliente y Mercadeo - Servicio al Cliente'   (5 of the 17 new rows)
 *     jefatura  'Junta Directiva', 'Strunz Romanini Hans'
 *
 * Ruled 2026-10-17: they are ADDED to the fields, because the alternative is recording no
 * Proceso for a person who has one. The merge reuses `mergeFieldOptions`/`existingOptionInputs`
 * from the climate importer — one rule for both imports — and only ever appends.
 *
 * ## Phase 2 — the survey, aimed at people and not at departments
 *
 * `POST /surveys` with `userIds`, the per-person targeting of #587. Departments cannot express
 * this audience: the 240 sit in nine of them and a department-based audience resolved to all
 * 625, so 402 people would have been shown a survey that is not theirs. Every email in the
 * roster must resolve to a user id or the survey is NOT created — a survey quietly aimed at 239
 * people is the failure this script exists to prevent.
 *
 * `notificationSendInvitations` is forced to `true`: the built payload carries `false`, which
 * mints invitation rows and queues no mail. And per-person completion tracking hangs entirely on
 * those invitation rows, with no backfill — answering before being invited leaves a person
 * outstanding forever (`SurveyResponseEndpoints.cs:816`).
 *
 * ## It must run AFTER the clima import, and not only for the accounts
 *
 * `BulkImportEndpoints` gives every account it creates the COMPANY's language, and that field
 * is the first thing each message to that person is resolved against — including every reminder
 * subject, which no survey can override. The company's language is set by
 * `import-climate-workbook.mjs`, and it cannot be read back through the API (there is no GET for
 * it), so this script cannot check it: run the clima import first and read ITS
 * `company language set:` line.
 *
 * The survey is created as a DRAFT. Programar it in the product (never Activar) and then send
 * its invitations: 240 is under the 500 batch cap, so it goes in one.
 */
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { readWorkbook, slug, roleForTitle, mergeFieldOptions, existingOptionInputs, chunkRows, IMPORT_CHUNK_ROWS } from './import-climate-workbook.mjs'

const log = (line) => process.stdout.write(`${line}\n`)
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * `_x000D_` is a literal OOXML escape, not a carriage return: three ESPH addresses in the Clima
 * roster arrived as `foo@bar.com_x000D_\r\n` from a paste with a line break, and `.trim()`
 * removes the newline while leaving the seven characters glued to the address. Three accounts
 * that could never receive mail. Cleaned here for every cell, not just for emails.
 */
export const clean = (value) =>
  value === null || value === undefined ? '' : String(value).replace(/_x[0-9A-Fa-f]{4}_|[\x00-\x1f\x7f]/g, '').trim()

const norm = (text) => clean(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The roster's columns, matched by their header text rather than by position.
 *
 * `build_esph.py` reads the same file by letter (D, F, G, H, I, J, K, L, M). A re-exported
 * roster with one column inserted would then read a different field for every person and look
 * completely normal — the same silent failure its EMAIL_FALLBACKS map is keyed by row AND name
 * to avoid. Matching the header means a moved column still reads right and a RENAMED one stops
 * the run.
 */
export const ROSTER_COLUMNS = {
  name: 'nombre del trabajador',
  email: 'correo electronico',
  edad: 'edad',
  genero: 'genero',
  antiguedad: 'anos de laborar en la empresa',
  puesto: 'tipo de puesto',
  department: 'macroproceso',
  proceso: 'proceso',
  jefatura: 'nombre de la jefatura',
}

/** Two rows of the Clima roster spell it without the hyphen. Same fix, same reason. */
const PUESTO = { 'Técnico Operativo': 'Técnico-Operativo' }

/**
 * The bands are the TEMPLATE's own dropdown labels, which is what the Clima import turned into
 * this company's options — so these two functions must agree with `build_esph.py` exactly. A
 * band spelled differently here is not a cosmetic difference: it is a value outside the field's
 * options, i.e. a refused row.
 */
export function edadBand(raw) {
  const text = clean(raw)
  const value = Number(text.replace(',', '.'))
  if (text === '' || !Number.isFinite(value)) return 'Prefiero no indicar'
  const years = Math.trunc(value)
  if (years < 18 || years > 100) return 'Prefiero no indicar'
  return years < 25 ? 'Menos de 25' : years <= 34 ? '25 a 34' : years <= 44 ? '35 a 44' : years <= 54 ? '45 a 54' : '55 o más'
}

export function antiguedadBand(raw) {
  const text = clean(raw)
  const value = Number(text.replace(',', '.'))
  if (text === '' || !Number.isFinite(value)) return 'Prefiero no indicar'
  return value < 1 ? 'Menos de 1 año' : value <= 3 ? '1 a 3 años' : value <= 6 ? '4 a 6 años' : value <= 10 ? '7 a 10 años' : 'Más de 10 años'
}

/**
 * The roster as people. Problems are collected rather than thrown so one run reports all of
 * them; the caller refuses on any.
 */
export function parseRoster(cells, { sheet = 'the roster' } = {}) {
  const problems = []
  const lastRow = Math.max(0, ...Object.keys(cells).map((ref) => Number(ref.replace(/^[A-Z]+/, ''))))
  const letters = {}
  for (const ref of Object.keys(cells)) {
    if (Number(ref.replace(/^[A-Z]+/, '')) !== 1) continue
    const header = norm(cells[ref]?.value)
    for (const [field, want] of Object.entries(ROSTER_COLUMNS)) {
      if (header !== want) continue
      if (letters[field]) problems.push(`${sheet}: two columns are headed "${want}" (${letters[field]} and ${ref.replace(/\d+$/, '')}).`)
      letters[field] = ref.replace(/\d+$/, '')
    }
  }
  for (const [field, want] of Object.entries(ROSTER_COLUMNS)) {
    if (!letters[field]) problems.push(`${sheet}: no column headed "${want}" (needed for ${field}).`)
  }
  if (problems.length) return { problems, people: [] }

  const at = (field, row) => clean(cells[`${letters[field]}${row}`]?.value)
  const people = []
  const seen = new Map()
  for (let row = 2; row <= lastRow; row += 1) {
    const name = at('name', row)
    const email = at('email', row).toLowerCase()
    if (!name && !email) continue
    if (!name) { problems.push(`${sheet} row ${row}: ${email || 'a row'} has no name.`); continue }
    // No email is not a row to skip quietly: the survey is aimed at people by id, so a person
    // without an address cannot be given an account, cannot be targeted, and would silently
    // shrink the audience.
    if (!email) { problems.push(`${sheet} row ${row}: ${name} has NO EMAIL — cannot be given an account or be targeted.`); continue }
    if (!EMAIL.test(email)) { problems.push(`${sheet} row ${row}: ${name} has an invalid email ("${email}").`); continue }
    if (seen.has(email)) { problems.push(`${sheet} row ${row}: ${name} <${email}> is the same address as row ${seen.get(email).row} (${seen.get(email).name}).`); continue }
    seen.set(email, { row, name })
    const department = at('department', row)
    if (!department) problems.push(`${sheet} row ${row}: ${name} has no ${ROSTER_COLUMNS.department}.`)
    const puesto = at('puesto', row)
    people.push({
      row,
      name,
      email,
      puesto: PUESTO[puesto] ?? puesto,
      department,
      demographics: {
        genero: at('genero', row),
        antiguedad: antiguedadBand(at('antiguedad', row)),
        rango_de_edad: edadBand(at('edad', row)),
        proceso: at('proceso', row),
        jefatura: at('jefatura', row),
      },
    })
  }
  if (people.length === 0) problems.push(`${sheet}: no people (headers on row 1, people from row 2).`)
  return { problems, people }
}

/**
 * A person as a bulk-import row, with the demographic values formatted the way
 * `toImportRows` formats them for the climate importer: a select's value is the slug, a
 * number's is the plain number. A field the company does not have is dropped — `fields` is
 * what the company actually carries, read live.
 */
export function toImportRow(person, fields) {
  const demographics = {}
  for (const [key, raw] of Object.entries(person.demographics)) {
    const field = fields.find((f) => f.field === key)
    if (!field || raw === '' || raw === null || raw === undefined) continue
    demographics[key] = field.type === 'select' ? slug(String(raw)) : String(raw).trim().replace(',', '.')
  }
  return {
    rowNumber: person.row,
    name: person.name,
    email: person.email,
    role: roleForTitle(person.puesto),
    department: person.department,
    demographics,
  }
}

/**
 * Who already has an account and who does not.
 *
 * The split is computed from the company's own user list rather than discovered from the
 * preview, because it decides which rows carry demographics: an existing person's are never
 * written (the duplicate branch returns before the write), so sending them buys nothing and
 * risks turning a `duplicate` into an `error`.
 */
export function splitByExisting(people, existingEmails) {
  const have = new Set([...existingEmails].map((email) => String(email).toLowerCase()))
  return {
    existing: people.filter((person) => have.has(person.email)),
    fresh: people.filter((person) => !have.has(person.email)),
  }
}

/** Every demographic value on these people that its field does not list, by field. */
export function unknownValues(people, fields) {
  const unknown = new Map()
  for (const person of people) {
    for (const [key, raw] of Object.entries(person.demographics)) {
      if (raw === '' || raw === null || raw === undefined) continue
      const field = fields.find((f) => f.field === key)
      if (!field || field.type !== 'select') continue
      const value = slug(String(raw))
      if ((field.options ?? []).some((option) => option.value === value)) continue
      const byField = unknown.get(key) ?? new Map()
      const who = byField.get(String(raw)) ?? []
      who.push(person)
      byField.set(String(raw), who)
      unknown.set(key, byField)
    }
  }
  return unknown
}

/**
 * The rows the preview refused, split into the ones that are a problem and the ones that are not.
 *
 * A review run writes nothing, so it has NOT added the missing options yet — and the preview
 * validates against the field as it stands, so every row carrying a value this run would add
 * comes back `error`. Under `--apply` the options are added FIRST and those same rows are
 * `valid`. Before this split, a review run against ESPH's own roster printed "the preview
 * refused 5 row(s) — nothing was imported" and exited 1, for a run that would have worked —
 * found by running it against a local copy of the real company, 2026-10-17.
 *
 * Recognised by the issue CODE rather than the message text, and only for a person who actually
 * carries one of the pending values: a row with any OTHER problem — a bad address, an unknown
 * department, a second problem beside the value — stays a refusal. `optionsAlreadyAdded` is what
 * stops this hiding a real defect: once the options exist nothing is deferred, so an apply run
 * that still sees `invalid_demographic` reports it.
 */
export function splitRefusals(previewRows, pendingValueEmails, optionsAlreadyAdded) {
  const PRESENT = new Set(['already_invited', 'already_user'])
  const refused = []
  const deferred = []
  for (const row of previewRows ?? []) {
    const issues = row.issues ?? []
    const errors = row.errors ?? []
    const isRefusal = row.status === 'error' || (errors.length > 0 && !issues.every((issue) => PRESENT.has(issue.code)))
    if (!isRefusal) continue
    const onlyUnlistedValue = issues.length > 0 && issues.every((issue) => issue.code === 'invalid_demographic')
    const holdsPendingValue = pendingValueEmails.has(String(row.email ?? '').toLowerCase())
    if (!optionsAlreadyAdded && onlyUnlistedValue && holdsPendingValue) deferred.push(row)
    else refused.push(row)
  }
  return { refused, deferred }
}

/**
 * The roster's departments against the company's, matched the way the server matches them:
 * `departments.FirstOrDefault(d => d.Name == row.Department)` is ORDINAL and case-SENSITIVE
 * (BulkImportEndpoints.cs:255), while the approved-new list is case-INSENSITIVE and drops any
 * name that case-insensitively equals one the company already has (`:159-164`).
 *
 * So a roster department differing from an existing one only in case or accent cannot be
 * imported at all: it matches nothing, and approving it as new is ignored because it collides
 * with the real one — the row just comes back `department_not_found`. That is a `conflict` here
 * and it stops the run, because the two ways it could be "fixed" are both wrong: creating a
 * near-twin splits one department's audience in two, and dropping the department leaves the
 * person unplaced.
 */
export function classifyDepartments(people, departments) {
  const exact = new Set(departments.map((d) => d.name ?? d))
  const loose = new Map(departments.map((d) => [norm(d.name ?? d), d.name ?? d]))
  const missing = []
  const conflicts = []
  for (const name of new Set(people.map((p) => p.department).filter(Boolean))) {
    if (exact.has(name)) continue
    const near = loose.get(norm(name))
    if (near) conflicts.push({ roster: name, existing: near })
    else missing.push(name)
  }
  return { missing, conflicts }
}

/** The payload, with everything this script decides written over whatever the file carried. */
export function toSurveyBody(payload, { companyId, startDate, endDate, userIds }) {
  return {
    ...payload,
    companyId,
    startDate,
    endDate,
    userIds,
    departmentIds: [],
    // The STATED audience, which is a different number from the resolved one and the only
    // denominator the RESULTS screen will use. `SurveyResultsSummary.ParticipationRate` is
    // "completed / invited" where invited is `targetAudienceCount`, and it is deliberately
    // NULL rather than fabricated when the survey has none -- so without this the results
    // screen shows NO participation rate at all for a 240-person survey. Measured locally
    // on 2026-10-17: Clima states 617 and prints a rate, Teletrabajo stated nothing and
    // printed `participationRate: null`. `import-climate-workbook.mjs` has always set it.
    targetAudienceCount: userIds.length || null,
    settings: { ...(payload.settings ?? {}), notificationSendInvitations: true },
  }
}

const titleOf = (value) => (typeof value === 'string' ? value : value?.es ?? value?.en ?? '')

async function main() {
  const { values } = parseArgs({
    options: {
      roster: { type: 'string', default: `${process.env.HOME}/Downloads/Lista trabajadores Teletrabajo ESPH (14-09-2026).xlsx` },
      sheet: { type: 'string', default: 'Teletrabajo' },
      survey: { type: 'string', default: `${process.env.HOME}/Desktop/TIMS-NEXA-Clima/teletrabajo-survey.json` },
      'company-id': { type: 'string' },
      domain: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      expect: { type: 'string', default: '240' },
      'new-department': { type: 'string', multiple: true, default: [] },
      phase: { type: 'string', default: 'both' },
      api: { type: 'string', default: 'http://localhost:5000' },
      email: { type: 'string' },
      password: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  })
  const need = (name, value) => { if (!value) throw new Error(`--${name} is required`) }
  need('email', values.email)
  need('password', values.password)
  need('start', values.start)
  need('end', values.end)
  if (!values['company-id'] && !values.domain) throw new Error('--company-id or --domain is required')
  if (values['company-id'] && !GUID.test(values['company-id'])) throw new Error('--company-id is not a GUID')
  if (!['both', 'people', 'survey'].includes(values.phase)) throw new Error('--phase must be both, people or survey')
  const expect = Number(values.expect)
  if (!Number.isInteger(expect) || expect < 1) throw new Error('--expect must be a positive whole number')
  for (const iso of [values.start, values.end]) {
    if (Number.isNaN(Date.parse(iso))) throw new Error(`not a date: ${iso}`)
  }
  if (Date.parse(values.end) <= Date.parse(values.start)) throw new Error('--end is not after --start')

  // ---- the roster, offline ----
  const sheets = readWorkbook(values.roster)
  const cells = sheets[values.sheet.toUpperCase()]
  if (!cells) throw new Error(`no sheet "${values.sheet}" in ${values.roster} (it has: ${Object.keys(sheets).join(', ')})`)
  const { problems, people } = parseRoster(cells, { sheet: values.sheet })
  log(`roster   : ${values.roster}`)
  log(`sheet    : ${values.sheet} — ${people.length} people read`)
  if (problems.length) {
    log(`\n${problems.length} problem(s) in the roster — nothing was read as importable:`)
    for (const problem of problems) log(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  // The audience is the whole roster. A roster that is not the size it was approved at is a
  // different audience, and the one thing this script must never do is target fewer people
  // than were agreed without saying so.
  if (people.length !== expect) {
    log(`\nthe roster holds ${people.length} people, --expect says ${expect} — refusing.`)
    log('  Re-run with --expect set to the number this roster is meant to hold, once you know why it changed.')
    process.exitCode = 1
    return
  }
  const leaders = people.filter((p) => roleForTitle(p.puesto) === 'leader')
  log(`roles    : ${people.length - leaders.length} employee, ${leaders.length} leader`)
  log(`window   : ${values.start} → ${values.end}`)
  log(values.apply ? 'mode     : *** APPLY — this WRITES and SENDS EMAIL ***' : 'mode     : review only, nothing is written and nothing is sent')

  const API = values.api
  const call = async (method, path, body, token) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* reported below */ }
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 400)}`)
    return json
  }

  const { token } = await call('POST', '/auth/login', { email: values.email, password: values.password })
  if (!token) throw new Error('login returned no token')
  log(`\nsigned in as ${values.email}`)

  // ---- the company as it actually is ----
  let companyId = values['company-id']
  if (!companyId) {
    const listed = await call('GET', '/admin/companies', null, token)
    const found = (listed.companies ?? listed).find((c) => c.emailDomain?.toLowerCase() === values.domain.toLowerCase())
    if (!found) throw new Error(`no company with domain ${values.domain} — run the clima import first`)
    companyId = found.id
    log(`company  : ${found.name} (${companyId})`)
  } else {
    log(`company  : ${companyId}`)
  }

  const [departmentsBody, fieldsEsBody, fieldsEnBody, usersBody] = await Promise.all([
    call('GET', `/admin/departments?companyId=${companyId}`, null, token),
    call('GET', `/admin/demographic-fields?companyId=${companyId}&lang=es`, null, token),
    call('GET', `/admin/demographic-fields?companyId=${companyId}&lang=en`, null, token),
    call('GET', `/admin/users?companyId=${companyId}`, null, token),
  ])
  const departments = (departmentsBody.departments ?? departmentsBody).filter((d) => d.isActive !== false)
  const fields = fieldsEsBody.fields ?? []
  const fieldsEn = new Map((fieldsEnBody.fields ?? []).map((f) => [f.field, f]))
  const users = usersBody.users ?? usersBody
  log(`company has: ${departments.length} departments, ${fields.length} demographic fields, ${users.length} users`)

  const { existing, fresh } = splitByExisting(people, users.map((u) => u.email))
  log(`\nthe ${people.length}: ${existing.length} already have an account, ${fresh.length} do not`)

  // ---- departments ----
  // Classified over EVERY row, not just the new ones: the server validates the department of
  // each row in the request, and an unknown one is an error that comes before the duplicate
  // branch. A department only an existing person names is still named in `newDepartments` so
  // the row passes, and is still not created — the endpoint creates one only for a row it is
  // actually writing (`:341-350`).
  const { missing, conflicts } = classifyDepartments(people, departments)
  if (conflicts.length) {
    log(`\n${conflicts.length} department name(s) differ from the company's only in case or accent — refusing:`)
    for (const { roster, existing } of conflicts) log(`  - the roster says "${roster}", the company has "${existing}"`)
    log('  The server matches the name exactly, so these rows cannot be imported, and approving')
    log('  them as new would create a near-twin that splits one department in two. Fix the roster')
    log('  (or rename the department in the product) so the two spellings agree.')
    process.exitCode = 1
    return
  }
  const approved = new Set(values['new-department'].map((name) => norm(name)))
  const unapproved = missing.filter((name) => !approved.has(norm(name)))
  if (unapproved.length) {
    log(`\n${unapproved.length} department(s) this roster needs do not exist and were not approved — refusing:`)
    for (const name of unapproved) log(`  - "${name}"  (${people.filter((p) => p.department === name).length} person(s), ${fresh.filter((p) => p.department === name).length} of them new)`)
    log('  Creating a department is a decision, not a side effect: pass --new-department for each one you intend.')
    process.exitCode = 1
    return
  }
  for (const name of missing) {
    const creating = fresh.filter((p) => p.department === name).length
    log(creating > 0
      ? `department to create: "${name}" (${creating} new person(s) are placed in it)`
      : `department NOT created: "${name}" — only people who already have an account name it, and their placement is not changed`)
  }
  for (const name of values['new-department'].filter((n) => !missing.some((m) => norm(m) === norm(n)))) {
    log(`  note: --new-department "${name}" matches nothing this roster needs; it will NOT be created`)
  }

  // A demographic column the company has no field for cannot be recorded by this script, and
  // creating one is the climate importer's job, not this one's. Said out loud rather than
  // dropped, which is how a column goes missing without anybody noticing.
  for (const key of Object.keys(people[0].demographics)) {
    if (!fields.some((f) => f.field === key)) log(`  ⚠️ the company has no "${key}" demographic field — that value will NOT be recorded for anyone`)
  }

  // ---- demographic values the fields do not list ----
  // Only the rows being created matter: a duplicate is never written, so it is not sent with
  // demographics at all and its values cannot refuse it.
  const unknown = unknownValues(fresh, fields)
  const updates = []
  if (unknown.size) {
    log('\nvalues these fields do not list yet:')
    for (const [key, byValue] of unknown) {
      const field = fields.find((f) => f.field === key)
      const added = [...byValue.keys()].map((label) => ({ value: slug(label), label: { es: label, en: label } }))
      const merge = mergeFieldOptions(existingOptionInputs(field, fieldsEn.get(key)), added)
      if (!merge) continue
      updates.push({ field, merge })
      log(`  ${key}: ${(field.options ?? []).length} → ${merge.options.length} options`)
      for (const [label, who] of byValue) log(`     + "${label}"  (${who.length}: ${who.map((p) => p.name).join(', ')})`)
    }
  }

  if (values.phase !== 'survey') {
    // ---- phase 1 ----
    if (values.apply) {
      for (const { field, merge } of updates) {
        const updated = await call('PUT', `/admin/demographic-fields/${field.id}`, { options: merge.options }, token)
        if ((updated?.options ?? []).length !== merge.options.length) throw new Error(`field ${field.field}: PUT returned ${(updated?.options ?? []).length} options, expected ${merge.options.length}`)
        log(`field extended: ${field.field} — ${merge.added.length} option(s) added`)
      }
    }

    // Every row goes into the PREVIEW — that is what proves the split against the server rather
    // than against this script's idea of it — but a row for somebody who already has an account
    // carries IDENTITY ONLY. Nothing of a duplicate row is ever written (the duplicate branch
    // returns before the write), so its department and its demographics buy nothing, and they
    // are not free: both are validated before the duplicate branch is reached, so one unlisted
    // value or one unknown department would turn a `duplicate` into a hard `error` and refuse
    // the whole run.
    const previewRows = [
      ...fresh.map((person) => toImportRow(person, fields)),
      ...existing.map((person) => ({ rowNumber: person.row, name: person.name, email: person.email, role: roleForTitle(person.puesto), department: null, demographics: {} })),
    ]
    const preview = await call('POST', '/admin/users/bulk-import/rows', { companyId, preview: true, rows: previewRows, newDepartments: missing, withCredentials: true }, token)
    const byStatus = (preview.rows ?? []).reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})
    log(`\npreview  : ${JSON.stringify(byStatus)}`)

    // The options are in place only on an apply run; see splitRefusals.
    const pendingValueEmails = new Set([...unknown.values()].flatMap((byValue) => [...byValue.values()].flat().map((person) => person.email)))
    const { refused, deferred } = splitRefusals(preview.rows, pendingValueEmails, values.apply)
    if (deferred.length) {
      log(`  ${deferred.length} row(s) the preview can only refuse until --apply adds their option first — not a problem:`)
      for (const row of deferred) log(`     row ${row.rowNumber} ${row.email}`)
    }
    if (refused.length) {
      log(`\nthe preview refused ${refused.length} row(s) — nothing was imported:`)
      for (const row of refused.slice(0, 25)) log(`  - row ${row.rowNumber} ${row.email}: ${row.errors.join('; ')}`)
      if (refused.length > 25) log(`  … and ${refused.length - 25} more`)
      process.exitCode = 1
      return
    }
    // The server's own count of who is already there must equal this script's, or the split that
    // decided which rows carry demographics was computed against a different company.
    const serverDuplicates = byStatus.duplicate ?? 0
    // A deferred row is a fresh one the preview could only refuse because this run has not added
    // its option yet, so it counts towards the fresh total the user list predicts.
    const serverFresh = (byStatus.valid ?? 0) + deferred.length
    if (serverDuplicates !== existing.length || serverFresh !== fresh.length) {
      log(`\nthe preview disagrees with the user list: it reports ${serverDuplicates} duplicate and ${serverFresh} importable, the user list says ${existing.length} and ${fresh.length} — refusing.`)
      process.exitCode = 1
      return
    }

    if (!values.apply) {
      log(`\nDRY RUN — ${fresh.length} account(s) would be created (and ${fresh.length} credential email(s) sent), ${existing.length} left as they are.`)
    } else if (fresh.length === 0) {
      log('\nevery person already has an account — nothing to import.')
    } else {
      // Batched for the same reason the climate importer is: App Runner ends a request at 120 s
      // and each row costs a bcrypt-12 hash plus a paced email. 17 rows is nowhere near it, but
      // the ceiling belongs to the endpoint, not to today's roster.
      const all = []
      let failed = false
      for (const [index, batch] of chunkRows(fresh.map((person) => toImportRow(person, fields)), IMPORT_CHUNK_ROWS).entries()) {
        let response
        try {
          response = await call('POST', '/admin/users/bulk-import/rows', { companyId, preview: false, rows: batch, newDepartments: missing, withCredentials: true }, token)
        } catch (error) {
          log(`\nrequest ${index + 1} FAILED after ${all.filter((r) => r.status === 'created').length} of ${fresh.length} were created: ${error.message}`)
          log('  Those accounts are COMMITTED. Re-run this command: the people who exist are')
          log('  reported as duplicates and left alone, so only the remainder is created.')
          log('  Anyone created before their email went out has no password yet:')
          log('    POST /admin/users/credentials sends a fresh pair, at most 100 ids per call.')
          failed = true
          break
        }
        all.push(...(response.rows ?? []))
      }
      const importedByStatus = all.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})
      log(`imported : ${JSON.stringify(importedByStatus)}`)
      for (const row of all.filter((r) => r.errors.length)) log(`  - row ${row.rowNumber} ${row.email}: ${row.errors.join('; ')}`)
      // A survey aimed at people must not be created when some of those people were not created.
      if (failed || all.some((r) => r.errors.length)) { process.exitCode = 1; return }
    }
  }

  if (values.phase === 'people') return

  // ---- phase 2 ----
  // Re-read the users: phase 1 just created some of them.
  const ranPhase1 = values.apply && values.phase !== 'survey'
  const after = ranPhase1 ? (await call('GET', `/admin/users?companyId=${companyId}`, null, token)).users ?? [] : users
  const byEmail = new Map(after.map((user) => [String(user.email).toLowerCase(), user.id]))
  const willExist = new Set(values.phase === 'survey' ? [] : fresh.map((person) => person.email))
  const unresolved = people.filter((person) => !byEmail.has(person.email))
  // In a review run the people phase 1 would create do not exist yet, and saying "they do not
  // resolve" about them would be noise. Anybody ELSE who does not resolve is the real thing this
  // check is for: the survey must never be created aimed at fewer people than the roster holds.
  const reallyMissing = unresolved.filter((person) => !willExist.has(person.email))
  if (reallyMissing.length) {
    log(`\n${reallyMissing.length} of the ${people.length} have no account and none would be created, so the survey would reach ${people.length - reallyMissing.length} people instead of ${people.length} — refusing to create it:`)
    for (const person of reallyMissing.slice(0, 25)) log(`  - row ${person.row} ${person.name} <${person.email}>`)
    if (reallyMissing.length > 25) log(`  … and ${reallyMissing.length - 25} more`)
    process.exitCode = 1
    return
  }
  if (unresolved.length && !values.apply) {
    log(`\nall ${people.length} would resolve: ${people.length - unresolved.length} have an account now and ${unresolved.length} would be created by phase 1.`)
  }
  const userIds = people.map((person) => byEmail.get(person.email)).filter(Boolean)
  const distinct = new Set(userIds)
  if (distinct.size !== userIds.length) throw new Error(`${userIds.length} resolved ids collapse to ${distinct.size} distinct — two people share an account`)
  if (values.apply && userIds.length !== people.length) throw new Error(`only ${userIds.length} of ${people.length} resolved to a user id`)

  const payload = JSON.parse(readFileSync(values.survey, 'utf8'))
  const body = toSurveyBody(payload, { companyId, startDate: values.start, endDate: values.end, userIds })
  const title = titleOf(body.title)
  const types = (body.questions ?? []).reduce((acc, q) => ({ ...acc, [q.type]: (acc[q.type] ?? 0) + 1 }), {})
  log(`\nsurvey   : ${title}`)
  log(`questions: ${(body.questions ?? []).length} — ${JSON.stringify(types)}`)
  log(`anonymous: ${body.settings?.anonymous}   sendInvitations: ${body.settings?.notificationSendInvitations}   serviceType: ${body.serviceType ?? 'null (unmetered)'}`)
  log(`targets  : ${values.apply ? userIds.length : people.length} PEOPLE by id, 0 departments — only they see it, whatever their department`)

  const surveys = await call('GET', `/surveys?companyId=${companyId}`, null, token)
  const already = (surveys.surveys ?? surveys).find((s) => s.companyId === companyId && norm(titleOf(s.title)) === norm(title))
  if (already) {
    log(`\nsurvey exists: ${titleOf(already.title)} (${already.id}, ${already.status}) — left as it is, nothing created.`)
    return
  }
  if (!values.apply) {
    log('\nDRY RUN — the survey would be created as a DRAFT. Re-run with --apply.')
    return
  }
  const created = await call('POST', '/surveys', body, token)
  const id = created?.id ?? created?.survey?.id
  if (!id) throw new Error(`survey create: unexpected body ${JSON.stringify(created).slice(0, 200)}`)
  log(`\nCREATED as a DRAFT: ${id}`)
  log('  next, in the product with the company selector on this company:')
  log('    1. Programar it (never Activar) — the window above opens it by itself')
  log('    2. Enviar invitaciones — 240 is under the 500 cap, so one batch')
  log('  invitations must exist BEFORE anyone answers: there is no backfill.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`import-teletrabajo: ${error.message}\n`)
    process.exitCode = 1
  })
}
