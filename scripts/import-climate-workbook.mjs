/**
 * Set up a company's climate from the four-sheet workbook — "Clima Organizacional <Empresa>
 * <Año>.xlsx", whose blank form is `scripts/fixtures/climate-workbook.template.xlsx`.
 *
 *   node scripts/import-climate-workbook.mjs --file <workbook.xlsx>
 *        (--company-id <guid> | --company-name "Name" --domain example.com [--country "Costa Rica"])
 *        [--api http://127.0.0.1:5080] [--email E --password P] [--apply]
 *        [--skip-demographic "<column>"]... [--start YYYY-MM-DD --end YYYY-MM-DD]
 *
 * Without `--apply` it is a DRY RUN: it reads the workbook, reports every problem at once, and
 * prints what it would create. Nothing is written until `--apply`.
 *
 * ## The workbook, sheet by sheet
 *
 * - DESCRIPCION — B6 the survey's description; B10 the invitation email, whose first line is
 *   `Asunto: …` (the subject) and the rest the message.
 * - ESCALAS — "Escala de calificaciones" (the result bands: name, min, max, and the fill of the
 *   Color cell) and "Escala de respuestas" (the answer scale: label and value).
 * - PREGUNTAS — column B under "Preguntas": a dimension title (a filled or bold cell), then its
 *   statements. A dimension titled "Preguntas abiertas" holds open-ended questions.
 * - DEMOGRAFICOS — row 5 headers, one person per row from row 6, until the first row without
 *   an email ("Promedio" ends it too).
 *
 * ## What it creates, in order, each through the endpoint the UI calls
 *
 * 1. The company (super_admin only), unless `--company-id` names one.
 * 2. One demographic field per demographic column — `select` with the distinct values seen, or
 *    `number` when every value is numeric — matched by field key, so a re-run creates none.
 * 3. The people, through `POST /admin/users/bulk-import/rows` (preview first; the apply call
 *    is refused if the preview reports any row problem), with their department — new ones
 *    are created by that call — and their demographic values. They become INVITATIONS; the
 *    values move to the person when they accept (InvitationAcceptEndpoints).
 * 4. The survey as a DRAFT — never launched: every dimension's statements as likert questions
 *   carrying the answer scale's labels, the open questions as open_ended, the description, and
 *   the invitation subject and message. Matched by title.
 *
 * The result bands are read and validated, and printed, but not sent: every company starts on
 * the product's default bands (docs/decisions/result-bands.md), which are TIMS's own; a company
 * whose workbook differs has them set by a super_admin in the product.
 *
 * ## What it refuses to decide
 *
 * The workbook has no role column. A person whose Puesto names a director, a manager or a
 * president is invited as `leader`; everyone else as `employee`. The import cannot create a
 * company_admin — that stays a deliberate act in the product. Names travel to the invitation
 * row; the product keeps no name on an invitation yet, so a person's name appears once they
 * register.
 *
 * ## Through the API, never the database
 *
 * Same rule as `seed-local.mjs` and `import-question-library.mjs`: the product's own
 * validation applies to every row, and every response is checked by its body.
 */
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const log = (line) => process.stdout.write(`${line}\n`)
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------------------------------------------------------------------------------------
// Reading the .xlsx: the package is a zip of XML parts. `unzip -p` reads one part; nothing
// here needs a library, and the repository's rule is no new dependency without a reason.
// ---------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name) => {
    if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
    return ENTITIES[name] ?? whole
  })
}

/** Every <t> inside an element, joined — a rich-text string is several runs. */
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('')

export function parseSharedStrings(xml) {
  if (!xml) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
}

/**
 * The style facts that matter here, per cellXfs index: whether the cell is filled (and with
 * what colour) and whether its font is bold. Style INDICES change every time a file is
 * re-saved; what they point at does not.
 */
