/**
 * Create a survey DRAFT from an instrument file — the same JSON
 * `import-question-library.mjs` loads into the question library.
 *
 *   node scripts/create-survey-from-instrument.mjs --file <instrument.json> \
 *     --company-id <guid> --title "…" [--start AAAA-MM-DD --end AAAA-MM-DD] [--apply]
 *
 * ## Why this exists beside the library importer
 *
 * The library is where an instrument LIVES; a survey is an instance of it, and only a survey
 * can be answered. The shipped way to turn one into the other is the wizard's picker
 * (`QuestionLibraryBrowser`), and for a handful of questions that is the right tool. For an
 * instrument a client's COE reviewed statement by statement it is not: fifty-nine picks in a
 * browser is fifty-nine chances to miss one, reorder one, or land one in the wrong theme, and
 * nothing afterwards would say which. Reading the same file both paths read makes the survey
 * and the library provably the same instrument, and makes "identical to what the client
 * approved" a thing this script checks rather than a thing somebody believes.
 *
 * ## It creates a draft, and stops
 *
 * Same rule as `import-climate-workbook.mjs`: the window and the lifecycle belong to a person.
 * A scheduled survey opens itself at its start date; an active one accepts answers at once,
 * whatever its dates. This script never calls `PUT /surveys/{id}/status`, so nothing it does
 * can let a respondent in early.
 *
 * ## Through the endpoint, and verified by the BODY
 *
 * `POST /surveys` is what the wizard calls. Afterwards the survey is read back and every
 * question compared — text, type, scale, anchors, theme and order — because a 200 that dropped
 * question 41 looks exactly like a 200 that did not.
 */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { surveyWindow } from './import-climate-workbook.mjs'

const log = (line) => process.stdout.write(`${line}\n`)
const blank = (v) => typeof v !== 'string' || v.trim() === ''
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The settings every question of a climate instrument needs, and why each one.
 *
 * `randomizeQuestions` carries two client commitments at once (PROCOMER minuta, 12 Aug 2026):
 * the questions are asked in a random order AND the dimension being measured is not shown.
 * `respondDimensions.ts` stops sectioning a randomised survey entirely — regrouping a shuffled
 * list under its theme headings would undo the shuffle — so one flag delivers both.
 *
 * `allowPartialResponses` + `autoSave` are the "retomarla desde la última pregunta contestada"
 * commitment. On an ANONYMOUS survey the part-finished response is found again by the client's
 * session id, not by a user id (`SurveyResponseEndpoints.FindExistingResponseAsync`), so resume
 * works per browser: a respondent who switches device or clears storage starts again, and the
 * server cannot refuse a second submission. That is the price of anonymous storage, and it is
 * the direction a confidentiality promise should fail in.
 */
export const CLIMATE_SETTINGS = {
  anonymous: true,
  allowPartialResponses: true,
  autoSave: true,
  showProgress: true,
  randomizeQuestions: true,
}

/**
 * One survey question per instrument item, in file order.
 *
 * `category` is the theme's own Spanish name rather than its key: it is what the results
 * screens group by and what a respondent would see as a section heading on a non-randomised
 * survey, so a slug there would surface in the product.
 *
 * Text is sent as a BARE string, which `LocalizedInput` attributes to the survey's own
 * language. The instrument carries the Spanish in both columns because the library demands
 * two; a single-language survey should not inherit that duplication and claim an English
 * version exists.
 *
 * `commentRequired: false` — the field is stored, echoed and versioned but nothing reads it to
 * enforce anything; `false` is what the web builder authors, so the row says what we mean.
 */
