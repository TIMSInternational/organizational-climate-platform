/**
 * Pure-function tests for the survey builder: the request shape, the settings that carry the
 * client's commitments, and the comparison that decides whether the survey on the server is
 * the instrument. No network. `node --test scripts/`.
 *
 * Each block ends with the mutation that proves the assertion has teeth: `compareQuestions`
 * returning [] is only worth something if it does NOT return [] for a survey that lost,
 * reordered or reworded a question.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { toSurveyRequest, compareQuestions, parseCli, CLIMATE_SETTINGS } from './create-survey-from-instrument.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const doc = JSON.parse(await readFile(join(here, 'fixtures', 'procomer-2026-instrument.json'), 'utf8'))
const COMPANY = '8e521f4c-f9fa-4791-9f79-8b92d6289a16'

const build = (over = {}) => toSurveyRequest(doc, {
  companyId: COMPANY,
  title: 'Encuesta de Clima Organizacional PROCOMER 2026',
  startDate: '2026-10-20T14:00:00.000Z',
  endDate: '2026-11-08T05:59:00.000Z',
  ...over,
})

test('every instrument item becomes one question, in file order', () => {
  const request = build()
  assert.equal(request.questions.length, doc.items.length)
  assert.equal(request.questions.length, 59)
  assert.deepEqual(request.questions.map((q) => q.order), doc.items.map((_, i) => i))
  assert.deepEqual(request.questions.map((q) => q.text), doc.items.map((i) => i.textEs))
})

test('the text is a bare Spanish string, so nothing claims an English version exists', () => {
  for (const q of build().questions) {
    assert.equal(typeof q.text, 'string')
    assert.ok(q.text.length > 0)
  }
  assert.equal(build().language, 'es')
})

test('the theme is sent as its Spanish name, which is what results group by', () => {
  const request = build()
  const names = new Set(doc.categories.map((c) => c.nameEs))
  for (const q of request.questions) assert.ok(names.has(q.category), `category "${q.category}" is not a theme name`)
  assert.equal(request.questions[0].category, 'Validación')
  assert.equal(request.questions.at(-1).category, 'Especiales')
  // Never the slug: a key in `category` would surface as a section heading in the product.
  for (const q of request.questions) assert.ok(!/_/.test(q.category), `"${q.category}" looks like a key, not a name`)
})

test('the scale and its anchors travel with the question, including the 0-10 one', () => {
  const request = build()
  const likert = request.questions.filter((q) => q.type === 'likert')
  assert.equal(likert.length, 57)
  for (const q of likert) {
    assert.equal(q.scaleMin, 1)
    assert.equal(q.scaleMax, 5)
    assert.equal(q.scaleLabelMin, 'Totalmente en desacuerdo')
    assert.equal(q.scaleLabelMax, 'Totalmente de acuerdo')
  }
  const enps = request.questions.filter((q) => q.type === 'rating')
  assert.equal(enps.length, 1)
  assert.equal(enps[0].scaleMin, 0)
  assert.equal(enps[0].scaleMax, 10)
  assert.equal(enps[0].scaleLabelMin, 'Nada probable')

  const open = request.questions.filter((q) => q.type === 'open_ended')
  assert.equal(open.length, 1)
  assert.equal(open[0].scaleMin, undefined, 'an open question must not carry a scale')
  assert.equal(open[0].scaleLabelMin, undefined)
})

test('only the open question may be left unanswered', () => {
  for (const q of build().questions) {
    assert.equal(q.required, q.type !== 'open_ended', `${q.type} required=${q.required}`)
    assert.equal(q.commentRequired, false)
  }
})

test('the settings carry the commitments from the client minuta', () => {
  const request = build()
  // Random order AND the dimension hidden: respondDimensions stops sectioning a randomised
  // survey, so this one flag delivers both of the 12 Aug agreements.
  assert.equal(request.settings.randomizeQuestions, true)
  // "Retomarla desde la última pregunta contestada".
  assert.equal(request.settings.allowPartialResponses, true)
  assert.equal(request.settings.autoSave, true)
  // "Mecanismos de confidencialidad": no user_id is written.
  assert.equal(request.settings.anonymous, true)
  assert.equal(request.settings.showProgress, true)
  assert.deepEqual(request.settings, CLIMATE_SETTINGS)

  // And each one is overridable, because the defaults are a climate instrument's, not a law.
  assert.equal(build({ settings: { anonymous: false } }).settings.anonymous, false)
  assert.equal(build({ settings: { randomizeQuestions: false } }).settings.randomizeQuestions, false)
})

test('a draft is created and nothing in the request can publish it', () => {
  const request = build()
  assert.equal(request.status, undefined, 'status is not part of POST /surveys; lifecycle is PUT /surveys/{id}/status')
  assert.equal(request.type, 'periodic')
  assert.equal(request.companyId, COMPANY)
  assert.equal(request.serviceType, undefined, 'unmetered unless --service-type says otherwise')
  assert.equal(build({ serviceType: 'climate' }).serviceType, 'climate')
  assert.equal(request.description, undefined, 'omitted rather than sent blank')
  assert.equal(build({ description: 'Hola.' }).description, 'Hola.')
})

test('comparing the survey back finds a question that was dropped, moved or reworded', () => {
  const sent = build().questions
  const asServerReportsIt = sent.map((q, order) => ({
    id: `q${order}`,
    text: { es: q.text, en: null },
    type: q.type,
    category: q.category,
    scaleMin: q.scaleMin ?? null,
    scaleMax: q.scaleMax ?? null,
    scaleLabelMin: q.scaleLabelMin ? { es: q.scaleLabelMin, en: null } : null,
    scaleLabelMax: q.scaleLabelMax ? { es: q.scaleLabelMax, en: null } : null,
    order,
  }))
  assert.deepEqual(compareQuestions(sent, asServerReportsIt), [])

  // Out of order on the wire is not a mismatch: the comparison sorts by `order` first.
  assert.deepEqual(compareQuestions(sent, [...asServerReportsIt].reverse()), [])

  const dropped = asServerReportsIt.filter((_, i) => i !== 40)
  assert.ok(compareQuestions(sent, dropped).some((p) => /holds 58 questions/.test(p)))

  const reworded = JSON.parse(JSON.stringify(asServerReportsIt))
  reworded[6].text.es = 'Mi jefatura comunica de manera oportuna la información necesaria para mi desempeño efectivo.'
  const wordProblems = compareQuestions(sent, reworded)
  assert.equal(wordProblems.length, 1)
  assert.match(wordProblems[0], /^question 7: text is/)

  const rethemed = JSON.parse(JSON.stringify(asServerReportsIt))
  rethemed[0].category = 'Especiales'
  assert.ok(compareQuestions(sent, rethemed).some((p) => /question 1: category/.test(p)))

  const rescaled = JSON.parse(JSON.stringify(asServerReportsIt))
  rescaled[57].scaleMax = 5
  assert.ok(compareQuestions(sent, rescaled).some((p) => /question 58: scaleMax is 5, expected 10/.test(p)))

  const unanchored = JSON.parse(JSON.stringify(asServerReportsIt))
  unanchored[1].scaleLabelMax = null
  assert.ok(compareQuestions(sent, unanchored).some((p) => /question 2: scaleLabelMax/.test(p)))

  // A swap of two statements must be reported as two differences, not silently matched by text.
  const swapped = JSON.parse(JSON.stringify(asServerReportsIt))
  const first = swapped[2].text.es
  swapped[2].text.es = swapped[3].text.es
  swapped[3].text.es = first
  assert.equal(compareQuestions(sent, swapped).length, 2)
})

test('comparing accepts a plain string where the server answers one', () => {
  const sent = [{ text: 'Hola.', type: 'likert', category: 'A', scaleMin: 1, scaleMax: 5, scaleLabelMin: 'x', scaleLabelMax: 'y' }]
  const got = [{ text: 'Hola.', type: 'likert', category: 'A', scaleMin: 1, scaleMax: 5, scaleLabelMin: 'x', scaleLabelMax: 'y', order: 0 }]
  assert.deepEqual(compareQuestions(sent, got), [])
  assert.equal(compareQuestions(sent, []).length, 1)
})

test('--anonymous and --randomize are tri-state, so "false" is not read as true', () => {
  assert.equal(parseCli(['--file', 'x.json']).anonymous, undefined)
  assert.equal(parseCli(['--file', 'x.json', '--anonymous', 'false']).anonymous, false)
  assert.equal(parseCli(['--file', 'x.json', '--anonymous', 'true']).anonymous, true)
  assert.equal(parseCli(['--file', 'x.json', '--randomize', 'false']).randomize, false)
  assert.throws(() => parseCli(['--file', 'x.json', '--anonymous', 'si']), /takes true or false/)
  // --apply is the only thing that writes, and it is off unless asked for.
  assert.equal(parseCli(['--file', 'x.json']).apply, false)
  assert.equal(parseCli(['--file', 'x.json', '--apply']).apply, true)
})
