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
  readWorkbook, parseClimate, parseSheet, parseSharedStrings, skipDemographics, surveyWindow, roleForTitle, slug, toImportRows, toSurveyRequest, toFieldRequest, toBandsRequest, toSettingsRequest, validTimeZone, validScale, decodeXml, parseStyles,
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

test('--start/--end: Costa Rica days, 08:00 to 23:59; together or not at all; end after start and not past', () => {
  const now = new Date('2026-10-02T18:00:00Z')
  const window = surveyWindow({ start: '2026-10-08', end: '2026-10-29' }, now)
  assert.deepEqual(window.problems, [])
  assert.equal(window.startDate, '2026-10-08T14:00:00.000Z') // 08:00 at UTC-6
  assert.equal(window.endDate, '2026-10-30T05:59:00.000Z') // 23:59 on the 29th at UTC-6
  assert.equal(surveyWindow({ start: '2026-10-08' }, now).problems.length, 1)
  assert.equal(surveyWindow({ start: '08/10/2026', end: '29/10/2026' }, now).problems.length, 1)
  assert.equal(surveyWindow({ start: '2026-10-29', end: '2026-10-08' }, now).problems.length, 1)
  assert.equal(surveyWindow({ start: '2026-09-01', end: '2026-09-20' }, now).problems.length, 1)
  // No flags: the old placeholder, a week out for three weeks.
  const fallback = surveyWindow({}, now)
  assert.equal(fallback.startDate, '2026-10-09T18:00:00.000Z')
  assert.equal(fallback.endDate, '2026-10-30T18:00:00.000Z')
})

/**
 * The anonymity choice, and the behaviour that rides on it.
 *
 * `anonymous` decides whether `responses.user_id` is written, and that one column is what
 * lets the server refuse a second response: `FindExistingResponseAsync` matches on the acting
 * user, and `SurveyQueries.AssignedTo` filters an answered survey out of "Para responder".
 * With it NULL neither can, which is the repeat-answer report. It does NOT decide what the
 * client sees — `SurveyAggregation` and `SurveyResultsPrivacy` never branch on it.
 */
test('toSurveyRequest: anonymity defaults to anonymous and can be chosen', () => {
  const climate = {
    intro: 'i', invitation: null, bands: [], columns: [], persons: [],
    scale: [{ label: 'Nunca', value: 1 }, { label: 'Siempre', value: 5 }],
    dimensions: [{ name: 'D', open: false, questions: ['q'] }],
  }
  const args = { companyId: 'c', title: 't', departmentIds: [], startDate: 'a', endDate: 'b' }
  assert.equal(toSurveyRequest(climate, args).settings.anonymous, true)
  assert.equal(toSurveyRequest(climate, { ...args, anonymous: true }).settings.anonymous, true)
  assert.equal(toSurveyRequest(climate, { ...args, anonymous: false }).settings.anonymous, false)
})

// ---------------------------------------------------------------------------------------
// Link-only (OPCIONES, no people) — EAGLE's shape. Built from the sample with its people
// removed, so everything else about the workbook is a shape the importer already reads.
// ---------------------------------------------------------------------------------------

const cell = (value) => ({ value, style: { bold: false, filled: false, rgb: null } })
const column = (letter, header, options) => Object.fromEntries([
  [`${letter}5`, cell(header)],
  ...options.map((option, i) => [`${letter}${6 + i}`, cell(option)]),
])
const linkOnly = (options = { ...column('B', 'Sexo', ['Femenino', 'Masculino']), ...column('C', 'Antigüedad', ['De 6 meses a 1 año', 'Mas de 20 años', 'De 1 año a 3 años']), ...column('D', 'Área / Departamento', ['Producción-Inyección', 'Comercial']) }) => {
  const sheets = sample()
  sheets.DEMOGRAFICOS = Object.fromEntries(Object.entries(sheets.DEMOGRAFICOS).filter(([ref]) => Number(ref.replace(/^[A-Z]+/, '')) <= 5))
  sheets.OPCIONES = options
  return sheets
}

