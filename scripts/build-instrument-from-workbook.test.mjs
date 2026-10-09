/**
 * Tests for the instrument builder. No network. `node --test scripts/`.
 *
 * The first test is the one that matters: `scripts/fixtures/procomer-2026-instrument.json` is
 * what gets imported, and this asserts it is still exactly what the committed workbook says.
 * Edit a statement in the JSON by hand and this test fails — which is the point, because a
 * statement in the product that the client never approved is the one defect this whole path
 * exists to prevent.
 *
 * Each block ends with the mutation that proves the assertion has teeth.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  run, locateColumns, readStatements, buildInstrument, parseScale, tidy, fold, ANCHORS, TYPE_BY_TIPO,
} from './build-instrument-from-workbook.mjs'
import { validateInstrument } from './import-question-library.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const WORKBOOK = join(here, 'fixtures', 'procomer-2026-instrument.xlsx')
const INSTRUMENT = join(here, 'fixtures', 'procomer-2026-instrument.json')

/** The sha256 of the workbook Procomer sent on 2026-10-08, as received. */
const SOURCE_SHA256 = '097be9f5972472a21d62b94f80b92a9ccdf21c0f3c89baa5ab0518125618a925'

/** A synthetic sheet: `{ A1: 'x' }` → the `{ ref: { value } }` shape `parseSheet` produces. */
const sheet = (map) => Object.fromEntries(Object.entries(map).map(([ref, value]) => [ref, { value, style: {} }]))

const HEADER = { A4: '#', B4: 'Tema', C4: 'Dimensión', G4: 'Escala', H4: 'Tipo', Q4: 'Versión Final para TIMS' }
const ROW = { A5: 1, B5: 'I. Liderazgo', C5: 'Confianza', G5: 'Likert 1-5', H5: 'Likert', Q5: 'Mi jefatura escucha.' }

test('the committed instrument is exactly what the committed workbook says', async () => {
  const fresh = await run({ file: WORKBOOK, 'text-header': 'versión final', tag: 'procomer-2026', instrument: null, out: null, quiet: true })
  const pinned = JSON.parse(await readFile(INSTRUMENT, 'utf8'))

  assert.equal(fresh.sha256, SOURCE_SHA256, 'the workbook has changed since the instrument was generated')
  assert.deepEqual(pinned.categories, fresh.doc.categories)
  assert.deepEqual(pinned.items, fresh.doc.items)
  assert.equal(pinned.source.sha256, SOURCE_SHA256)
  assert.equal(pinned.source.textColumn, 'Q (Versión Final para TIMS)')

  // Mutation: a single edited word in the pinned file must fail the comparison above.
  const tampered = JSON.parse(JSON.stringify(pinned))
  tampered.items[0].textEs = `${tampered.items[0].textEs} (editado)`
  assert.notDeepEqual(tampered.items, fresh.doc.items)
})

test('the instrument is 59 statements: 57 numbered plus the two validation items', async () => {
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  assert.equal(doc.items.length, 59)
  assert.equal(doc.categories.length, 13)

  const numbered = doc.items.filter((i) => /^item-\d+$/.test(i.tags[1]))
  assert.equal(numbered.length, 57, 'the client calls this a 57-item instrument')
  assert.deepEqual(
    numbered.map((i) => Number(i.tags[1].slice(5))),
    Array.from({ length: 57 }, (_, n) => n + 1),
    'the numbered items must be 1..57 in order, with none missing and none repeated',
  )
  assert.deepEqual(doc.items.filter((i) => !/^item-\d+$/.test(i.tags[1])).map((i) => i.tags[1]), ['item-VAL1', 'item-VAL2'])

  const types = doc.items.reduce((acc, i) => ({ ...acc, [i.type]: (acc[i.type] ?? 0) + 1 }), {})
  assert.deepEqual(types, { likert: 57, rating: 1, open_ended: 1 })
})

test('the instrument passes the importer own validator, which is what will load it', async () => {
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  assert.deepEqual(validateInstrument(doc), [])

  // Mutation: the natural key is (category, textEn), so a duplicated statement must be refused
  // rather than silently creating two rows the importer can never tell apart again.
  const doubled = JSON.parse(JSON.stringify(doc))
  doubled.items.push({ ...doubled.items[0] })
  assert.ok(validateInstrument(doubled).some((e) => /duplicate/.test(e)))
})

test('eNPS is a rating scored 0-10, because only likert and rating get a mean', async () => {
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  const enps = doc.items.filter((i) => i.dimension === 'eNPS')
  assert.equal(enps.length, 1)
  assert.equal(enps[0].type, 'rating')
  assert.equal(enps[0].scaleMin, 0)
  assert.equal(enps[0].scaleMax, 10)
  // An option set would turn the scale into codes: `SurveyAnswerValidation.ValidateChoice`
  // only falls back to numeric bounds when there are none.
  assert.equal(enps[0].options, undefined)

  const open = doc.items.filter((i) => i.type === 'open_ended')
  assert.equal(open.length, 1)
  assert.equal(open[0].scaleMin, undefined, 'an open question must carry no scale')
  assert.equal(open[0].scaleLabelMinEs, undefined)
})

