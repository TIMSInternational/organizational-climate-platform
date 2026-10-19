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
  readWorkbook, parseClimate, parseSheet, parseSharedStrings, skipDemographics, surveyWindow, roleForTitle, slug, toImportRows, toSurveyRequest, toFieldRequest, toBandsRequest, toSettingsRequest, validTimeZone, validScale, decodeXml, parseStyles, applyCompanyName, existingOptionInputs, mergeFieldOptions, chunkRows, surveyDepartmentIds, IMPORT_CHUNK_ROWS, validLanguage, credentialDelivery,
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
  // Required, like every other question. Ruled 2026-10-18 on ESPH's finding 8 -- *"La
  // pregunta 63 abierta sale como opcional"* -- so the open question is no longer the one
  // a respondent can walk past. This asserted `=== false` until that day.
  assert.ok(body.questions.filter((q) => q.type === 'open_ended').every((q) => q.required === true))
  assert.ok(body.questions.every((q) => q.required === true))
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
  // The language rides along: Company.Language defaults to "en" and this is the only call that can set it.
  assert.deepEqual(toSettingsRequest(bands, 'America/Costa_Rica'), { resultBands: { ...toBandsRequest(bands), scale: 'mean' }, timezone: 'America/Costa_Rica', language: 'es' })
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

test('applyCompanyName substitutes the template placeholder everywhere the C# parser does', () => {
  const climate = {
    intro: 'el trabajo en [Empresa] e identificar',
    invitation: { subject: 'Invitación al clima organizacional de [Empresa]', message: 'Hola, [Empresa] le invita' },
    dimensions: [{ name: 'D', questions: [{ text: 'Confío en [Empresa]' }, 'Recomiendo [Empresa]'] }],
  }
  const out = applyCompanyName(climate, 'ESPH')
  assert.equal(out.intro, 'el trabajo en ESPH e identificar')
  assert.equal(out.invitation.subject, 'Invitación al clima organizacional de ESPH')
  assert.equal(out.invitation.message, 'Hola, ESPH le invita')
  assert.equal(out.dimensions[0].questions[0].text, 'Confío en ESPH')
  assert.equal(out.dimensions[0].questions[1], 'Recomiendo ESPH')
  // No name: leave the text alone rather than substitute an empty string.
  assert.equal(applyCompanyName(climate, undefined).invitation.subject,
    'Invitación al clima organizacional de [Empresa]')
})

// ---------------------------------------------------------------------------------------
// Extending a field that already exists. The case is ESPH's, measured 2026-10-16: the
// Contraloría roster carries one Proceso and two Jefaturas that the Clima import, which runs
// first and creates the fields, never saw. `DemographicValueValidation` refuses a value outside
// a select's options, so every row carrying one became a hard `error` and the run was refused.
// ---------------------------------------------------------------------------------------

const FIELD_ES = {
  id: 'f1', field: 'proceso', type: 'select', label: 'Proceso',
  options: [
    { order: 0, value: 'negocio_ap_automatizacion', label: 'Negocio AP - Automatización' },
    { order: 1, value: 'negocio_ee_redes', label: 'Negocio EE - Redes' },
  ],
  fallbackFields: [],
}
const FIELD_EN = { ...FIELD_ES, options: FIELD_ES.options.map((o) => ({ ...o })), fallbackFields: [] }