export function parseStyles(xml) {
  const section = (name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? ''
  const fonts = [...section('fonts').matchAll(/<font>([\s\S]*?)<\/font>|<font\/>/g)].map((m) => /<b\/>|<b val="(1|true)"\/>/.test(m[1] ?? ''))
  const fills = [...section('fills').matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((m) => {
    const solid = /patternType="solid"/.test(m[1])
    const rgb = m[1].match(/<fgColor[^>]*rgb="([0-9A-F]{8})"/i)?.[1] ?? null
    return { solid, rgb }
  })
  return [...section('cellXfs').matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => {
    const fontId = Number(m[1].match(/fontId="(\d+)"/)?.[1] ?? 0)
    const fillId = Number(m[1].match(/fillId="(\d+)"/)?.[1] ?? 0)
    const fill = fills[fillId] ?? { solid: false, rgb: null }
    return { bold: fonts[fontId] ?? false, filled: fill.solid, rgb: fill.solid ? fill.rgb : null }
  })
}

/** { A1: { value, style } } for one sheet. Numbers stay numbers; a formula keeps its cached value. */
export function parseSheet(xml, sharedStrings, styles) {
  const cells = {}
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1]
    const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const type = attrs.match(/\bt="(\w+)"/)?.[1] ?? 'n'
    const style = styles[Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0)] ?? { bold: false, filled: false, rgb: null }
    const body = m[2] ?? ''
    const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
    let value = null
    if (type === 's' && raw !== undefined) value = sharedStrings[Number(raw)] ?? null
    else if (type === 'inlineStr') value = textOf(body)
    else if (type === 'str' && raw !== undefined) value = decodeXml(raw)
    else if (type === 'b' && raw !== undefined) value = raw === '1'
    else if (raw !== undefined) value = Number(raw)
    if (typeof value === 'string' && value.trim() === '') value = null
    cells[ref] = { value, style }
  }
  return cells
}

