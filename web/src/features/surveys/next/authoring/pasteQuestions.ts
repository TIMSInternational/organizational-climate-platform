import { emptyQuestion, type ContentLanguage, type SurveyQuestionValues } from '../../wizardValues'

/**
 * A client's own questionnaire, pasted from Excel into the survey wizard («Pegar desde Excel»,
 * 2026-11-08). Until this, a client file reached a survey only through a developer's script
 * (`scripts/build-instrument-from-workbook.mjs` for PROCOMER's 57 statements) or by retyping it.
 *
 * Paste rather than upload, deliberately: every client's sheet has a different shape (PROCOMER's
 * carried FOUR candidate wording columns from its review rounds), and the one mistake the script
 * existed to prevent was importing the wrong column. Here the operator picks the column and SEES
 * every row before anything is added. No spreadsheet library is needed: Excel puts the copied
 * cells on the clipboard as tab-separated text.
 *
 * The rule the script followed stands: the questionnaire lands verbatim or not at all. A row whose
 * type cannot be read is a problem to fix in the sheet, not a type to guess -- guessing a type is
 * guessing how every answer to it will be stored.
 */

/** One pasted row: its 1-based position in what was pasted, and its cells. */
export interface PastedRow {
  line: number
  cells: string[]
}

/**
 * Excel's clipboard text as rows of cells. Tab separates cells and a line break separates rows;
 * a cell holding a tab, a line break or a quote is wrapped in quotes, with inner quotes doubled.
 * Blank rows are dropped. Whitespace inside a cell is collapsed, which changes no word.
 */
export function parsePastedTable(text: string): PastedRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let atCellStart = true
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && atCellStart) {
      quoted = true
      atCellStart = false
      continue
    }
    if (ch === '\t') {
      row.push(cell)
      cell = ''
      atCellStart = true
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      atCellStart = true
      continue
    }
    cell += ch
    atCellStart = false
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const tidy = (value: string) => value.replace(/\s+/g, ' ').trim()
  return rows
    .map((cells, index) => ({ line: index + 1, cells: cells.map(tidy) }))
    .filter((r) => r.cells.some((c) => c !== ''))
}

/** Case- and accent-insensitive, for matching what a person typed in a header or a type cell. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The platform type a pasted type cell names, with its scale bounds; null when it names none. */
export interface PastedType {
  type: 'likert' | 'rating' | 'open_ended' | 'yes_no'
  scaleMin: number | null
  scaleMax: number | null
}

/**
 * Reads a type cell: "Likert 1-5", "Escala 1 a 7", "eNPS 0-10", "0-10", "Abierta", "Sí/No".
 * The bounds are READ, never assumed: "Likert 1-5" is 1..5 and "eNPS 0-10" is 0..10 from the same
 * path. A 0..10 scale is a `rating` (a mean and a median, as the script decided for eNPS); any
 * other range is a `likert`. Null for anything else -- the caller reports it.
 */
export function readType(cell: string): PastedType | null {
  const folded = fold(cell)
  if (folded === '') return null
  if (/^(abierta|pregunta abierta|texto|texto libre|comentario|open|open ended|open_ended|text)$/.test(folded)) {
    return { type: 'open_ended', scaleMin: null, scaleMax: null }
  }
  if (/^(si ?\/ ?no|si-no|si o no|yes ?\/ ?no|yes_no|yes-no|yes or no)$/.test(folded)) {
    return { type: 'yes_no', scaleMin: null, scaleMax: null }
  }
  const range = folded.match(/(\d{1,2})\s*(?:-|–|a|to|al)\s*(\d{1,2})/)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (!(max > min) || max - min > 10) return null
    return min === 0 && max === 10
      ? { type: 'rating', scaleMin: 0, scaleMax: 10 }
      : { type: 'likert', scaleMin: min, scaleMax: max }
  }
  if (/^(likert|escala|escala de acuerdo|acuerdo)$/.test(folded)) {
    return { type: 'likert', scaleMin: 1, scaleMax: 5 }
  }
  return null
}

/** Which header names each column usually carries, folded. Only a SUGGESTION: the operator picks. */
const HEADER_HINTS = {
  text: ['pregunta', 'enunciado', 'texto', 'item', 'reactivo', 'afirmacion', 'question', 'statement'],
  dimension: ['dimension', 'tema', 'categoria', 'factor', 'eje', 'dimension', 'category', 'topic'],
  type: ['tipo', 'escala', 'tipo de respuesta', 'type', 'scale'],
} as const