test('an existing field is extended only by the options it does not already carry, and keeps the order it had', () => {
  const existing = existingOptionInputs(FIELD_ES, FIELD_EN)
  const wanted = ['Negocio EE - Redes', 'Contraloría Empresarial', 'Junta Directiva']
    .map((label) => ({ value: slug(label), label: { es: label, en: label } }))
  const merge = mergeFieldOptions(existing, wanted)
  assert.deepEqual(merge.added.map((o) => o.value), ['contraloria_empresarial', 'junta_directiva'])
  // The two it had come first and unchanged; nothing is removed and nothing is renamed.
  assert.deepEqual(merge.options.map((o) => o.value), [
    'negocio_ap_automatizacion', 'negocio_ee_redes', 'contraloria_empresarial', 'junta_directiva',
  ])
  assert.deepEqual(merge.options[0].label, { es: 'Negocio AP - Automatización', en: 'Negocio AP - Automatización' })
  // ...and a workbook that adds nothing writes nothing at all.
  assert.equal(mergeFieldOptions(existing, [{ value: 'negocio_ee_redes', label: { es: 'x', en: 'x' } }]), null)
  assert.equal(mergeFieldOptions(existing, []), null)
})

test('an option the API resolved from the OTHER language is not re-sent as that language', () => {
  // `ToDetail` resolves one label per option and names the ones it had to fall back for. An
  // English-only option asked for in Spanish comes back with the English text; re-sending it as
  // `es` would invent a Spanish label the field never had. PUT replaces the whole list, so this
  // is the one chance to get it wrong.
  const es = {
    ...FIELD_ES,
    options: [{ order: 0, value: 'english_only', label: 'English only' }],
    fallbackFields: ['options[0].label'],
  }
  const en = {
    ...FIELD_ES,
    options: [{ order: 0, value: 'english_only', label: 'English only' }],
    fallbackFields: [],
  }
  assert.deepEqual(existingOptionInputs(es, en), [{ value: 'english_only', label: { en: 'English only' } }])
  // The reverse direction, and an option with no label at all, keep their value either way.
  assert.deepEqual(existingOptionInputs({ ...es, fallbackFields: [] }, { ...en, fallbackFields: ['options[0].label'] }),
    [{ value: 'english_only', label: { es: 'English only' } }])
  assert.deepEqual(existingOptionInputs({ ...es, options: [{ order: 0, value: 'v', label: null }], fallbackFields: [] }, { ...en, options: [] }),
    [{ value: 'v', label: null }])
})

test('a value already stored on a user is passed through verbatim, never derived again', () => {
  // user_demographics.value holds the option's `value`. A field created before `slug` changed —
  // or by the product rather than this importer — can hold a value that slug() would not
  // produce; re-deriving it would silently orphan everyone already carrying it.
  const es = { ...FIELD_ES, options: [{ order: 0, value: 'Negocio-AP', label: 'Negocio AP' }], fallbackFields: [] }
  const inputs = existingOptionInputs(es, { ...es })
  assert.deepEqual(inputs.map((o) => o.value), ['Negocio-AP'])
  assert.notEqual(inputs[0].value, slug('Negocio AP'))
  // and it is NOT treated as missing when the workbook asks for the slugged spelling
  const merge = mergeFieldOptions(inputs, [{ value: 'Negocio-AP', label: { es: 'Negocio AP', en: 'Negocio AP' } }])
  assert.equal(merge, null)
})

// ---------------------------------------------------------------------------------------
// The two things that would have broken ESPH's launch morning, measured 2026-10-16.
// ---------------------------------------------------------------------------------------

test('an apply is split into requests of at most 100 rows, because 617 in one cannot finish', () => {
  // App Runner kills a request at 120 s; a row costs ~0.27 vCPU-s of bcrypt plus a paced email,
  // so `rows x 0.27 + rows/10` — 300 rows is ~111 s and 400 is killed. ESPH's Clima roster is
  // 617 people in one file. See IMPORT_CHUNK_ROWS.
  assert.equal(IMPORT_CHUNK_ROWS, 100)
  const rows = Array.from({ length: 617 }, (_, i) => ({ email: `p${i}@ejemplo.test` }))
  const batches = chunkRows(rows)
  assert.equal(batches.length, 7)
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 100, 100, 100, 100, 17])
  // Every row appears exactly once and in order — a batching bug that drops or repeats a row
  // creates the wrong number of accounts, which is the one thing nothing downstream would catch.
  assert.deepEqual(batches.flat().map((r) => r.email), rows.map((r) => r.email))
  // The estimate each batch has to beat.
  for (const batch of batches) assert.ok(batch.length * 0.27 + batch.length / 10 < 120)
  // Exact multiples leave no empty trailing batch; an empty file is no requests at all.
  assert.deepEqual(chunkRows(rows.slice(0, 200)).map((b) => b.length), [100, 100])
  assert.deepEqual(chunkRows([]), [])
  assert.throws(() => chunkRows(rows, 0), /positive whole number/)
})