test('every likert item carries the agreement anchors that were ruled, in both languages', async () => {
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  for (const item of doc.items.filter((i) => i.type === 'likert')) {
    assert.equal(item.scaleMin, 1)
    assert.equal(item.scaleMax, 5)
    assert.equal(item.scaleLabelMinEs, ANCHORS.likert.minEs)
    assert.equal(item.scaleLabelMaxEs, ANCHORS.likert.maxEs)
    assert.equal(item.scaleLabelMinEn, ANCHORS.likert.minEn)
    assert.equal(item.scaleLabelMaxEn, ANCHORS.likert.maxEn)
  }
  assert.equal(ANCHORS.likert.minEs, 'Totalmente en desacuerdo')
  assert.equal(ANCHORS.likert.maxEs, 'Totalmente de acuerdo')
})

test('English is a verbatim copy of the Spanish, never a translation', async () => {
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  for (const item of doc.items) assert.equal(item.textEn, item.textEs)
  for (const category of doc.categories) assert.equal(category.nameEn, category.nameEs)
  // And it is never blank, which is what the endpoint refuses.
  for (const item of doc.items) assert.ok(item.textEs.trim().length > 0)
})

test('the text column is found by its header, so inserting a column cannot change what is imported', () => {
  const cells = sheet({ ...HEADER, ...ROW })
  const columns = locateColumns(cells, 'versión final')
  assert.equal(columns.text, 'Q')
  assert.equal(columns.headerRow, 4)
  assert.equal(columns.headerText, 'Versión Final para TIMS')

  // The same sheet with the wording column moved to Z is still read correctly.
  const moved = sheet({ A4: '#', B4: 'Tema', G4: 'Escala', H4: 'Tipo', Z4: 'Versión Final para TIMS', ...ROW, Q5: null, Z5: 'Mi jefatura escucha.' })
  assert.equal(locateColumns(moved, 'versión final').text, 'Z')
})

test('an ambiguous or absent text header stops the run instead of picking one', () => {
  const two = sheet({ ...HEADER, P4: 'Versión Final (borrador)', ...ROW })
  assert.throws(() => locateColumns(two, 'versión final'), /matches 2 columns/)

  // Procomer's sheet carries four candidate wording columns; "final" alone is ambiguous
  // between "Enunciado Final Recomendado" and "Versión Final para TIMS".
  const candidates = sheet({ ...HEADER, J4: 'Enunciado Final Recomendado', ...ROW })
  assert.throws(() => locateColumns(candidates, 'final'), /matches 2 columns/)
  assert.equal(locateColumns(candidates, 'versión final').text, 'Q')

  assert.throws(() => locateColumns(sheet({ ...HEADER, Q4: 'Otra cosa', ...ROW }), 'versión final'), /no column matching/)
  assert.throws(() => locateColumns(sheet({ A1: 'nada' }), 'versión final'), /no header row found/)
})

test('accents and case in a header do not matter; the four wording columns still differ', () => {
  assert.equal(fold('Versión Final  para TIMS'), 'version final para tims')
  assert.equal(fold('VERSION FINAL PARA TIMS'), 'version final para tims')
  assert.notEqual(fold('Enunciado Final Recomendado'), fold('Versión Final para TIMS'))
})

test('the scale bounds are read off the sheet, not assumed', () => {
  assert.deepEqual(parseScale('Likert 1-5'), { min: 1, max: 5 })
  assert.deepEqual(parseScale('eNPS 0-10'), { min: 0, max: 10 })
  assert.deepEqual(parseScale('Likert 1–7'), { min: 1, max: 7 })
  assert.equal(parseScale('Abierta'), null)
  assert.equal(parseScale('Likert 5-1'), null, 'an inverted scale is not a scale')
  assert.equal(parseScale(null), null)
})