test('link-only: OPCIONES and no people is a valid climate — fields in the client\'s order, áreas as departments', () => {
  const { problems, climate } = parseClimate(linkOnly())
  assert.deepEqual(problems, [])
  assert.equal(climate.linkOnly, true)
  assert.deepEqual(climate.departments, ['Producción-Inyección', 'Comercial'])
  assert.deepEqual(climate.columns.map((c) => [c.field, c.type]), [['sexo', 'select'], ['antiguedad', 'select']])
  // NOT sorted: tenure bands are read in the order a respondent should see them.
  assert.deepEqual(climate.columns[1].options, ['De 6 meses a 1 año', 'Mas de 20 años', 'De 1 año a 3 años'])
  assert.deepEqual(toFieldRequest(climate.columns[1], COMPANY, 0).options.map((o) => o.value), ['de_6_meses_a_1_ano', 'mas_de_20_anos', 'de_1_ano_a_3_anos'])
})

test('link-only: the survey invites nobody, counts no audience, and asks the demographics', () => {
  const { climate } = parseClimate(linkOnly())
  const body = toSurveyRequest(climate, { companyId: COMPANY, title: 'Clima', departmentIds: [], startDate: 'a', endDate: 'b' })
  assert.equal(body.targetAudienceCount, null)
  assert.equal(body.settings.selfDeclaredDemographics, true)
  assert.deepEqual(toImportRows(climate), [])
})

test('link-only is refused without an área column, and a sheet with neither people nor OPCIONES still is', () => {
  const noArea = parseClimate(linkOnly(column('B', 'Sexo', ['Femenino', 'Masculino'])))
  assert.ok(noArea.problems.some((p) => /Área \/ Departamento/.test(p)), noArea.problems.join(' | '))

  const sheets = linkOnly()
  delete sheets.OPCIONES
  assert.ok(parseClimate(sheets).problems.some((p) => /no hay personas/.test(p)))
})

test('an OPCIONES column with a header and no options is a problem, not an empty question', () => {
  const { problems } = parseClimate(linkOnly({ ...column('B', 'Sexo', []), ...column('C', 'Área / Departamento', ['Comercial']) }))
  assert.ok(problems.some((p) => /"Sexo"\): no tiene opciones/.test(p)), problems.join(' | '))
})

test('bands: ordered by minimum into critical < opportunity < strength, names carried, whatever order the sheet lists them', () => {
  const request = toBandsRequest([
    { name: 'Áreas de oportunidad', min: 3.8, max: 4.29 },
    { name: 'Áreas de fortaleza', min: 4.3, max: 5 },
    { name: 'Áreas criticas', min: 1, max: 3.79 },
  ])
  assert.deepEqual(request, { opportunityMin: 3.8, strengthMin: 4.3, criticalName: 'Áreas criticas', opportunityName: 'Áreas de oportunidad', strengthName: 'Áreas de fortaleza' })
})

test('settings: the bands and the time zone travel in one request; a mistyped zone is refused', () => {
  const bands = [{ name: 'C', min: 1, max: 3.79 }, { name: 'O', min: 3.8, max: 4.29 }, { name: 'F', min: 4.3, max: 5 }]
  // "EAGLE (prueba)" was left on UTC: an answer at 20:56 in Costa Rica was dated the next day.
  assert.deepEqual(toSettingsRequest(bands, 'America/Costa_Rica'), { resultBands: { ...toBandsRequest(bands), scale: 'mean' }, timezone: 'America/Costa_Rica' })
  assert.equal(validTimeZone('America/Costa_Rica'), 'America/Costa_Rica')
  assert.equal(validTimeZone('UTC'), 'UTC')
  assert.equal(validTimeZone('America/Costa Rica'), null)
  assert.equal(validTimeZone('Costa Rica'), null)
})