/**
 * Whether the first row reads as headers, and which columns the headers suggest. A row is a
 * header when ANY of its cells names a known column (question, dimension or type) and none reads
 * as a question type. The question column is only suggested, never required: PROCOMER's sheet
 * titled it "Versión Final para TIMS", beside three other wordings -- choosing among them is the
 * operator's, which is the point of the dialog.
 */
export function suggestColumns(rows: PastedRow[]): { hasHeader: boolean; text: number | null; dimension: number | null; type: number | null } {
  const first = rows[0]
  if (!first) return { hasHeader: false, text: null, dimension: null, type: null }
  const folded = first.cells.map(fold)
  const find = (hints: readonly string[]) => {
    const index = folded.findIndex((cell) => hints.some((hint) => cell === hint || cell.startsWith(`${hint} `) || cell.endsWith(` ${hint}`)))
    return index === -1 ? null : index
  }
  const text = find(HEADER_HINTS.text)
  const dimension = find(HEADER_HINTS.dimension)
  const type = find(HEADER_HINTS.type)
  const hasHeader =
    (text !== null || dimension !== null || type !== null) &&
    first.cells.every((cell) => readType(cell) === null || fold(cell) === 'escala')
  if (!hasHeader) return { hasHeader: false, text: null, dimension: null, type: null }
  return { hasHeader, text, dimension, type }
}

/** What the operator chose in the dialog. Column indexes are 0-based; null means "none". */
export interface PasteMapping {
  hasHeader: boolean
  /** The question text in Spanish. Required when the survey is in Spanish or both. */
  textEs: number | null
  /** The question text in English. Required when the survey is in English or both. */
  textEn: number | null
  dimension: number | null
  /** The type column; null means every row takes `defaultType`. */
  type: number | null
  defaultType: PastedType
  /** The words at the ends of every likert/rating row, per language; blank leaves them blank. */
  anchors: { minEs: string; maxEs: string; minEn: string; maxEn: string }
}

/** Why one pasted row cannot be added. */
export type PasteProblem =
  | { line: number; kind: 'no_text'; language: 'es' | 'en' }
  | { line: number; kind: 'unknown_type'; value: string }

export interface PasteResult {
  questions: SurveyQuestionValues[]
  problems: PasteProblem[]
  /** The rows read as questions (the header excluded), for the preview. */
  rows: PastedRow[]
}

/**
 * The pasted rows as wizard questions, or the problems that stop them. All or nothing: the
 * caller adds `questions` only when `problems` is empty.
 */
export function buildPastedQuestions(
  rows: PastedRow[],
  mapping: PasteMapping,
  language: ContentLanguage,
  takeKeys: (count: number) => string[],
): PasteResult {
  const body = mapping.hasHeader ? rows.slice(1) : rows
  const needsEs = language === 'es' || language === 'both'
  const needsEn = language === 'en' || language === 'both'
  const problems: PasteProblem[] = []
  const keys = takeKeys(body.length)
  const cellAt = (row: PastedRow, column: number | null) => (column === null ? '' : (row.cells[column] ?? ''))

  const questions = body.map((row, index) => {
    const textEs = needsEs ? cellAt(row, mapping.textEs) : ''
    const textEn = needsEn ? cellAt(row, mapping.textEn) : ''
    if (needsEs && textEs === '') problems.push({ line: row.line, kind: 'no_text', language: 'es' })
    if (needsEn && textEn === '') problems.push({ line: row.line, kind: 'no_text', language: 'en' })
    const typeCell = cellAt(row, mapping.type)
    let type = mapping.defaultType
    if (mapping.type !== null) {
      const read = readType(typeCell)
      if (read === null) problems.push({ line: row.line, kind: 'unknown_type', value: typeCell })
      else type = read
    }
    const scale = type.type === 'likert' || type.type === 'rating'
    return {
      ...emptyQuestion(keys[index]),
      textEs,
      textEn,
      type: type.type,
      category: cellAt(row, mapping.dimension),
      scaleMin: type.scaleMin,
      scaleMax: type.scaleMax,
      scaleLabelMinEs: scale && needsEs ? mapping.anchors.minEs.trim() : '',
      scaleLabelMaxEs: scale && needsEs ? mapping.anchors.maxEs.trim() : '',
      scaleLabelMinEn: scale && needsEn ? mapping.anchors.minEn.trim() : '',
      scaleLabelMaxEn: scale && needsEn ? mapping.anchors.maxEn.trim() : '',
    }
  })

  return { questions, problems, rows: body }
}
