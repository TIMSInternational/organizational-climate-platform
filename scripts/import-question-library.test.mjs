/**
 * Pure-function tests for the importer: the validator, the parents-first ordering, the natural
 * key matcher and the request shapes. No network. `node --test scripts/`.
 *
 * Each block ends with the mutation that proves the assertion has teeth: the "wrong" input
 * must actually be rejected, not merely the right one accepted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateInstrument, orderCategories, planCategories, planItems, toCategoryRequest, toItemRequest, parseScope, inScope, SUPPORTED_TYPES,
} from './import-question-library.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sample = JSON.parse(await readFile(join(here, 'fixtures', 'question-library.sample.json'), 'utf8'))
const clone = () => JSON.parse(JSON.stringify(sample))
const ACME = '22cc8ed9-2e02-401a-8d52-52068ff5e6c0'

test('the sample instrument validates clean and covers every supported type', () => {
  assert.deepEqual(validateInstrument(sample), [])
  const types = new Set(sample.items.map((i) => i.type))
  for (const t of SUPPORTED_TYPES) assert.ok(types.has(t), `sample lacks a ${t} item`)
  assert.ok(sample.categories.some((c) => c.parent), 'sample has no nested category, so parents-first is untested')
})

test('every problem is reported at once, not just the first', () => {
  const doc = clone()
  doc.categories[1].nameEs = ''                       // missing Spanish
  doc.categories.push({ key: 'leadership', nameEn: 'Dup', nameEs: 'Dup' })   // duplicate key
  doc.categories.push({ key: 'orphan', nameEn: 'O', nameEs: 'O', parent: 'nope' }) // unknown parent
  doc.items[0].type = 'ranking'                       // refused type
  doc.items[1].category = 'missing'                   // unknown category
  doc.items[5].options = [{ value: 'x', labelEn: 'a', labelEs: 'a' }, { value: 'x', labelEn: 'b', labelEs: 'b' }] // dup option values
  doc.items.push({ ...doc.items[2] })                 // duplicate natural key
  doc.items.push({ category: 'open', type: 'multiple_choice', textEn: 'No options', textEs: 'Sin opciones' })
  const errors = validateInstrument(doc)
  const expect = ['nameEn and nameEs', 'duplicate key "leadership"', 'parent "nope"', 'type "ranking"', 'category "missing"', 'option values must be unique', 'duplicate of items[2]', 'requires at least one option']
  for (const e of expect) assert.ok(errors.some((m) => m.includes(e)), `missing error containing "${e}" in:\n${errors.join('\n')}`)
  assert.equal(errors.length, expect.length, errors.join('\n'))
})

test('a parent cycle is refused', () => {
  const doc = clone()
  doc.categories[0].parent = 'leadership.feedback'   // leadership -> feedback -> leadership
  const errors = validateInstrument(doc)
  assert.ok(errors.some((m) => m.includes('cycle')), errors.join('\n'))
})

test('categories come out parents-first whatever order the file declares them in', () => {
  const doc = clone()
  const child = doc.categories.splice(1, 1)[0]
  doc.categories.unshift(child)                       // child declared before its parent
  assert.deepEqual(validateInstrument(doc), [])
  const ordered = orderCategories(doc.categories).map((c) => c.key)
  assert.ok(ordered.indexOf('leadership') < ordered.indexOf('leadership.feedback'))
  assert.equal(ordered.length, doc.categories.length)
})

test('scope is explicit: neither, both, or a non-GUID are refused', () => {
  assert.throws(() => parseScope({}), /choose the ownership explicitly/)
  assert.throws(() => parseScope({ global: true, 'company-id': ACME }), /mutually exclusive/)
  assert.throws(() => parseScope({ 'company-id': 'acme' }), /must be a GUID/)
  assert.deepEqual(parseScope({ global: true }), { global: true, companyId: null })
  assert.deepEqual(parseScope({ 'company-id': ACME.toUpperCase() }), { global: false, companyId: ACME })
})

test('inScope separates global rows from tenant rows, case-insensitively', () => {
  assert.equal(inScope({ companyId: null }, { global: true }), true)
  assert.equal(inScope({ companyId: ACME }, { global: true }), false)
  assert.equal(inScope({ companyId: ACME.toUpperCase() }, { global: false, companyId: ACME }), true)
  assert.equal(inScope({ companyId: null }, { global: false, companyId: ACME }), false)
})

test('a second run matches every category and item and creates nothing', () => {
  const scope = { global: false, companyId: ACME }
  // First run: nothing on the server → everything is created.
  const first = planCategories(sample.categories, [], scope)
  assert.equal(first.create.length, sample.categories.length)
  assert.equal(first.skip.length, 0)
  // Simulate the server after the first run: ids assigned, parents resolved.
  const ids = new Map()
  const serverCats = orderCategories(sample.categories).map((c, i) => {
    const id = `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`
    ids.set(c.key, id)
    return { id, companyId: ACME, parentCategoryId: c.parent ? ids.get(c.parent) : null, nameEn: c.nameEn, nameEs: c.nameEs }
  })
  const serverItems = sample.items.map((it, i) => ({ id: `11111111-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, companyId: ACME, questionCategoryId: ids.get(it.category), textEn: it.textEn, type: it.type }))
  const second = planCategories(sample.categories, serverCats, scope)
  assert.equal(second.create.length, 0, JSON.stringify(second.create))
  assert.equal(second.skip.length, sample.categories.length)
  const items = planItems(sample.items, serverItems, second.idByKey, scope)
  assert.equal(items.create.length, 0, JSON.stringify(items.create))
  assert.equal(items.skip.length, sample.items.length)
  // Mutation: the same rows under ANOTHER tenant must not match — they are not ours.
  const foreign = serverCats.map((c) => ({ ...c, companyId: '99999999-9999-9999-9999-999999999999' }))
  assert.equal(planCategories(sample.categories, foreign, scope).create.length, sample.categories.length)
})

test('a run that died half way resumes: landed rows are matched, the rest created, in order', () => {
  const scope = { global: true, companyId: null }
  const ordered = orderCategories(sample.categories)
  const landed = ordered.slice(0, 3)                  // died after three categories
  const ids = new Map()
  const serverCats = landed.map((c, i) => { const id = `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`; ids.set(c.key, id); return { id, companyId: null, parentCategoryId: c.parent ? ids.get(c.parent) : null, nameEn: c.nameEn } })
  const plan = planCategories(sample.categories, serverCats, scope)
  assert.equal(plan.skip.length, 3)
  assert.equal(plan.create.length, sample.categories.length - 3)
  assert.deepEqual(plan.create.map((c) => c.key), ordered.slice(3).map((c) => c.key))
  const items = planItems(sample.items, [], plan.idByKey, scope)
  assert.equal(items.create.length, sample.items.length)
})

test('a renamed nameEn is a NEW category, not a match — the natural key is the English name under the same parent', () => {
  const scope = { global: true, companyId: null }
  const server = [{ id: '00000000-0000-0000-0000-000000000001', companyId: null, parentCategoryId: null, nameEn: 'Leadership (old)' }]
  const plan = planCategories(sample.categories, server, scope)
  assert.ok(plan.create.some((c) => c.key === 'leadership'))
})

test('request shapes carry the scope and every field the API accepts', () => {
  const scope = { global: false, companyId: ACME }
  const cat = toCategoryRequest(sample.categories[1], 'p-id', scope)
  assert.equal(cat.parentCategoryId, 'p-id')
  assert.equal(cat.companyId, ACME)
  assert.deepEqual(Object.keys(cat).sort(), ['color', 'companyId', 'descriptionEn', 'descriptionEs', 'icon', 'nameEn', 'nameEs', 'order', 'parentCategoryId'])
  const mc = toItemRequest(sample.items.find((i) => i.type === 'multiple_choice'), 'c-id', { global: true, companyId: null })
  assert.equal(mc.companyId, null)
  assert.equal(mc.questionCategoryId, 'c-id')
  assert.equal(mc.options.length, 4)
  assert.deepEqual(Object.keys(mc).sort(), ['companyId', 'dimension', 'options', 'questionCategoryId', 'scaleLabelMaxEn', 'scaleLabelMaxEs', 'scaleLabelMinEn', 'scaleLabelMinEs', 'scaleMax', 'scaleMin', 'tags', 'textEn', 'textEs', 'type'])
  const likert = toItemRequest(sample.items[0], 'c-id', scope)
  assert.equal(likert.options, null)
})