test('a survey is targeted at the workbook’s own departments, not at every department the company has', () => {
  // ESPH's order is clima then contraloria into the SAME company. "Every active department"
  // made the Contraloría survey — written for its 8 people — visible to all 625.
  const climate = {
    linkOnly: false,
    persons: [
      { department: 'Contraloría Empresarial' },
      { department: 'Contraloría Empresarial' },
    ],
    departments: [],
  }
  const company = [
    { id: 'd1', name: 'Administración', isActive: true },
    { id: 'd2', name: 'Negocio de Agua Potable', isActive: true },
    { id: 'd3', name: 'Contraloría Empresarial', isActive: true },
  ]
  const audience = surveyDepartmentIds(climate, company)
  assert.deepEqual(audience.departmentIds, ['d3'])
  assert.deepEqual(audience.wanted, ['Contraloría Empresarial'])
  assert.deepEqual(audience.missing, [])

  // For the company this import just created, every active department IS the workbook's, so
  // nothing changes for the ordinary single-import case.
  const clima = { linkOnly: false, persons: [{ department: 'Administración' }, { department: 'Negocio de Agua Potable' }], departments: [] }
  assert.deepEqual(surveyDepartmentIds(clima, company.slice(0, 2)).departmentIds, ['d1', 'd2'])

  // A retired department is not somewhere to aim a survey.
  assert.deepEqual(surveyDepartmentIds(climate, [{ id: 'd3', name: 'Contraloría Empresarial', isActive: false }]).missing,
    ['Contraloría Empresarial'])

  // A name that does not resolve is REPORTED, never skipped: skipping it shrinks the audience
  // silently, and a case difference is exactly how that happens.
  assert.deepEqual(surveyDepartmentIds(climate, [{ id: 'd9', name: 'contraloría empresarial', isActive: true }]),
    { wanted: ['Contraloría Empresarial'], missing: ['Contraloría Empresarial'], departmentIds: [] })

  // Link-only mode has no people; its departments come from OPCIONES.
  assert.deepEqual(surveyDepartmentIds({ linkOnly: true, persons: [], departments: ['Administración'] }, company).departmentIds, ['d1'])
})

test('the company language is set, because the entity default "en" puts English first in 642 emails', () => {
  // Company.Language defaults to "en" and CreateCompanyRequest cannot carry it, so this
  // settings call is the only way. It decides which half of the bilingual credential email
  // comes first — see toSettingsRequest.
  const bands = [{ min: 4, max: 5, name: 'F', color: 'FF70AD47' }, { min: 3, max: 3.99, name: 'O', color: 'FFFFC000' }, { min: 1, max: 2.99, name: 'C', color: 'FFC00000' }]
  assert.equal(toSettingsRequest(bands, 'America/Costa_Rica', 'mean', 'es').language, 'es')
  assert.equal(toSettingsRequest(bands, 'America/Costa_Rica', 'mean', 'en').language, 'en')
  // The default is the one ESPH needs: an unpassed flag must not mean English.
  assert.equal(toSettingsRequest(bands, 'America/Costa_Rica').language, 'es')
  // ...and it does not disturb what the call already sent.
  const sent = toSettingsRequest(bands, 'America/Costa_Rica', 'percent', 'es')
  assert.equal(sent.timezone, 'America/Costa_Rica')
  assert.equal(sent.resultBands.scale, 'percent')

  // A typo is refused, not passed through: the endpoint ignores a blank/unknown language and
  // the company would silently stay English.
  assert.equal(validLanguage('es'), 'es')
  assert.equal(validLanguage('en'), 'en')
  assert.equal(validLanguage('Español'), null)
  assert.equal(validLanguage('ES'), null)
  assert.equal(validLanguage(''), null)
  assert.equal(validLanguage(undefined), null)
})

