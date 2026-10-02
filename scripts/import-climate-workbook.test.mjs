/**
 * Pure-function tests for the climate workbook importer. No network. `node --test scripts/`.
 *
 * The fixtures are the blank template handed to companies and a sample filled with invented
 * people at ejemplo.test — no real person is in this repository. Each block also feeds the
 * "wrong" input, so an assertion that only ever saw the right answer cannot pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  readWorkbook, parseClimate, skipDemographics, roleForTitle, slug, toImportRows, toSurveyRequest, toFieldRequest, decodeXml, parseStyles,
} from './import-climate-workbook.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sample = () => readWorkbook(join(here, 'fixtures', 'climate-workbook.sample.xlsx'))
const template = () => readWorkbook(join(here, 'fixtures', 'climate-workbook.template.xlsx'))
const COMPANY = '22cc8ed9-2e02-401a-8d52-52068ff5e6c0'

test('the sample reads whole: texts, bands with their colours, the scale, 9 dimensions + open questions, people', () => {
  const { problems, climate } = parseClimate(sample())
  assert.deepEqual(problems, [])
  assert.match(climate.intro, /confidencial/)
  assert.equal(climate.invitation.subject, 'Tu opinión cuenta – Encuesta de Clima 2026')
  assert.match(climate.invitation.message, /^Hola:/)
  assert.deepEqual(climate.bands.map((b) => [b.min, b.max, b.color]), [[4, 5, 'FF70AD47'], [3, 3.99, 'FFFFC000'], [1, 2.99, 'FFC00000']])
  assert.deepEqual(climate.scale.map((p) => p.label), ['Nunca', 'Casi nunca', 'Algunas veces', 'Casi siempre', 'Siempre'])
  const closed = climate.dimensions.filter((d) => !d.open)
  assert.equal(closed.length, 9)
  assert.deepEqual(closed.map((d) => d.questions.length), [3, 5, 4, 8, 4, 4, 3, 3, 4])
  assert.deepEqual(climate.dimensions.filter((d) => d.open).map((d) => d.questions.length), [2])
  assert.equal(climate.persons.length, 5)
})

test('a dimension title is told from a statement by its fill or weight, not by a style index', () => {
  // The template was re-saved by another writer, so its style indices differ from the
  // original's; the dimensions must still be found.
  const { climate } = parseClimate(template())
  assert.equal(climate.dimensions.filter((d) => !d.open).length, 9)
  assert.equal(climate.dimensions[0].name, 'Claridad y organización')
  // Wrong: a plain, unstyled cell ending in a period is a statement, not a dimension.
  const sheets = sample()
  sheets.PREGUNTAS.B7 = { value: 'Una afirmación cualquiera.', style: { bold: false, filled: false, rgb: null } }
  const { climate: again } = parseClimate(sheets)
  assert.equal(again.dimensions[0].questions[0], 'Una afirmación cualquiera.')
})

test('the blank template is refused with every reason at once, not the first', () => {
  const { problems } = parseClimate(template())
  assert.ok(problems.some((p) => /B6/.test(p)), 'no description reported')
  assert.ok(problems.some((p) => /no hay personas/.test(p)), 'no people reported')
  assert.ok(problems.length >= 2)
})

test('people: the Promedio row ends the list, a duplicate email and a bad email are refused', () => {
  const sheets = sample()
  sheets.DEMOGRAFICOS.B12 = { value: 'Promedio', style: {} }
  sheets.DEMOGRAFICOS.D13 = { value: 'despues@ejemplo.test', style: {} }
  assert.equal(parseClimate(sheets).climate.persons.length, 5, 'a row after Promedio was read')
  sheets.DEMOGRAFICOS.D7 = { value: 'ana.uno@ejemplo.test', style: {} }
  sheets.DEMOGRAFICOS.D8 = { value: 'no-es-un-correo', style: {} }
  const { problems } = parseClimate(sheets)
  assert.ok(problems.some((p) => /ya está en la fila 6/.test(p)))
  assert.ok(problems.some((p) => /fila 8: correo inválido/.test(p)))
})

test('a scale that skips a value is refused', () => {
  const sheets = sample()
  assert.deepEqual(parseClimate(sheets).problems, [])
  sheets.ESCALAS.C17 = { value: 7, style: {} }
  assert.ok(parseClimate(sheets).problems.some((p) => /enteros consecutivos/.test(p)))
})

test('demographic columns: all-numeric is a number field, anything else a list of its distinct values', () => {
  const { climate } = parseClimate(sample())
  const byHeader = Object.fromEntries(climate.columns.map((c) => [c.header, c]))
  assert.equal(byHeader.Edad.type, 'number')
  assert.equal(byHeader['País'].type, 'select')
  assert.deepEqual(byHeader['País'].options, ['Colombia', 'Costa Rica', 'Guatemala'])
  assert.equal(byHeader['Género'].field, 'genero')
  const request = toFieldRequest(byHeader['País'], COMPANY, 0)
  assert.deepEqual(request.options.map((o) => o.value), ['colombia', 'costa_rica', 'guatemala'])
  assert.equal(toFieldRequest(byHeader.Edad, COMPANY, 1).options, null)
})

test('rows: role by job title, demographics keyed by field, list values slugged and numbers kept', () => {
  const { climate } = parseClimate(sample())
  const rows = toImportRows(climate)
  const ana = rows.find((r) => r.email === 'ana.uno@ejemplo.test')
  assert.equal(ana.role, 'leader')
  assert.equal(ana.name, 'Ana Ejemplo Uno')
  assert.equal(ana.demographics.pais, 'costa_rica')
  assert.equal(ana.demographics.edad, '41')
  assert.equal(rows.find((r) => r.email === 'luis.dos@ejemplo.test').demographics[slug('Tiempo de laborar en [Empresa] (años)')], '2.5')
  assert.equal(rows.find((r) => r.email === 'pedro.cuatro@ejemplo.test').role, 'employee')
})

test('roleForTitle: directors, managers and presidents lead; an analyst does not', () => {
  for (const title of ['Director General', 'Directora Departamenteo de Consultoría', 'Gerente', 'Presidente', 'Gerente General']) assert.equal(roleForTitle(title), 'leader', title)
  for (const title of ['Analista de QA y Soporte', 'Contadora', 'Ingeniero UI-UX', null]) assert.equal(roleForTitle(title), 'employee', String(title))
})

test('the survey request: likert with the five labels, open questions open, anonymous, invitation texts carried', () => {
  const { climate } = parseClimate(sample())
  const body = toSurveyRequest(climate, { companyId: COMPANY, title: 'Clima 2026', departmentIds: ['d1'], startDate: 's', endDate: 'e' })
  assert.equal(body.questions.length, 40)
  const likert = body.questions.filter((q) => q.type === 'likert')
  assert.equal(likert.length, 38)
  assert.deepEqual(likert[0].options.map((o) => [o.value, o.label.es]), [['1', 'Nunca'], ['2', 'Casi nunca'], ['3', 'Algunas veces'], ['4', 'Casi siempre'], ['5', 'Siempre']])
  assert.equal(likert[0].category, 'Claridad y organización')
  assert.ok(body.questions.filter((q) => q.type === 'open_ended').every((q) => q.required === false))
  assert.equal(body.settings.anonymous, true)
  assert.equal(body.settings.invitationCustomSubject.es, 'Tu opinión cuenta – Encuesta de Clima 2026')
  assert.deepEqual(body.questions.map((q) => q.order), [...body.questions.keys()])
})

test('xml helpers: entities and a bold font are read', () => {
  assert.equal(decodeXml('a &amp; b &#241; &#x41;'), 'a & b ñ A')
  const styles = parseStyles('<fonts><font><b/></font><font><sz val="11"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF002060"/></patternFill></fill></fills><cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="1"/></cellXfs>')
  assert.deepEqual(styles, [{ bold: true, filled: false, rgb: null }, { bold: false, filled: true, rgb: 'FF002060' }])
})

test('--skip-demographic leaves a column out of the fields and out of every row, by header or key', () => {
  const { climate } = parseClimate(sample())
  const { problems, skipped, climate: kept } = skipDemographics(climate, ['edad', 'Tiempo de laborar en [Empresa] (años)'])
  assert.deepEqual(problems, [])
  assert.deepEqual(skipped.sort(), ['Edad', 'Tiempo de laborar en [Empresa] (años)'])
  assert.deepEqual(kept.columns.map((c) => c.field).sort(), ['genero', 'pais', 'region'])
  for (const row of toImportRows(kept)) {
    assert.equal(row.demographics.edad, undefined)
    assert.equal(row.demographics[slug('Tiempo de laborar en [Empresa] (años)')], undefined)
  }
  // Untouched when nothing is named, and a name that matches nothing is refused, not ignored.
  assert.equal(skipDemographics(climate, []).climate.columns.length, climate.columns.length)
  assert.equal(skipDemographics(climate, ['Edadd']).problems.length, 1)
})