test('--scale: mean by default, percent on request, sent as resultBands.scale; anything else is refused', () => {
  const bands = [{ name: 'C', min: 1, max: 3.79 }, { name: 'O', min: 3.8, max: 4.29 }, { name: 'F', min: 4.3, max: 5 }]
  // The default leaves every company reading the 1,00–5,00 mean, as before the option existed.
  assert.equal(toSettingsRequest(bands, 'UTC').resultBands.scale, 'mean')
  // EAGLE answers on 20..100: its bands go on 1–5 (3,8 / 4,3) and read 76 / 86 on percent.
  const percent = toSettingsRequest(bands, 'America/Costa_Rica', 'percent')
  assert.equal(percent.resultBands.scale, 'percent')
  assert.equal(percent.resultBands.opportunityMin, 3.8)
  assert.equal(percent.resultBands.strengthMin, 4.3)
  assert.equal(validScale('mean'), 'mean')
  assert.equal(validScale('percent'), 'percent')
  assert.equal(validScale('Percent'), null)
  assert.equal(validScale('0-100'), null)
  assert.equal(validScale(''), null)
})

/**
 * Found 2026-10-16, against ESPH's own template.
 *
 * Excel writes `<sheet>`, `<c>`, `<v>`; the writer that produced the TIMS climate template
 * writes `<x:sheet>`, `<x:c>`, `<x:v>` and declares `xmlns:x` on the root. Both are valid
 * OOXML for the same elements, and every regex in the reader matched only the unprefixed
 * spelling -- so `readWorkbook` returned ZERO sheets and the run reported "Falta la hoja
 * DESCRIPCION" for all four sheets. A file it could not understand wore the costume of an
 * empty workbook, which is the worst way for this to fail: it reads as the client having
 * sent a blank book.
 */
test('a workbook written with an x: namespace prefix reads the same as one without', () => {
  const plain = '<worksheet><sheetData><row r="1">'
    + '<c r="A1" t="str"><v>Hola</v></c><c r="B1"><v>42</v></c>'
    + '</row></sheetData></worksheet>'
  const prefixed = '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1">'
    + '<x:c r="A1" t="str"><x:v>Hola</x:v></x:c><x:c r="B1"><x:v>42</x:v></x:c>'
    + '</x:row></x:sheetData></x:worksheet>'

  const a = parseSheet(plain, [], [])
  const b = parseSheet(prefixed, [], [])
  assert.equal(a.A1.value, 'Hola')
  assert.equal(a.B1.value, 42)
  assert.deepEqual(Object.keys(b), Object.keys(a))
  assert.equal(b.A1.value, 'Hola')
  assert.equal(b.B1.value, 42)
})

test('shared strings read with an x: prefix too', () => {
  assert.deepEqual(parseSharedStrings('<sst><si><t>uno</t></si><si><t>dos</t></si></sst>'), ['uno', 'dos'])
  assert.deepEqual(
    parseSharedStrings('<x:sst xmlns:x="n"><x:si><x:t>uno</x:t></x:si><x:si><x:t>dos</x:t></x:si></x:sst>'),
    ['uno', 'dos'],
  )
})

/**
 * ESPH's questionnaire heads its last section "Pregunta abierta" -- natural Spanish for a
 * section holding exactly one. The rule matched only the plural, so that question imported
 * as a LIKERT and the respondent would have been shown a 1-5 scale for "¿Hay algún aspecto
 * importante sobre su trabajo, equipo o entorno laboral...?".
 */
test('a dimension titled in the singular, "Pregunta abierta", still holds open questions', () => {
  const sheet = (heading) => ({
    A1: { value: 'PREGUNTAS', style: {} },
    B5: { value: 'Pregunta', style: {} },
    B6: { value: heading, style: { bold: true } },
    B7: { value: '¿Hay algo más que quiera contarnos?', style: {} },
  })
  // Both spellings reach the same place; `parseClimate` needs the rest of the book, so the
  // rule is asserted where it lives -- on the dimension flag the reader sets.
  for (const heading of ['Preguntas abiertas', 'Pregunta abierta', 'PREGUNTA ABIERTA']) {
    const { climate } = parseClimate({ PREGUNTAS: sheet(heading) })
    const dimension = climate.dimensions.find((d) => d.name === heading)
    assert.ok(dimension, `no dimension for ${heading}`)
    assert.equal(dimension.open, true, `${heading} should hold open questions`)
  }
  const { climate } = parseClimate({ PREGUNTAS: sheet('Liderazgo') })
  assert.equal(climate.dimensions.find((d) => d.name === 'Liderazgo').open, false)
})
