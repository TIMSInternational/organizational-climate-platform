import { describe, expect, it } from 'vitest'
import { buildPastedQuestions, parsePastedTable, readType, suggestColumns, type PasteMapping } from './pasteQuestions'

const keys = (count: number) => Array.from({ length: count }, (_, i) => `k${i}`)

const mapping = (over: Partial<PasteMapping> = {}): PasteMapping => ({
  hasHeader: true,
  textEs: 1,
  textEn: null,
  dimension: 0,
  type: 2,
  defaultType: { type: 'likert', scaleMin: 1, scaleMax: 5 },
  anchors: { minEs: 'Totalmente en desacuerdo', maxEs: 'Totalmente de acuerdo', minEn: '', maxEn: '' },
  ...over,
})

describe('parsePastedTable', () => {
  it('reads Excel clipboard text: tabs between cells, CRLF between rows, blank rows dropped', () => {
    const rows = parsePastedTable('Tema\tPregunta\r\nLiderazgo\tMi jefatura me escucha\r\n\r\n')

    expect(rows).toEqual([
      { line: 1, cells: ['Tema', 'Pregunta'] },
      { line: 2, cells: ['Liderazgo', 'Mi jefatura me escucha'] },
    ])
  })

  /** A cell with a line break or a quote arrives quoted, inner quotes doubled. */
  it('keeps a quoted cell whole, line break and quotes included, and changes no word', () => {
    const rows = parsePastedTable('Liderazgo\t"Mi jefatura dice ""gracias""\ncuando corresponde"\tLikert 1-5')

    expect(rows[0].cells).toEqual(['Liderazgo', 'Mi jefatura dice "gracias" cuando corresponde', 'Likert 1-5'])
  })
})

describe('readType', () => {
  it.each([
    ['Likert 1-5', { type: 'likert', scaleMin: 1, scaleMax: 5 }],
    ['Escala 1 a 7', { type: 'likert', scaleMin: 1, scaleMax: 7 }],
    ['eNPS 0-10', { type: 'rating', scaleMin: 0, scaleMax: 10 }],
    ['0–10', { type: 'rating', scaleMin: 0, scaleMax: 10 }],
    ['Abierta', { type: 'open_ended', scaleMin: null, scaleMax: null }],
    ['Sí/No', { type: 'yes_no', scaleMin: null, scaleMax: null }],
  ])('reads %s', (cell, expected) => {
    expect(readType(cell)).toEqual(expected)
  })

  /** Guessing a type is guessing how every answer to it will be stored. */
  it.each(['Ranking', 'Validación', '5-1', '1-50', ''])('refuses %s rather than guess', (cell) => {
    expect(readType(cell)).toBeNull()
  })
})

describe('suggestColumns', () => {
  it('suggests the text, dimension and type columns from a header row', () => {
    const rows = parsePastedTable('#\tTema\tEnunciado final\tTipo\n1\tLiderazgo\tMe escuchan\tLikert 1-5')

    expect(suggestColumns(rows)).toEqual({ hasHeader: true, text: 2, dimension: 1, type: 3 })
  })

  /** PROCOMER's header: no title says "pregunta", and the question column is the operator's call. */
  it('recognises a header row by any known title, and suggests no question column it cannot name', () => {
    const rows = parsePastedTable('#\tTema\tPropuesta\tVersión Final para TIMS\tTipo\n1\tLiderazgo\tA\tB\tLikert 1-5')

    expect(suggestColumns(rows)).toEqual({ hasHeader: true, text: null, dimension: 1, type: 4 })
  })

  it('reads a sheet with no header row as all questions', () => {
    const rows = parsePastedTable('Liderazgo\tMe escuchan\tLikert 1-5')

    expect(suggestColumns(rows).hasHeader).toBe(false)
  })
})

describe('buildPastedQuestions', () => {
  const sheet = parsePastedTable(
    'Tema\tPregunta\tTipo\nLiderazgo\tMi jefatura me escucha\tLikert 1-5\nGeneral\t¿Recomendaría trabajar aquí?\teNPS 0-10\nGeneral\t¿Algo más?\tAbierta',
  )

  it('turns each row into a question, verbatim, with its dimension, type, bounds and anchors', () => {
    const result = buildPastedQuestions(sheet, mapping(), 'es', keys)

    expect(result.problems).toEqual([])
    expect(result.questions.map((q) => [q.textEs, q.category, q.type, q.scaleMin, q.scaleMax])).toEqual([
      ['Mi jefatura me escucha', 'Liderazgo', 'likert', 1, 5],
      ['¿Recomendaría trabajar aquí?', 'General', 'rating', 0, 10],
      ['¿Algo más?', 'General', 'open_ended', null, null],
    ])
    expect(result.questions[0].scaleLabelMinEs).toBe('Totalmente en desacuerdo')
    // An open question takes no scale words.
    expect(result.questions[2].scaleLabelMinEs).toBe('')
    expect(result.questions.every((q) => q.textEn === '' && q.required)).toBe(true)
  })

  it('names every row it cannot read, by its line, so nothing is added half-way', () => {
    const broken = parsePastedTable('Tema\tPregunta\tTipo\nLiderazgo\t\tLikert 1-5\nGeneral\tOrdene\tRanking')

    const result = buildPastedQuestions(broken, mapping(), 'es', keys)

    expect(result.problems).toEqual([
      { line: 2, kind: 'no_text', language: 'es' },
      { line: 3, kind: 'unknown_type', value: 'Ranking' },
    ])
  })

  it('needs the English column too on a bilingual survey', () => {
    const result = buildPastedQuestions(sheet, mapping({ textEn: null }), 'both', keys)

    expect(result.problems.filter((p) => p.kind === 'no_text' && p.language === 'en')).toHaveLength(3)
  })

  it('gives every row the chosen type when the sheet has no type column', () => {
    const result = buildPastedQuestions(sheet, mapping({ type: null, defaultType: { type: 'yes_no', scaleMin: null, scaleMax: null } }), 'es', keys)

    expect(result.questions.map((q) => q.type)).toEqual(['yes_no', 'yes_no', 'yes_no'])
  })
})