/** One attribute's value from an element's attribute text, whatever order they were written in. */
export const attr = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`))?.[1] ?? null

export function readWorkbook(path) {
  const part = (name) => {
    try { return execFileSync('unzip', ['-p', path, name], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' }
  }
  const workbook = part('xl/workbook.xml')
  if (!workbook) throw new Error(`${path} is not an .xlsx workbook (no xl/workbook.xml)`)
  const rels = part('xl/_rels/workbook.xml.rels')
  // Attribute ORDER is the writer's choice (Excel writes Id first, openpyxl Target first).
  const targets = Object.fromEntries([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]))
  const shared = parseSharedStrings(part('xl/sharedStrings.xml'))
  const styles = parseStyles(part('xl/styles.xml'))
  const sheets = {}
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name')
    const target = targets[attr(m[1], 'r:id')]
    if (!name || !target) continue
    const file = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    sheets[decodeXml(name).trim().toUpperCase()] = parseSheet(part(file), shared, styles)
  }
  return sheets
}

// ---------------------------------------------------------------------------------------
// From cells to a climate: pure, so the tests can feed it cells without a file.
// ---------------------------------------------------------------------------------------

const str = (cell) => (cell?.value === null || cell?.value === undefined ? null : String(cell.value).trim())
const rowsOf = (cells) => Math.max(0, ...Object.keys(cells).map((ref) => Number(ref.replace(/^[A-Z]+/, ''))))
const norm = (text) => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** A stable, locale-independent key: "Tims Colombia" → "tims_colombia", "Tiempo de laborar en TIMS (años)" → "tiempo_de_laborar_en_tims_anos". */
export function slug(text) {
  return norm(text).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

const PERSON_COLUMNS = {
  nombre: 'name', apellido: 'surname', apellidos: 'surname', 'correo electronico': 'email', correo: 'email', email: 'email',
  puesto: 'title', cargo: 'title', 'area / departamento': 'department', area: 'department', departamento: 'department',
}

/** "Director", "Directora", "Gerente", "Presidente" → leader. Stated, not guessed: see the header. */
export function roleForTitle(title) {
  return /\b(director|directora|gerente|presidente|presidenta|jefe|jefa)\b/i.test(norm(title)) ? 'leader' : 'employee'
}

export function parseClimate(sheets) {
  const problems = []
  const need = (name) => {
    const sheet = sheets[name]
    if (!sheet) problems.push(`Falta la hoja ${name}.`)
    return sheet ?? {}
  }
  const description = need('DESCRIPCION')
  const scales = need('ESCALAS')
  const questionsSheet = need('PREGUNTAS')
  const people = need('DEMOGRAFICOS')

  // DESCRIPCION
  const intro = str(description.B6)
  const email = str(description.B10)
  let invitation = null
  if (email) {
    const lines = email.split(/\r?\n/)
    const subjectLine = lines.findIndex((line) => /^\s*asunto\s*:/i.test(line))
    invitation = subjectLine >= 0
      ? { subject: lines[subjectLine].replace(/^\s*asunto\s*:\s*/i, '').trim(), message: lines.slice(subjectLine + 1).join('\n').trim() }
      : { subject: null, message: email }
  }
  if (!intro) problems.push('DESCRIPCION B6: falta la descripción de la evaluación.')

  // ESCALAS — find each block by its title, then read until the first empty row.
  const titleRow = (pattern) => {
    for (let r = 1; r <= rowsOf(scales); r += 1) if (pattern.test(norm(str(scales[`B${r}`])))) return r
    return null
  }
  const bandsAt = titleRow(/^escala de calificaciones/)
  const answersAt = titleRow(/^escala de respuestas/)
  const bands = []
  if (bandsAt) {
    for (let r = bandsAt + 2; str(scales[`B${r}`]); r += 1) {
      bands.push({ name: str(scales[`B${r}`]), min: Number(scales[`C${r}`]?.value), max: Number(scales[`D${r}`]?.value), color: scales[`E${r}`]?.style.rgb ?? null })
    }
  } else problems.push('ESCALAS: falta el bloque "Escala de calificaciones".')
  const scale = []
  if (answersAt) {
    for (let r = answersAt + 2; str(scales[`B${r}`]); r += 1) scale.push({ label: str(scales[`B${r}`]), value: Number(scales[`C${r}`]?.value) })
  } else problems.push('ESCALAS: falta el bloque "Escala de respuestas".')
  scale.sort((a, b) => a.value - b.value)
  if (scale.length < 2 || scale.some((point, i) => !Number.isInteger(point.value) || (i > 0 && point.value !== scale[i - 1].value + 1))) {
    problems.push(`ESCALAS: la escala de respuestas debe ser de valores enteros consecutivos (se leyó ${scale.map((p) => p.value).join(', ') || 'nada'}).`)
  }
  for (const band of bands) {
    if (!Number.isFinite(band.min) || !Number.isFinite(band.max) || band.min > band.max) problems.push(`ESCALAS: la banda "${band.name}" tiene un rango inválido (${band.min}–${band.max}).`)
  }

  // PREGUNTAS — a filled or bold cell is a dimension; anything under it is its statement.
  const dimensions = []
  const last = rowsOf(questionsSheet)
  for (let r = 6; r <= last; r += 1) {
    const cell = questionsSheet[`B${r}`]
    const text = str(cell)
    if (!text) continue
    const looksLikeTitle = cell.style.filled || cell.style.bold || !/[.?!:]$/.test(text)
    if (looksLikeTitle && !(dimensions.length && /[.?!]$/.test(text))) {
      dimensions.push({ name: text, open: /^preguntas abiertas$/.test(norm(text)), questions: [] })
    } else if (dimensions.length) {
      dimensions.at(-1).questions.push(text)
    } else {
      problems.push(`PREGUNTAS B${r}: hay una pregunta antes del primer título de dimensión.`)
    }
  }
  for (const dimension of dimensions) if (dimension.questions.length === 0) problems.push(`PREGUNTAS: la dimensión "${dimension.name}" no tiene preguntas.`)
  if (!dimensions.some((d) => !d.open)) problems.push('PREGUNTAS: no hay ninguna dimensión con afirmaciones para la escala.')

  // DEMOGRAFICOS — headers on row 5, people from row 6 until a row without an email.
  const columns = []
  for (let c = 2; c <= 30; c += 1) {
    const letter = String.fromCharCode(64 + c)
    const header = str(people[`${letter}5`])
    if (!header) continue
    columns.push({ letter, header, role: PERSON_COLUMNS[norm(header)] ?? 'demographic' })
  }
  for (const required of ['email', 'department']) {
    if (!columns.some((c) => c.role === required)) problems.push(`DEMOGRAFICOS: falta la columna de ${required === 'email' ? 'correo electrónico' : 'área / departamento'}.`)
  }
  const persons = []
  const seen = new Map()
  for (let r = 6; r <= rowsOf(people); r += 1) {
    const first = str(people[`B${r}`])
    if (first && /^promedio$/i.test(first)) break
    const row = { rowNumber: r, demographics: {} }
    for (const column of columns) {
      const cell = people[`${column.letter}${r}`]
      if (column.role === 'demographic') row.demographics[column.header] = cell?.value ?? null
      else row[column.role] = str(cell)
    }
    if (!row.email && !row.name && !row.department) continue
    if (!row.email || !EMAIL.test(row.email)) { problems.push(`DEMOGRAFICOS fila ${r}: correo inválido o vacío ("${row.email ?? ''}").`); continue }
    const key = row.email.toLowerCase()
    if (seen.has(key)) { problems.push(`DEMOGRAFICOS fila ${r}: el correo ${row.email} ya está en la fila ${seen.get(key)}.`); continue }
    seen.set(key, r)
    if (!row.department) problems.push(`DEMOGRAFICOS fila ${r}: falta el área / departamento.`)
    persons.push(row)
  }
  if (persons.length === 0) problems.push('DEMOGRAFICOS: no hay personas.')

  // A demographic column is numeric when every filled value is a number; otherwise a list.
  const demographicColumns = columns.filter((c) => c.role === 'demographic').map((c) => {
    const values = persons.map((p) => p.demographics[c.header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    const numeric = values.length > 0 && values.every((v) => typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v).trim()))
    const options = numeric ? [] : [...new Set(values.map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'es'))
    return { header: c.header, field: slug(c.header), type: numeric ? 'number' : 'select', options }
  })

  return {
    problems,
    climate: { intro, invitation, bands, scale, dimensions, columns: demographicColumns, persons },
  }
}

/**
 * Leave demographic columns out of the import: no field is created for them and no person's
 * value is sent. A name matches a column by its header (accents and case aside) or its field
 * key. A name that matches no column is a problem, not a silent no-op -- a typo would
 * otherwise collect exactly what the operator meant to leave out.
 *
 * Why it exists: TIMS's Edad and Tiempo are numbers, a number field is never split into
 * groups, and with 15 people no group reaches the floor of 5 anyway -- so those answers
 * could never be shown, while every respondent was told they were "not recorded".
 */
export function skipDemographics(climate, names) {
  const wanted = (names ?? []).map((name) => ({ name, key: norm(name), field: slug(name) }))
  const matches = (column, entry) => norm(column.header) === entry.key || column.field === entry.field
  const problems = wanted
    .filter((entry) => !climate.columns.some((column) => matches(column, entry)))
    .map((entry) => `--skip-demographic "${entry.name}": no hay una columna demográfica con ese nombre (hay: ${climate.columns.map((c) => c.header).join(', ')}).`)
  const skipped = climate.columns.filter((column) => wanted.some((entry) => matches(column, entry)))
  return {
    problems,
    skipped: skipped.map((column) => column.header),
    climate: { ...climate, columns: climate.columns.filter((column) => !skipped.includes(column)) },
  }
}

/**
 * The survey's response window. `--start`/`--end` are calendar days in Costa Rica (UTC-6,
 * no daylight saving): the survey opens at 08:00 on the first and closes at 23:59 on the
 * last. Without them it keeps the old default -- a week from now, for three weeks -- which
 * is a placeholder, not a date anyone chose. Returns `{ problems, startDate, endDate }`.
 */
export function surveyWindow({ start, end }, now = new Date()) {
  const day = /^\d{4}-\d{2}-\d{2}$/
  if (!start && !end) {
    const from = new Date(now.getTime() + 7 * 864e5)
    return { problems: [], startDate: from.toISOString(), endDate: new Date(from.getTime() + 21 * 864e5).toISOString() }
  }
  if (!start || !end) return { problems: ['--start y --end van juntos: indique ambos días (AAAA-MM-DD).'] }
  if (!day.test(start) || !day.test(end)) return { problems: [`--start/--end deben ser AAAA-MM-DD (recibido: ${start} / ${end}).`] }
  const startDate = new Date(`${start}T08:00:00-06:00`)
  const endDate = new Date(`${end}T23:59:00-06:00`)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return { problems: [`--start/--end no son fechas válidas (${start} / ${end}).`] }
  const problems = []
  if (endDate <= startDate) problems.push(`--end (${end}) debe ser posterior a --start (${start}).`)
  if (endDate <= now) problems.push(`--end (${end}) ya pasó.`)
  return { problems, startDate: startDate.toISOString(), endDate: endDate.toISOString() }
}

// ---------------------------------------------------------------------------------------
// Request shapes: what each endpoint receives. Pure, tested.
// ---------------------------------------------------------------------------------------

const both = (es) => ({ es, en: es })

export function toFieldRequest(column, companyId, order) {
  return {
    companyId,
    field: column.field,
    label: both(column.header),
    type: column.type,
    options: column.type === 'select' ? column.options.map((option) => ({ value: slug(option), label: both(option) })) : null,
    required: false,
    order,
  }
}

export function toImportRows(climate) {
  return climate.persons.map((person) => {
    const demographics = {}
    for (const column of climate.columns) {
      const raw = person.demographics[column.header]
      if (raw === null || raw === undefined || String(raw).trim() === '') continue
      demographics[column.field] = column.type === 'select' ? slug(String(raw)) : String(raw).trim().replace(',', '.')
    }
    return {
      rowNumber: person.rowNumber,
      name: [person.name, person.surname].filter(Boolean).join(' ').trim() || null,
      email: person.email,
      role: roleForTitle(person.title),
      department: person.department,
      demographics,
    }
  })
}

export function toSurveyRequest(climate, { companyId, title, departmentIds, startDate, endDate }) {
  const options = climate.scale.map((point) => ({ value: String(point.value), label: both(point.label) }))
  const min = climate.scale[0]?.value ?? 1
  const max = climate.scale.at(-1)?.value ?? 5
  const questions = []
  for (const dimension of climate.dimensions) {
    for (const text of dimension.questions) {
      questions.push(dimension.open
        ? { text: both(text), type: 'open_ended', category: dimension.name, required: false, order: questions.length }
        : {
            text: both(text), type: 'likert', category: dimension.name, required: true, order: questions.length,
            scaleMin: min, scaleMax: max, scaleLabelMin: both(climate.scale[0]?.label ?? ''), scaleLabelMax: both(climate.scale.at(-1)?.label ?? ''), options,
          })
    }
  }
  return {
    title: both(title),
    description: climate.intro ? both(climate.intro) : undefined,
    companyId,
    type: 'periodic',
    language: 'es',
    startDate,
    endDate,
    departmentIds,
    targetAudienceCount: climate.persons.length,
    settings: {
      // The description promises it ("nadie verá tus respuestas individuales"); an anonymous
      // survey is the only kind that keeps that promise in the product.
      anonymous: true,
      allowPartialResponses: true,
      showProgress: true,
      ...(climate.invitation?.subject ? { invitationCustomSubject: both(climate.invitation.subject) } : {}),
      ...(climate.invitation?.message ? { invitationCustomMessage: both(climate.invitation.message) } : {}),
    },
    questions,
  }
}

/** One line per thing the run would do — what the dry run prints. */
export function summarise(climate) {
  const likert = climate.dimensions.filter((d) => !d.open).reduce((n, d) => n + d.questions.length, 0)
  const open = climate.dimensions.filter((d) => d.open).reduce((n, d) => n + d.questions.length, 0)
  const departments = [...new Set(climate.persons.map((p) => p.department))]
  const leaders = toImportRows(climate).filter((r) => r.role === 'leader')
  return [
    `descripción: ${climate.intro ? `${climate.intro.slice(0, 70)}…` : '—'}`,
    `invitación: asunto "${climate.invitation?.subject ?? '—'}", mensaje de ${climate.invitation?.message?.length ?? 0} caracteres`,
    `bandas: ${climate.bands.map((b) => `${b.name} ${b.min}–${b.max}${b.color ? ` #${b.color.slice(2)}` : ''}`).join(' · ') || '—'}`,
    `escala: ${climate.scale.map((p) => `${p.value} ${p.label}`).join(' · ')}`,
    `preguntas: ${climate.dimensions.filter((d) => !d.open).length} dimensiones, ${likert} afirmaciones (likert) + ${open} abiertas`,
    `campos demográficos: ${climate.columns.map((c) => `${c.header} [${c.type}${c.type === 'select' ? `: ${c.options.join(', ')}` : ''}]`).join(' · ')}`,
    `personas: ${climate.persons.length} en ${departments.length} departamentos (${departments.join(', ')})`,
    `rol líder por puesto: ${leaders.map((r) => r.email).join(', ') || 'ninguno'}`,
  ]
}