test('a row this cannot place stops the run, and every problem is reported at once', () => {
  const columns = locateColumns(sheet({ ...HEADER, ...ROW }), 'versión final')

  const unknownType = sheet({ ...HEADER, A5: 1, B5: 'Tema', G5: 'Matriz 1-5', H5: 'Matriz', Q5: 'Texto.' })
  assert.throws(() => readStatements(unknownType, columns, 5), /Tipo "Matriz" is not one of/)

  const noBounds = sheet({ ...HEADER, A5: 1, B5: 'Tema', G5: 'Likert', H5: 'Likert', Q5: 'Texto.' })
  assert.throws(() => readStatements(noBounds, columns, 5), /carries no "min-max" bounds/)

  // A numbered row with no wording is an error, not a skip: 57 quietly becoming 56 is the
  // failure nobody notices until the client does.
  const noText = sheet({ ...HEADER, A5: 7, B5: 'Tema', G5: 'Likert 1-5', H5: 'Likert' })
  assert.throws(() => readStatements(noText, columns, 5), /item "7" has no text in column Q/)

  const noTema = sheet({ ...HEADER, A5: 1, G5: 'Likert 1-5', H5: 'Likert', Q5: 'Texto.' })
  assert.throws(() => readStatements(noTema, columns, 5), /no Tema/)

  const twoProblems = sheet({ ...HEADER, A5: 1, B5: 'Tema', G5: 'Likert', H5: 'Likert', Q5: 'Uno.', A6: 2, B6: 'Tema', G6: 'Likert', H6: 'Likert', Q6: 'Dos.' })
  assert.throws(() => readStatements(twoProblems, columns, 6), (error) => error.problems.length === 2)

  // A wholly empty row between sections is skipped, not an error.
  const gap = sheet({ ...HEADER, ...ROW, A7: 2, B7: 'I. Liderazgo', G7: 'Likert 1-5', H7: 'Likert', Q7: 'Otra.' })
  assert.equal(readStatements(gap, columns, 7).length, 2)
})

test('whitespace is tidied and nothing else; the client wording is otherwise untouched', async () => {
  assert.equal(tidy('  Hola   mundo. '), 'Hola mundo.')
  assert.equal(tidy(null), '')

  // Twelve cells in the workbook carry a trailing space. Trimming them changes no word, and
  // `/admin/question-library` trims on write anyway, so not trimming would only mean the
  // server and the file disagree about what was sent.
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  for (const item of doc.items) assert.equal(item.textEs, item.textEs.trim())
  for (const item of doc.items) assert.ok(!/ {2}/.test(item.textEs))

  // The three spelling slips the client sent are still there, unfixed: following the file
  // identically means not silently correcting the wording they approved.
  const texts = doc.items.map((i) => i.textEs)
  assert.ok(texts.some((t) => t.includes('la informacion necesaria')), 'item 7 was silently corrected')
  assert.ok(texts.some((t) => t.includes('de la organizacion.')), 'item 54 was silently corrected')
  assert.ok(texts.some((t) => t.includes('¿Hay algun comentario')), 'item 57 was silently corrected')
})

test('categories keep the client numbering and their first-appearance order', async () => {
  const doc = JSON.parse(await readFile(INSTRUMENT, 'utf8'))
  assert.deepEqual(doc.categories.map((c) => c.order), Array.from({ length: 13 }, (_, n) => n + 1))
  assert.equal(doc.categories[0].nameEs, 'Validación')
  assert.equal(doc.categories[1].nameEs, 'I. Liderazgo y Gestión')
  assert.equal(doc.categories.at(-1).nameEs, 'Especiales')
  assert.equal(new Set(doc.categories.map((c) => c.key)).size, 13, 'category keys must be unique')
  for (const c of doc.categories) assert.equal(c.parent, null, 'the sheet has one level of theme')

  // Every item lands in a declared category, and every category has at least one item.
  const used = new Set(doc.items.map((i) => i.category))
  assert.deepEqual([...used].sort(), doc.categories.map((c) => c.key).sort())
})

test('buildInstrument puts each statement in its own theme, in sheet order', () => {
  const statements = [
    { row: 5, number: '1', tema: 'A', dimension: 'd1', tipo: 'Likert', escala: 'Likert 1-5', type: 'likert', anchors: 'likert', scale: { min: 1, max: 5 }, text: 'Uno.' },
    { row: 6, number: '2', tema: 'B', dimension: null, tipo: 'Abierta', escala: 'Abierta', type: 'open_ended', anchors: null, scale: null, text: 'Dos.' },
    { row: 7, number: '3', tema: 'A', dimension: 'd2', tipo: 'Likert', escala: 'Likert 1-5', type: 'likert', anchors: 'likert', scale: { min: 1, max: 5 }, text: 'Tres.' },
  ]
  const doc = buildInstrument(statements, { instrument: 'x', source: {}, tag: 'tag' })
  assert.deepEqual(doc.categories.map((c) => c.nameEs), ['A', 'B'])
  assert.deepEqual(doc.items.map((i) => i.category), [doc.categories[0].key, doc.categories[1].key, doc.categories[0].key])
  assert.deepEqual(doc.items.map((i) => i.tags), [['tag', 'item-1'], ['tag', 'item-2'], ['tag', 'item-3']])
  assert.equal(doc.items[1].scaleMin, undefined)
})

test('the Tipo map covers only types the library accepts', () => {
  for (const { type } of Object.values(TYPE_BY_TIPO)) {
    assert.ok(['likert', 'rating', 'open_ended'].includes(type), `${type} is not a library-supported type`)
  }
  assert.equal(TYPE_BY_TIPO.validacion.type, 'likert', 'a validation item is asked exactly like the rest')
})

test('the workbook on disk is the file the client sent', async () => {
  const bytes = await readFile(WORKBOOK)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SOURCE_SHA256)
})