export function toSurveyRequest(doc, { companyId, title, description, startDate, endDate, settings, serviceType }) {
  const nameByKey = new Map(doc.categories.map((c) => [c.key, c.nameEs]))
  return {
    title,
    ...(blank(description) ? {} : { description }),
    companyId,
    type: 'periodic',
    language: 'es',
    startDate,
    endDate,
    ...(blank(serviceType) ? {} : { serviceType }),
    settings: { ...CLIMATE_SETTINGS, ...settings },
    questions: doc.items.map((item, order) => ({
      text: item.textEs,
      type: item.type,
      category: nameByKey.get(item.category) ?? null,
      // An open question is the one a respondent may leave blank: requiring a comment from
      // everybody is how a climate survey collects "n/a" fifty times.
      required: item.type !== 'open_ended',
      commentRequired: false,
      order,
      ...(item.scaleMin == null ? {} : { scaleMin: item.scaleMin, scaleMax: item.scaleMax }),
      ...(item.scaleLabelMinEs == null ? {} : { scaleLabelMin: item.scaleLabelMinEs, scaleLabelMax: item.scaleLabelMaxEs }),
    })),
  }
}

/** The one line of a question that has to match, as the server reports it back. */
const shape = (q) => ({
  text: typeof q.text === 'string' ? q.text : (q.text?.es ?? q.text?.en ?? null),
  type: q.type,
  category: q.category ?? null,
  scaleMin: q.scaleMin ?? null,
  scaleMax: q.scaleMax ?? null,
  scaleLabelMin: (typeof q.scaleLabelMin === 'string' ? q.scaleLabelMin : q.scaleLabelMin?.es) ?? null,
  scaleLabelMax: (typeof q.scaleLabelMax === 'string' ? q.scaleLabelMax : q.scaleLabelMax?.es) ?? null,
})

/**
 * Every difference between what was sent and what the server now holds, in order.
 *
 * Compared by POSITION, not by text: two statements that differ only in their theme must be
 * reported, and a shifted list must read as a shift rather than as fifty-nine unrelated
 * differences.
 */
export function compareQuestions(sent, got) {
  const problems = []
  if (sent.length !== got.length) problems.push(`the survey holds ${got.length} questions, the instrument has ${sent.length}`)
  const ordered = [...got].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (let i = 0; i < Math.min(sent.length, ordered.length); i += 1) {
    const want = shape(sent[i])
    const have = shape(ordered[i])
    for (const field of Object.keys(want)) {
      if (want[field] !== have[field]) {
        problems.push(`question ${i + 1}: ${field} is ${JSON.stringify(have[field])}, expected ${JSON.stringify(want[field])}`)
      }
    }
  }
  return problems
}

/** One line per thing the run would do. */
export function summarise(doc, request) {
  const lines = [`${doc.items.length} questions in ${doc.categories.length} themes → "${request.title}"`]
  const flags = Object.entries(request.settings).map(([k, v]) => `${k}=${v}`).join(' · ')
  lines.push(`  window ${request.startDate} → ${request.endDate}`)
  lines.push(`  settings: ${flags}`)
  const byType = {}
  for (const q of request.questions) {
    const key = `${q.type}${q.scaleMin == null ? '' : ` ${q.scaleMin}-${q.scaleMax}`}`
    byType[key] = (byType[key] ?? 0) + 1
  }
  for (const [k, n] of Object.entries(byType)) lines.push(`  ${String(n).padStart(3)}  ${k}`)
  return lines
}

// ---------------------------------------------------------------------------------------------
// HTTP. Status is not the answer; the body is.
// ---------------------------------------------------------------------------------------------