// ---------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      'company-id': { type: 'string' },
      'company-name': { type: 'string' },
      domain: { type: 'string' },
      country: { type: 'string', default: 'Costa Rica' },
      title: { type: 'string' },
      api: { type: 'string', default: 'http://127.0.0.1:5080' },
      email: { type: 'string', default: 'fede.super@acme.test' },
      password: { type: 'string', default: 'Local1234!' },
      apply: { type: 'boolean', default: false },
      'skip-demographic': { type: 'string', multiple: true, default: [] },
      start: { type: 'string' },
      end: { type: 'string' },
    },
  })
  if (!values.file) throw new Error('--file <workbook.xlsx> is required')
  if (!values['company-id'] && !(values['company-name'] && values.domain)) throw new Error('name the company: --company-id <guid>, or --company-name and --domain to find or create it')
  if (values['company-id'] && !GUID.test(values['company-id'])) throw new Error('--company-id is not a GUID')

  const parsed = parseClimate(readWorkbook(values.file))
  const skipping = skipDemographics(parsed.climate, values['skip-demographic'])
  const window = surveyWindow({ start: values.start, end: values.end })
  const problems = [...parsed.problems, ...skipping.problems, ...window.problems]
  const climate = skipping.climate
  log(`import-climate-workbook: ${values.file}`)
  for (const line of summarise(climate)) log(`  ${line}`)
  if (skipping.skipped.length) log(`  sin importar (--skip-demographic): ${skipping.skipped.join(' · ')}`)
  if (!window.problems.length) log(`  ventana de la encuesta: ${window.startDate} → ${window.endDate}${values.start ? '' : ' (por defecto: sin --start/--end)'}`)
  if (problems.length) {
    log(`\n${problems.length} problem(s) in the workbook — nothing was sent:`)
    for (const problem of problems) log(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  const title = values.title ?? (values['company-name'] ? `Clima Organizacional ${values['company-name']} ${new Date().getFullYear()}` : null)
  if (!values.apply) {
    log(`\nDRY RUN — the workbook is valid. Re-run with --apply to create everything${title ? ` (survey "${title}", as a draft)` : ''}.`)
    return
  }

  const API = values.api
  const call = async (method, path, body, token) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* a non-JSON body is reported below */ }
    if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 400)}`)
    return json
  }
  const { token } = await call('POST', '/auth/login', { email: values.email, password: values.password })
  if (!token) throw new Error('login returned no token')

  // 1. Company
  let companyId = values['company-id']
  if (!companyId) {
    const listed = await call('GET', '/admin/companies', null, token)
    const companies = listed.companies ?? listed
    const found = companies.find((c) => c.emailDomain?.toLowerCase() === values.domain.toLowerCase() || norm(c.name) === norm(values['company-name']))
    if (found) { companyId = found.id; log(`\ncompany exists: ${found.name} (${found.id})`) } else {
      const created = await call('POST', '/admin/companies', { name: values['company-name'], emailDomain: values.domain, country: values.country, size: 'small', industry: 'Servicios', subscriptionTier: null }, token)
      if (!created?.id) throw new Error('company create returned no id')
      companyId = created.id
      log(`\ncompany created: ${created.name} (${created.id})`)
    }
  }

  // 2. Demographic fields, matched by key.
  const existingFields = await call('GET', `/admin/demographic-fields?companyId=${companyId}`, null, token)
  const fieldKeys = new Set(existingFields.fields.map((f) => f.field))
  let order = fieldKeys.size
  for (const column of climate.columns) {
    if (fieldKeys.has(column.field)) { log(`field exists: ${column.field}`); continue }
    const created = await call('POST', '/admin/demographic-fields', toFieldRequest(column, companyId, order++), token)
    if (created?.field !== column.field) throw new Error(`field ${column.field}: unexpected body ${JSON.stringify(created).slice(0, 200)}`)
    log(`field created: ${column.field} (${column.type})`)
  }

  // 3. People — preview first, apply only a clean preview.
  const rows = toImportRows(climate)
  const departments = await call('GET', `/admin/departments?companyId=${companyId}`, null, token)
  const known = new Set((departments.departments ?? departments).map((d) => norm(d.name)))
  const newDepartments = [...new Set(rows.map((r) => r.department).filter((d) => d && !known.has(norm(d))))]
  const preview = await call('POST', '/admin/users/bulk-import/rows', { companyId, preview: true, rows, newDepartments }, token)
  // BulkImportResponse { rows: [{ rowNumber, email, status: valid|error|invited, errors[], issues[{code}] }] }.
  // The natural key of a person is the email: one already invited or already registered is
  // ALREADY THERE (a re-run), not a failure — it is left out of the import, never re-sent.
  const PRESENT = new Set(['already_invited', 'already_user'])
  const present = new Set(preview.rows.filter((r) => r.issues.length > 0 && r.issues.every((i) => PRESENT.has(i.code))).map((r) => r.email.toLowerCase()))
  const refused = preview.rows.filter((r) => (r.status === 'error' || r.errors.length > 0) && !present.has(r.email.toLowerCase()))
  if (present.size) log(`people already there (invited or registered), left as they are: ${present.size}`)
  if (refused.length) {
    log(`\nthe preview refused ${refused.length} row(s) — nothing imported:`)
    for (const r of refused) log(`  - fila ${r.rowNumber} ${r.email}: ${r.errors.join('; ')}`)
    process.exitCode = 1
    return
  }
  const toImport = rows.filter((r) => !present.has(r.email.toLowerCase()))
  const imported = toImport.length
    ? await call('POST', '/admin/users/bulk-import/rows', { companyId, preview: false, rows: toImport, newDepartments }, token)
    : { rows: [], successCount: 0, errorCount: 0 }
  const byStatus = imported.rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
  log(`people: ${JSON.stringify(byStatus)} (success ${imported.successCount}, errors ${imported.errorCount})${newDepartments.length ? `; departments created: ${newDepartments.join(', ')}` : ''}`)
  if (imported.errorCount > 0) for (const r of imported.rows.filter((x) => x.errors.length)) log(`  - fila ${r.rowNumber} ${r.email}: ${r.errors.join('; ')}`)

  // 4. The survey, as a draft, matched by title.
  const surveys = await call('GET', `/surveys?companyId=${companyId}`, null, token)
  const surveyTitle = title ?? `Clima Organizacional ${new Date().getFullYear()}`
  const already = (surveys.surveys ?? surveys).find((s) => s.companyId === companyId && norm(s.title) === norm(surveyTitle))
  if (already) { log(`survey exists: ${already.title} (${already.id}, ${already.status}) — left as it is`) } else {
    const afterImport = await call('GET', `/admin/departments?companyId=${companyId}`, null, token)
    const departmentIds = (afterImport.departments ?? afterImport).filter((d) => d.isActive !== false).map((d) => d.id)
    const body = toSurveyRequest(climate, { companyId, title: surveyTitle, departmentIds, startDate: window.startDate, endDate: window.endDate })
    const created = await call('POST', '/surveys', body, token)
    const id = created?.id ?? created?.survey?.id
    if (!id) throw new Error(`survey create: unexpected body ${JSON.stringify(created).slice(0, 200)}`)
    log(`survey created as a DRAFT: ${surveyTitle} (${id}), ${body.questions.length} questions — review and launch it in the product`)
  }
  log(`\nbands read but not sent — every company starts on the product's default bands (≥4 fortaleza, 3–3,99 oportunidad, <3 crítica); if these differ, set them in the company's result bands as super_admin: ${climate.bands.map((b) => `${b.name} ${b.min}–${b.max}`).join(' · ')}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`import-climate-workbook: ${error.message}\n`)
    process.exitCode = 1
  })
}
