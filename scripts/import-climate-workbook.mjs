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
 * - OPCIONES (optional) — row 5 headers, each column's OPTIONS listed downward from row 6, in
 *   the order the respondent should see them. A workbook with this sheet and no people is a
 *   LINK-ONLY climate (EAGLE's shape): nobody is invited, every respondent declares their área
 *   and these options on the first screen of the link, and the "Área / Departamento" column
 *   becomes the company's departments.
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
 * 5. The result bands, how a result is read (`--scale mean|percent`, default mean: percent
 *    prints 0–100, i.e. mean × 20, the way EAGLE answers on 20..100) and the company's time
 *    zone (`--timezone`, default America/Costa_Rica),
 *    through `PUT /admin/companies/{id}/settings` (the same call the company's settings page
 *    makes): the band with the highest minimum is the strength band, the middle one
 *    opportunity, the lowest critical. The zone decides which DAY an answer, a participation
 *    and a closing time fall on; left at the product's UTC default, an answer sent at 20:56 in
 *    Costa Rica was recorded on the next day ("EAGLE (prueba)", 2026-10-13).
 *
 * In the LINK-ONLY mode (OPCIONES, no people) step 3 is replaced by creating the departments
 * the "Área / Departamento" column lists, and step 2 takes its fields and options from
 * OPCIONES in the workbook's own order.
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

/**
 * An optional XML namespace prefix on a spreadsheetml element.
 *
 * Excel writes `<sheet>`; several other writers — including whatever produced the TIMS
 * climate template — write `<x:sheet>` and declare `xmlns:x` on the root. Both are valid
 * OOXML and mean the same element, so every tag matched in this file tolerates a prefix.
 *
 * Found 2026-10-16: without it `readWorkbook` returned ZERO sheets for the template and for
 * every workbook built from it, and the run reported "Falta la hoja DESCRIPCION" for all
 * four sheets — a file-not-understood failure wearing the costume of an empty workbook.
 * The attributes are not affected: `name`, `r:id`, `r`, `t` and `s` are spelled the same
 * either way, and the relationship parts are a different namespace that is never prefixed.
 */
const NS = '(?:[A-Za-z_][\\w.-]*:)?'

/** Every <t> inside an element, joined — a rich-text string is several runs. */
const textOf = (xml) => [...xml.matchAll(new RegExp(`<${NS}t(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}t>`, 'g'))].map((m) => decodeXml(m[1])).join('')

export function parseSharedStrings(xml) {
  if (!xml) return []
  return [...xml.matchAll(new RegExp(`<${NS}si(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}si>`, 'g'))].map((m) => textOf(m[1]))
}

/**
 * The style facts that matter here, per cellXfs index: whether the cell is filled (and with
 * what colour) and whether its font is bold. Style INDICES change every time a file is
 * re-saved; what they point at does not.
 */
export function parseStyles(xml) {
  const section = (name) => xml.match(new RegExp(`<${NS}${name}[^>]*>([\\s\\S]*?)</${NS}${name}>`))?.[1] ?? ''
  const fonts = [...section('fonts').matchAll(new RegExp(`<${NS}font>([\\s\\S]*?)</${NS}font>|<${NS}font/>`, 'g'))]
    .map((m) => new RegExp(`<${NS}b/>|<${NS}b val="(1|true)"/>`).test(m[1] ?? ''))
  const fills = [...section('fills').matchAll(new RegExp(`<${NS}fill>([\\s\\S]*?)</${NS}fill>`, 'g'))].map((m) => {
    const solid = /patternType="solid"/.test(m[1])
    const rgb = m[1].match(new RegExp(`<${NS}fgColor[^>]*rgb="([0-9A-F]{8})"`, 'i'))?.[1] ?? null
    return { solid, rgb }
  })
  return [...section('cellXfs').matchAll(new RegExp(`<${NS}xf\\b([^>]*?)(?:/>|>[\\s\\S]*?</${NS}xf>)`, 'g'))].map((m) => {
    const fontId = Number(m[1].match(/fontId="(\d+)"/)?.[1] ?? 0)
    const fillId = Number(m[1].match(/fillId="(\d+)"/)?.[1] ?? 0)
    const fill = fills[fillId] ?? { solid: false, rgb: null }
    return { bold: fonts[fontId] ?? false, filled: fill.solid, rgb: fill.solid ? fill.rgb : null }
  })
}

/** { A1: { value, style } } for one sheet. Numbers stay numbers; a formula keeps its cached value. */
export function parseSheet(xml, sharedStrings, styles) {
  const cells = {}
  for (const m of xml.matchAll(new RegExp(`<${NS}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, 'g'))) {
    const attrs = m[1]
    const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
    if (!ref) continue
    const type = attrs.match(/\bt="(\w+)"/)?.[1] ?? 'n'
    const style = styles[Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0)] ?? { bold: false, filled: false, rgb: null }
    const body = m[2] ?? ''
    const raw = body.match(new RegExp(`<${NS}v(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}v>`))?.[1]
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
  for (const m of workbook.matchAll(new RegExp(`<${NS}sheet\\b([^>]*?)/?>`, 'g'))) {
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
      // Singular too: ESPH's own questionnaire heads its last section "Pregunta abierta",
      // which is natural Spanish for a section holding one. Matched only plural, that
      // question imported as a LIKERT -- the respondent would have been shown a 1-5 scale
      // for "¿Hay algún aspecto importante sobre su trabajo...?" (found 2026-10-16).
      dimensions.push({ name: text, open: /^preguntas? abiertas?$/.test(norm(text)), questions: [] })
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
  // OPCIONES — one column per field, options downward. With no people, it is the link-only mode.
  const optionsSheet = sheets.OPCIONES
  const linkOnly = Boolean(optionsSheet) && persons.length === 0
  const optionColumns = []
  if (optionsSheet) {
    for (let c = 2; c <= 30; c += 1) {
      const letter = String.fromCharCode(64 + c)
      const header = str(optionsSheet[`${letter}5`])
      if (!header) continue
      const options = []
      for (let r = 6; r <= rowsOf(optionsSheet); r += 1) {
        const option = str(optionsSheet[`${letter}${r}`])
        if (option && !options.includes(option)) options.push(option)
      }
      if (options.length === 0) problems.push(`OPCIONES columna ${letter} ("${header}"): no tiene opciones.`)
      optionColumns.push({ header, role: PERSON_COLUMNS[norm(header)] ?? 'demographic', options })
    }
    if (optionColumns.length === 0) problems.push('OPCIONES: no hay columnas (encabezados en la fila 5).')
  }
  const departments = optionColumns.find((c) => c.role === 'department')?.options ?? []
  if (linkOnly && departments.length === 0) problems.push('OPCIONES: falta la columna "Área / Departamento" con las áreas de la empresa.')
  if (persons.length === 0 && !linkOnly) problems.push('DEMOGRAFICOS: no hay personas (o agregue la hoja OPCIONES para una encuesta solo por enlace).')

  // A demographic column is numeric when every filled value is a number; otherwise a list.
  // Link-only: the fields are OPCIONES's columns, as lists, in the order the client wrote them.
  const demographicColumns = linkOnly
    ? optionColumns.filter((c) => c.role === 'demographic').map((c) => ({ header: c.header, field: slug(c.header), type: 'select', options: c.options }))
    : columns.filter((c) => c.role === 'demographic').map((c) => {
    const values = persons.map((p) => p.demographics[c.header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    const numeric = values.length > 0 && values.every((v) => typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v).trim()))
    const options = numeric ? [] : [...new Set(values.map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'es'))
    return { header: c.header, field: slug(c.header), type: numeric ? 'number' : 'select', options }
  })

  if (bands.length !== 3) problems.push(`ESCALAS: se esperan 3 bandas de calificación (crítica, oportunidad, fortaleza); se leyeron ${bands.length}.`)

  return {
    problems,
    climate: { intro, invitation, bands, scale, dimensions, columns: demographicColumns, persons, linkOnly, departments },
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

/**
 * The options a select field already carries, as option inputs that reproduce it exactly.
 *
 * The listing resolves ONE label per option for the locale asked for
 * (DemographicFieldEndpoints.ToDetail), so both locales are read and an option whose label the
 * API reported as a fallback for a locale is sent WITHOUT that locale -- re-sending a fallback
 * would invent an `es` label for an option that only ever had an `en` one. `value` is passed
 * through verbatim because it is what `user_demographics.value` already holds for everyone who
 * answered: derive it again and the people already carrying it stop matching their own option.
 */
export function existingOptionInputs(detailEs, detailEn) {
  const enByValue = new Map((detailEn?.options ?? []).map((o) => [o.value, o.label]))
  const fallbackEs = new Set(detailEs?.fallbackFields ?? [])
  const fallbackEn = new Set(detailEn?.fallbackFields ?? [])
  return (detailEs?.options ?? []).map((option) => {
    const key = `options[${option.order}].label`
    const label = {}
    if (option.label && !fallbackEs.has(key)) label.es = option.label
    const en = enByValue.get(option.value)
    if (en && !fallbackEn.has(key)) label.en = en
    return { value: option.value, label: Object.keys(label).length ? label : null }
  })
}

/**
 * The options `wanted` adds to a field that already exists, appended AFTER the ones it carries.
 * Null when it adds nothing, so the caller can skip the write entirely.
 *
 * Why this exists: a field is created by whichever import runs first and `PUT
 * /admin/demographic-fields/{id}` REPLACES the whole option list, while
 * `DemographicValueValidation` refuses a value outside it -- so a second import into the same
 * company whose roster holds one new Proceso made every row carrying it a hard `error`, and
 * `import-climate-workbook.mjs` refuses the run when any row is refused. Measured 2026-10-16 on
 * ESPH: the Contraloría roster's `proceso: "Contraloría Empresarial"` and two of its jefaturas
 * are absent from the options the Clima import creates, so ALL 8 of its rows would have been
 * refused and neither its accounts nor its survey would have been created.
 *
 * Existing options keep their order and their labels; nothing is ever removed or renamed here.
 */
export function mergeFieldOptions(existing, wanted) {
  const have = new Set(existing.map((option) => option.value))
  const added = wanted.filter((option) => !have.has(option.value))
  if (added.length === 0) return null
  return { options: [...existing, ...added], added }
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

export function toSurveyRequest(climate, { companyId, title, departmentIds, startDate, endDate, anonymous = true }) {
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
    targetAudienceCount: climate.persons.length || null,
    settings: {
      /**
       * Anonymous STORAGE, which is not the same thing as what the client is shown — and the
       * comment that used to sit here conflated them. It read "the description promises
       * 'nadie verá tus respuestas individuales'; an anonymous survey is the only kind that
       * keeps that promise", which is false: `SurveyAggregation` and `SurveyResultsPrivacy`
       * never branch on this flag, so the floor of 5, segment suppression, the complement
       * rule and the never-return-verbatim-text rule apply the same either way. No survey of
       * any kind shows an individual answer.
       *
       * What the flag really decides is whether `responses.user_id` is written. Setting it
       * costs exactly one thing, and it is the thing that keeps being reported as a defect:
       * with no user id the server cannot tell that this person already answered, so
       * `FindExistingResponseAsync` has nothing to match, `SurveyQueries.AssignedTo` cannot
       * filter the survey out of "Para responder", and a respondent can start it again.
       *
       * So: `true` protects the respondent from whoever holds the DATABASE. `false` still
       * protects them from the client's administrators -- who only ever see aggregates -- and
       * buys one-response-per-person, enforced by the server. Choose per survey, and tell the
       * respondents the truth either way: the respond screen's notice changes with it.
       */
      anonymous,
      // Explicit, though every survey now asks them (ruled 2026-10-12): a link-only climate
      // has no other source of área or demographics at all.
      selfDeclaredDemographics: true,
      allowPartialResponses: true,
      showProgress: true,
      ...(climate.invitation?.subject ? { invitationCustomSubject: both(climate.invitation.subject) } : {}),
      ...(climate.invitation?.message ? { invitationCustomMessage: both(climate.invitation.message) } : {}),
    },
    questions,
  }
}

/**
 * The company's result bands as `UpdateResultBandsRequest`: ordered by their minimum, the
 * highest is strength, the middle opportunity, the lowest critical. The two lower bands'
 * maxima are not sent -- the product derives them (opportunity ends 0,01 below strength).
 */
export function toBandsRequest(bands) {
  const [critical, opportunity, strength] = [...bands].sort((a, b) => a.min - b.min)
  return {
    opportunityMin: opportunity.min,
    strengthMin: strength.min,
    criticalName: critical.name,
    opportunityName: opportunity.name,
    strengthName: strength.name,
  }
}

/**
 * The company settings the import applies: the bands, how a result is READ (`scale`: "mean"
 * prints 1,00–5,00, "percent" prints 0–100 = mean × 20 -- the bands themselves stay on 1–5
 * either way), and the zone every "day" is read in.
 */
export function toSettingsRequest(bands, timezone, scale = 'mean') {
  return { resultBands: { ...toBandsRequest(bands), scale }, timezone }
}

/** "mean" or "percent", or null: anything else the API refuses with a 400 after the import ran. */
export function validScale(scale) {
  return scale === 'mean' || scale === 'percent' ? scale : null
}

/** An IANA zone the runtime knows ("America/Costa_Rica"), or null: a typo would leave UTC. */
export function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return /^[A-Za-z_]+(\/[A-Za-z_+-]+)+$|^UTC$/.test(zone) ? zone : null
  } catch {
    return null
  }
}

/** One line per thing the run would do — what the dry run prints. */
/**
 * Substitutes the template's `[Empresa]` placeholder with the company's name, the same way
 * the server-side parser does (`ClimateWorkbook.cs:108,110,158`).
 *
 * Without it this importer shipped the placeholder verbatim: the ESPH workbook's invitation
 * subject is "Invitación al clima organizacional de [Empresa]" and its description opens
 * "cómo vivimos el trabajo en [Empresa]", so 617 people would have received an email whose
 * subject line read `[Empresa]`. The two code paths parse the same workbook and must agree
 * about its text; only the C# one had learned this.
 *
 * Applied before `summarise`, so the dry run prints the sentence the respondent will
 * actually read rather than the template's.
 *
 * A missing name leaves the text untouched: `--company-id` alone cannot know it, and
 * printing the placeholder is honest where substituting an empty string is not.
 */
export function applyCompanyName(climate, name) {
  if (!name) return climate
  const sub = (text) => (typeof text === 'string' ? text.split('[Empresa]').join(name) : text)
  return {
    ...climate,
    intro: sub(climate.intro),
    invitation: climate.invitation
      ? { ...climate.invitation, subject: sub(climate.invitation.subject), message: sub(climate.invitation.message) }
      : climate.invitation,
    dimensions: climate.dimensions.map((d) => ({
      ...d,
      questions: d.questions.map((q) => (typeof q === 'string' ? sub(q) : { ...q, text: sub(q.text) })),
    })),
  }
}

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
    ...(climate.linkOnly
      ? [
          `modo: SOLO POR ENLACE — sin personas ni invitaciones; cada quien declara su área y sus datos al inicio`,
          `áreas (departamentos): ${climate.departments.length} (${climate.departments.join(', ')})`,
        ]
      : [
          `personas: ${climate.persons.length} en ${departments.length} departamentos (${departments.join(', ')})`,
          `rol líder por puesto: ${leaders.map((r) => r.email).join(', ') || 'ninguno'}`,
        ]),
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
      timezone: { type: 'string', default: 'America/Costa_Rica' },
      scale: { type: 'string', default: 'mean' },
      title: { type: 'string' },
      api: { type: 'string', default: 'http://127.0.0.1:5080' },
      email: { type: 'string', default: 'fede.super@acme.test' },
      password: { type: 'string', default: 'Local1234!' },
      apply: { type: 'boolean', default: false },
      // ESPH's mass invite is username+password (ruled 2026-10-13), which is the
      // endpoint's `withCredentials` branch. Without it every person gets an ACCOUNT
      // INVITATION instead -- "use the link below to set up your account" -- and chooses
      // their own password, which is a different product decision wearing the same name.
      'with-credentials': { type: 'boolean', default: false },
      'skip-demographic': { type: 'string', multiple: true, default: [] },
      anonymous: { type: 'string', default: 'true' },
      start: { type: 'string' },
      end: { type: 'string' },
    },
  })
  if (!values.file) throw new Error('--file <workbook.xlsx> is required')
  if (!values['company-id'] && !(values['company-name'] && values.domain)) throw new Error('name the company: --company-id <guid>, or --company-name and --domain to find or create it')
  if (values['company-id'] && !GUID.test(values['company-id'])) throw new Error('--company-id is not a GUID')

  if (values.anonymous !== 'true' && values.anonymous !== 'false') {
    throw new Error(`--anonymous must be true or false (recibido: ${values.anonymous})`)
  }
  const anonymous = values.anonymous === 'true'
  const withCredentials = values['with-credentials'] === true

  const parsed = parseClimate(readWorkbook(values.file))
  const skipping = skipDemographics(parsed.climate, values['skip-demographic'])
  const window = surveyWindow({ start: values.start, end: values.end })
  const zoneProblems = validTimeZone(values.timezone) ? [] : [`--timezone "${values.timezone}" no es una zona horaria válida (ej. America/Costa_Rica).`]
  const scaleProblems = validScale(values.scale) ? [] : [`--scale "${values.scale}" debe ser mean (1,00–5,00) o percent (0–100).`]
  const problems = [...parsed.problems, ...skipping.problems, ...window.problems, ...zoneProblems, ...scaleProblems]
  const climate = applyCompanyName(skipping.climate, values['company-name'])
  log(`import-climate-workbook: ${values.file}`)
  for (const line of summarise(climate)) log(`  ${line}`)
  if (skipping.skipped.length) log(`  sin importar (--skip-demographic): ${skipping.skipped.join(' · ')}`)
  log(`  zona horaria de la empresa: ${values.timezone}`)
  log(`  escala de resultados: ${values.scale === 'percent' ? 'percent — 0 a 100 (promedio × 20)' : values.scale === 'mean' ? 'mean — promedio de 1,00 a 5,00' : values.scale}`)
  if (!window.problems.length) log(`  ventana de la encuesta: ${window.startDate} → ${window.endDate}${values.start ? '' : ' (por defecto: sin --start/--end)'}`)
  log(withCredentials
    ? '  acceso: USUARIO Y CONTRASEÑA generados por la plataforma, enviados en el correo de credenciales'
    : '  acceso: INVITACIÓN de cuenta — cada persona abre el enlace y elige su propia contraseña')
  log(anonymous
    ? '  anonimato: ANÓNIMA — no se guarda quién respondió, así que nada impide que alguien la responda otra vez'
    : '  anonimato: IDENTIFICADA — se guarda quién respondió, así que el servidor permite UNA sola respuesta por persona (los resultados siguen siendo solo agregados)')
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

  // 2. Demographic fields, matched by key. A field that already exists is EXTENDED with the
  // options this workbook adds -- see mergeFieldOptions for the ESPH measurement that forced it.
  const [existingFields, existingFieldsEn] = await Promise.all([
    call('GET', `/admin/demographic-fields?companyId=${companyId}&lang=es`, null, token),
    call('GET', `/admin/demographic-fields?companyId=${companyId}&lang=en`, null, token),
  ])
  const fieldsByKey = new Map(existingFields.fields.map((f) => [f.field, f]))
  const fieldsEnByKey = new Map(existingFieldsEn.fields.map((f) => [f.field, f]))
  let order = fieldsByKey.size
  for (const column of climate.columns) {
    const existing = fieldsByKey.get(column.field)
    if (!existing) {
      const created = await call('POST', '/admin/demographic-fields', toFieldRequest(column, companyId, order++), token)
      if (created?.field !== column.field) throw new Error(`field ${column.field}: unexpected body ${JSON.stringify(created).slice(0, 200)}`)
      log(`field created: ${column.field} (${column.type})`)
      continue
    }
    // Only a select has options to extend, and only when both sides agree it is one: a column
    // read as numeric here against a field stored as a select (or the reverse) is a mismatch to
    // report, not to repair by replacing a list with the wrong kind of value.
    if (column.type !== 'select' || existing.type !== 'select') {
      if (column.type !== existing.type) log(`field exists: ${column.field} — ⚠️ the workbook reads it as ${column.type}, the company stores it as ${existing.type}; left as it is`)
      else log(`field exists: ${column.field}`)
      continue
    }
    const merge = mergeFieldOptions(
      existingOptionInputs(existing, fieldsEnByKey.get(column.field)),
      column.options.map((option) => ({ value: slug(option), label: both(option) })),
    )
    if (!merge) { log(`field exists: ${column.field}`); continue }
    const updated = await call('PUT', `/admin/demographic-fields/${existing.id}`, { options: merge.options }, token)
    if ((updated?.options ?? []).length !== merge.options.length) throw new Error(`field ${column.field}: PUT returned ${(updated?.options ?? []).length} options, expected ${merge.options.length}`)
    log(`field extended: ${column.field} — ${merge.added.length} option(s) added: ${merge.added.map((o) => o.label.es).join(', ')}`)
  }

  // 3a. Link-only: the departments OPCIONES lists, matched by name; nobody is invited.
  if (climate.linkOnly) {
    const listed = await call('GET', `/admin/departments?companyId=${companyId}`, null, token)
    const have = new Set((listed.departments ?? listed).map((d) => norm(d.name)))
    for (const name of climate.departments) {
      if (have.has(norm(name))) { log(`department exists: ${name}`); continue }
      await call('POST', '/admin/departments', { companyId, name, description: null, parentDepartmentId: null, isActive: true }, token)
      log(`department created: ${name}`)
    }
  }

  // 3. People — preview first, apply only a clean preview.
  const rows = climate.linkOnly ? [] : toImportRows(climate)
  const departments = await call('GET', `/admin/departments?companyId=${companyId}`, null, token)
  const known = new Set((departments.departments ?? departments).map((d) => norm(d.name)))
  const newDepartments = [...new Set(rows.map((r) => r.department).filter((d) => d && !known.has(norm(d))))]
  const preview = rows.length
    ? await call('POST', '/admin/users/bulk-import/rows', { companyId, preview: true, rows, newDepartments, withCredentials }, token)
    : { rows: [] }
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
    ? await call('POST', '/admin/users/bulk-import/rows', { companyId, preview: false, rows: toImport, newDepartments, withCredentials }, token)
    : { rows: [], successCount: 0, errorCount: 0 }
  const byStatus = imported.rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
  if (!climate.linkOnly) log(`people: ${JSON.stringify(byStatus)} (success ${imported.successCount}, errors ${imported.errorCount})${newDepartments.length ? `; departments created: ${newDepartments.join(', ')}` : ''}`)
  if (imported.errorCount > 0) for (const r of imported.rows.filter((x) => x.errors.length)) log(`  - fila ${r.rowNumber} ${r.email}: ${r.errors.join('; ')}`)

  // 4. The survey, as a draft, matched by title.
  const surveys = await call('GET', `/surveys?companyId=${companyId}`, null, token)
  const surveyTitle = title ?? `Clima Organizacional ${new Date().getFullYear()}`
  const already = (surveys.surveys ?? surveys).find((s) => s.companyId === companyId && norm(s.title) === norm(surveyTitle))
  if (already) { log(`survey exists: ${already.title} (${already.id}, ${already.status}) — left as it is`) } else {
    const afterImport = await call('GET', `/admin/departments?companyId=${companyId}`, null, token)
    const departmentIds = (afterImport.departments ?? afterImport).filter((d) => d.isActive !== false).map((d) => d.id)
    const body = toSurveyRequest(climate, { companyId, title: surveyTitle, departmentIds, startDate: window.startDate, endDate: window.endDate, anonymous })
    const created = await call('POST', '/surveys', body, token)
    const id = created?.id ?? created?.survey?.id
    if (!id) throw new Error(`survey create: unexpected body ${JSON.stringify(created).slice(0, 200)}`)
    log(`survey created as a DRAFT: ${surveyTitle} (${id}), ${body.questions.length} questions — review and launch it in the product`)
  }
  // 5. The company's result bands, result scale and time zone.
  const settings = toSettingsRequest(climate.bands, values.timezone, values.scale)
  const bandsRequest = settings.resultBands
  await call('PUT', `/admin/companies/${companyId}/settings`, settings, token)
  log(`time zone set: ${values.timezone}`)
  log(`result scale set: ${values.scale}`)
  log(`result bands set: ${bandsRequest.criticalName} < ${bandsRequest.opportunityMin} ≤ ${bandsRequest.opportunityName} < ${bandsRequest.strengthMin} ≤ ${bandsRequest.strengthName}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`import-climate-workbook: ${error.message}\n`)
    process.exitCode = 1
  })
}