async function call(api, path, init = {}, token) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 300) } }
  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message ? body.message : text.slice(0, 300)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${message}`)
  }
  return body
}

async function login(api, email, password) {
  const body = await call(api, '/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  if (!body || typeof body.token !== 'string' || body.token.length < 20) throw new Error('login answered without a token')
  return body.token
}

const titleOf = (survey) => (typeof survey.title === 'string' ? survey.title : (survey.title?.es ?? survey.title?.en ?? ''))

export async function run(values) {
  if (blank(values.file)) throw new Error('--file <instrument.json> is required')
  if (!GUID.test(values['company-id'] ?? '')) throw new Error('--company-id <guid> is required (the tenant the survey belongs to)')
  if (blank(values.title)) throw new Error('--title "…" is required: the survey is matched by title on a re-run')

  const doc = JSON.parse(await readFile(values.file, 'utf8'))
  if (!Array.isArray(doc.items) || doc.items.length === 0) throw new Error(`${values.file} carries no items`)
  if (!Array.isArray(doc.categories)) throw new Error(`${values.file} carries no categories`)

  const window = surveyWindow({ start: values.start, end: values.end })
  if (window.problems.length) throw new Error(window.problems.join('\n'))

  const api = values.api.replace(/\/$/, '')
  const email = values.email ?? process.env.CLIMATE_EMAIL
  const password = values.password ?? process.env.CLIMATE_PASSWORD
  if (blank(email) || blank(password)) throw new Error('credentials: pass --email/--password or set CLIMATE_EMAIL/CLIMATE_PASSWORD')

  const settings = {}
  if (values.anonymous !== undefined) settings.anonymous = values.anonymous
  if (values.randomize !== undefined) settings.randomizeQuestions = values.randomize
  const request = toSurveyRequest(doc, {
    companyId: values['company-id'],
    title: values.title,
    description: values.description,
    startDate: window.startDate,
    endDate: window.endDate,
    serviceType: values['service-type'],
    settings,
  })

  log(`${doc.instrument ?? values.file}`)
  for (const line of summarise(doc, request)) log(line)

  const token = await login(api, email, password)
  const existing = await call(api, `/surveys?companyId=${encodeURIComponent(values['company-id'])}`, {}, token)
  const already = (existing?.surveys ?? []).find((s) => titleOf(s).trim() === values.title.trim())
  if (already) {
    log(`already present: "${values.title}" is survey ${already.id} [${already.status}] — nothing created`)
    return await verify(api, token, already.id, request)
  }

  if (!values.apply) {
    log('dry run: nothing written. Re-run with --apply to create the draft.')
    return { ok: true, dryRun: true }
  }

  const created = await call(api, '/surveys', { method: 'POST', body: JSON.stringify(request) }, token)
  if (!created || !GUID.test(created.id ?? '')) throw new Error(`POST /surveys answered 2xx with no id: ${JSON.stringify(created).slice(0, 300)}`)
  log(`created survey ${created.id} [${created.status}]`)
  return await verify(api, token, created.id, request)
}

/** Read the survey back and compare every question. A 200 that dropped one looks like one that did not. */
async function verify(api, token, surveyId, request) {
  const survey = await call(api, `/surveys/${surveyId}`, {}, token)
  const problems = compareQuestions(request.questions, survey?.questions ?? [])
  log(`verify: ${survey?.questions?.length ?? 0} questions on the server, ${request.questions.length} in the instrument`)
  if (problems.length) {
    log(`MISMATCH (${problems.length}):`)
    for (const p of problems.slice(0, 20)) log(`  - ${p}`)
    if (problems.length > 20) log(`  … and ${problems.length - 20} more`)
    return { ok: false, surveyId, problems }
  }
  log('verify: every statement, type, scale, anchor and theme matches the instrument')
  return { ok: true, surveyId, problems: [] }
}

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      api: { type: 'string', default: 'http://127.0.0.1:5080' },
      file: { type: 'string' },
      'company-id': { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      'service-type': { type: 'string' },
      anonymous: { type: 'string' },
      randomize: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  })
  // A tri-state on purpose: absent means "the climate default", and `--anonymous false` must
  // not read as true the way a bare boolean flag would.
  for (const key of ['anonymous', 'randomize']) {
    if (values[key] === undefined) continue
    if (!['true', 'false'].includes(values[key])) throw new Error(`--${key} takes true or false, got "${values[key]}"`)
    values[key] = values[key] === 'true'
  }
  return values
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = await run(parseCli(process.argv.slice(2)))
    if (!result.ok) process.exit(1)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