// ---------------------------------------------------------------------------------------
// Credential delivery. The invitation every respondent gets says "si es su primera
// participación, recibirá sus datos de acceso en un correo separado" — so whether that mail
// actually went out is a promise the import makes on the product's behalf.
// ---------------------------------------------------------------------------------------

const row = (n, email, status, issues = [], errors = []) =>
  ({ rowNumber: n, email, status, issues: issues.map((code) => ({ code })), errors })

test('a created account whose credential mail failed is named, though it has no errors and status "created"', () => {
  // THE regression. The endpoint records a failed send as an ISSUE on a row that is otherwise a
  // success: status `created`, errors empty, counted in successCount. Filtering on either —
  // which is what this script did — reports that person as fine. They then hold an account they
  // cannot sign in to and still receive the invitation.
  const rows = [
    row(6, 'ana@ejemplo.test', 'created'),
    row(7, 'bruno@ejemplo.test', 'created', ['credentials_not_sent']),
    row(8, 'carla@ejemplo.test', 'created'),
  ]
  const d = credentialDelivery(rows, true)
  assert.equal(d.verdict, 'some_failed')
  assert.deepEqual(d.unmailed.map((r) => r.email), ['bruno@ejemplo.test'])
  assert.equal(d.created, 3)
  // Proof the row really does look like a success by every other measure.
  const bruno = rows[1]
  assert.deepEqual(bruno.errors, [])
  assert.equal(bruno.status, 'created')
})

test('the issue is found alongside others, and never confused with an unrelated one', () => {
  assert.equal(credentialDelivery([row(6, 'a@b.test', 'created', ['already_user', 'credentials_not_sent'])], true).verdict, 'some_failed')
  // A different issue on a created row is not a delivery failure.
  assert.equal(credentialDelivery([row(6, 'a@b.test', 'created', ['invalid_demographic'])], true).verdict, 'all_accepted')
})

test('a clean run SAYS it is clean, so silence is never the evidence', () => {
  const d = credentialDelivery([row(6, 'a@b.test', 'created'), row(7, 'c@d.test', 'created')], true)
  assert.equal(d.verdict, 'all_accepted')
  assert.equal(d.created, 2)
  assert.deepEqual(d.unmailed, [])
})

test('nothing is claimed when no credential was being sent, or nobody was created', () => {
  // The invitation path sends no credentials at all, so it must not report on them.
  assert.equal(credentialDelivery([row(6, 'a@b.test', 'invited')], false).verdict, 'nothing_to_report')
  assert.equal(credentialDelivery([row(6, 'a@b.test', 'created')], false).verdict, 'nothing_to_report')
  // A re-run that creates nobody has nothing to say either.
  assert.equal(credentialDelivery([row(6, 'a@b.test', 'duplicate', ['already_user'], ['exists'])], true).verdict, 'nothing_to_report')
  assert.equal(credentialDelivery([], true).verdict, 'nothing_to_report')
  assert.equal(credentialDelivery(undefined, true).verdict, 'nothing_to_report')
  // ...but a failure still outranks "nobody created", because the row IS the failure.
  assert.equal(credentialDelivery([row(6, 'a@b.test', 'created', ['credentials_not_sent'])], false).verdict, 'some_failed')
})

test('a row with no issues array at all does not throw', () => {
  assert.equal(credentialDelivery([{ rowNumber: 6, email: 'a@b.test', status: 'created' }], true).verdict, 'all_accepted')
})
