/**
 * Turn a client's one-sheet statement list into the instrument JSON that
 * `import-question-library.mjs` loads (docs/runbooks/question-library-import.md).
 *
 *   node scripts/build-instrument-from-workbook.mjs --file <workbook.xlsx> --out <instrument.json>
 *
 * Written for PROCOMER's "ENCUESTA CLIMA PROCOMER 2026" sheet, whose shape is one row per
 * statement and one column per review round. It is not a general spreadsheet reader: it
 * refuses anything it cannot place, which is the whole point -- an instrument that has been
 * through two client review rounds must land verbatim or not at all.
 *
 * ## It finds its columns by HEADER TEXT, never by letter
 *
 * The final wording lives in column Q today. Column letters move the first time anyone
 * inserts a reviewer's column, and the failure mode of a hardcoded letter is silent: the
 * import succeeds carrying an earlier review round's wording. So the header row is located
 * by content (a cell "#" beside a cell "Tema") and the text column by a header matching
 * `--text-header`, which must match EXACTLY ONE column. PROCOMER's sheet carries four
 * candidate wording columns -- "Enunciado Estratégico", "Nueva Propuesta", "Enunciado Final
 * Recomendado" and "Versión Final para TIMS" -- and picking the wrong one is the one mistake
 * this file exists to make impossible.
 *
 * ## Type and scale come from the sheet, not from a table in here
 *
 * The "Tipo" and "Escala" columns decide both. `Likert 1-5` is parsed for its bounds rather
 * than assumed to be 1..5, so `eNPS 0-10` lands as 0..10 from the same code path. A row whose
 * Tipo is not one of the mapped ones stops the run with its own row number: guessing a type
 * is guessing how every answer to it will be stored.
 *
 * ## Both languages, and why English is a copy of the Spanish
 *
 * `/admin/question-library` refuses a blank `TextEn` (QuestionLibraryEndpoints.cs:109) -- a
 * half-translated tree renders blank for one audience. No approved English wording of these
 * statements exists: the Spanish is what the client's COE reviewed, twice, word by word. So
 * the Spanish is copied into both columns, exactly as `import-climate-workbook.mjs`'s `both()`
 * already does for TIMS's own instrument, and an approved translation can be added later
 * through the maintenance page. The SCALE ANCHORS are the exception: nobody supplied those in
 * any language, so they are authored here and get real English.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { readWorkbook, slug } from './import-climate-workbook.mjs'

const blank = (v) => typeof v !== 'string' || v.trim() === ''

/** Collapse runs of whitespace and trim. Changes no word; `/admin/question-library` trims anyway. */
export const tidy = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

/** Case- and accent-insensitive compare, for matching header cells a person typed. */
export const fold = (text) =>
  String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The anchor words under the ends of each scale.
 *
 * **Ruled by Federico on 2026-10-08**: agreement anchors, because every one of the 57
 * statements is worded as an agreement claim ("Tengo claridad sobre...", "Confío en que...")
 * and that is the scale the client's COE reviewed the wording against. The alternative on the
 * table was TIMS's own shipped frequency scale (Nunca...Siempre,
 * `scripts/fixtures/climate-workbook.template.xlsx`), which reads wrong on items like "Me veo
 * trabajando en PROCOMER en los próximos años".
 *
 * Keyed by the sheet's own Tipo, so a sheet that mixes scales gets the right pair per row.
 */
export const ANCHORS = {
  likert: {
    minEs: 'Totalmente en desacuerdo', minEn: 'Strongly disagree',
    maxEs: 'Totalmente de acuerdo', maxEn: 'Strongly agree',
  },
  enps: {
    minEs: 'Nada probable', minEn: 'Not at all likely',
    maxEs: 'Totalmente probable', maxEn: 'Extremely likely',
  },
}

/**
 * Sheet Tipo → the platform's question type.
 *
 * `eNPS` is a `rating` and not a `multiple_choice` of eleven options on purpose: only
 * `QuestionTypes.NumericScale` (likert, rating) gets a mean and a median out of
 * `SurveyAggregation.NumericStats`, and an eNPS whose answers cannot be averaged is a
 * question nobody can report on. `rating` with bounds 0..10 is what
 * `SurveyAnswerValidation.ValidateChoice`'s scale fallback accepts.
 *
 * `Validación` maps to `likert` as well -- it is a 1-5 agreement item like the rest; the word
 * marks what it is FOR (reading whether respondents trusted the process), not how it is asked.
 */
export const TYPE_BY_TIPO = {
  likert: { type: 'likert', anchors: 'likert' },
  'validacion': { type: 'likert', anchors: 'likert' },
  enps: { type: 'rating', anchors: 'enps' },
  abierta: { type: 'open_ended', anchors: null },
}

/** "Likert 1-5" → { min: 1, max: 5 }. "Abierta" → null. The sheet's own bounds, not assumed ones. */
export function parseScale(escala) {
  const match = String(escala ?? '').match(/(\d+)\s*[-–—a]\s*(\d+)/)
  if (!match) return null
  const min = Number(match[1])
  const max = Number(match[2])
  return Number.isInteger(min) && Number.isInteger(max) && min < max ? { min, max } : null
}

const HEADERS = {
  num: ['#', 'no', 'num', 'numero'],
  tema: ['tema'],
  dimension: ['dimension'],
  escala: ['escala'],
  tipo: ['tipo'],
}

/**
 * Locate the header row and the columns, by what they say.
 *
 * The header row is the first row carrying both a "#" cell and a "Tema" cell. Returns the
 * column letters so the caller can report what it read -- a run that does not state which
 * column it took is a run nobody can check.
 */
export function locateColumns(cells, textHeader) {
  const rows = new Map()
  for (const [ref, cell] of Object.entries(cells)) {
    const match = ref.match(/^([A-Z]+)(\d+)$/)
    if (!match || blank(cell.value) && typeof cell.value !== 'string') continue
    if (cell.value === null) continue
    const row = Number(match[2])
    if (!rows.has(row)) rows.set(row, new Map())
    rows.get(row).set(match[1], cell.value)
  }

  const wanted = fold(textHeader)
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const byCol = rows.get(row)
    const found = {}
    for (const [col, value] of byCol) {
      const label = fold(value)
      for (const [field, aliases] of Object.entries(HEADERS)) {
        if (aliases.includes(label) && found[field] === undefined) found[field] = col
      }
    }
    if (found.num === undefined || found.tema === undefined) continue

    const textCols = [...byCol].filter(([, value]) => fold(value).includes(wanted)).map(([col]) => col)
    if (textCols.length === 0) {
      throw new Error(`header row ${row} has no column matching --text-header "${textHeader}"; it has: ${[...byCol.values()].map((v) => `"${tidy(v)}"`).join(', ')}`)
    }
    if (textCols.length > 1) {
      throw new Error(`--text-header "${textHeader}" matches ${textCols.length} columns on row ${row} (${textCols.map((c) => `${c}="${tidy(byCol.get(c))}"`).join(', ')}); make it specific enough to match exactly one`)
    }
    return { headerRow: row, text: textCols[0], ...found, headerText: tidy(byCol.get(textCols[0])) }
  }
  throw new Error('no header row found: expected a row carrying a "#" cell and a "Tema" cell')
}

/**
 * Every row of the sheet that carries a statement, with every problem reported at once.
 *
 * A row counts as a statement when it has BOTH a number and a final text. A row with one and
 * not the other is an error rather than a skip: an instrument that quietly drops a row is how
 * 57 items become 56 and nobody notices until the client does.
 */
export function readStatements(cells, columns, lastRow) {
  const at = (col, row) => (col === undefined ? null : cells[`${col}${row}`]?.value ?? null)
  const statements = []
  const errors = []
  for (let row = columns.headerRow + 1; row <= lastRow; row += 1) {
    const num = at(columns.num, row)
    const text = at(columns.text, row)
    const hasNum = num !== null && !blank(String(num))
    const hasText = !blank(text)
    if (!hasNum && !hasText) continue
    if (!hasText) { errors.push(`row ${row}: item "${tidy(String(num))}" has no text in column ${columns.text}`); continue }
    if (!hasNum) { errors.push(`row ${row}: a statement with no number in column ${columns.num}`); continue }

    const tipo = tidy(at(columns.tipo, row))
    const escala = tidy(at(columns.escala, row))
    const mapping = TYPE_BY_TIPO[fold(tipo)]
    if (!mapping) {
      errors.push(`row ${row} (item ${tidy(String(num))}): Tipo "${tipo}" is not one of ${Object.keys(TYPE_BY_TIPO).join(', ')}`)
      continue
    }
    const scale = mapping.type === 'open_ended' ? null : parseScale(escala)
    if (mapping.type !== 'open_ended' && scale === null) {
      errors.push(`row ${row} (item ${tidy(String(num))}): Escala "${escala}" carries no "min-max" bounds for a ${mapping.type} question`)
      continue
    }
    const tema = tidy(at(columns.tema, row))
    if (blank(tema)) { errors.push(`row ${row} (item ${tidy(String(num))}): no Tema, so it belongs to no category`); continue }

    statements.push({
      row,
      number: tidy(String(num)),
      tema,
      dimension: tidy(at(columns.dimension, row)) || null,
      tipo,
      escala,
      type: mapping.type,
      anchors: mapping.anchors,
      scale,
      text: tidy(text),
    })
  }
  if (errors.length) {
    const error = new Error(`${errors.length} problem(s) in the sheet, nothing written:\n  - ${errors.join('\n  - ')}`)
    error.problems = errors
    throw error
  }
  return statements
}

/** The instrument document, categories in first-appearance order of their Tema. */
export function buildInstrument(statements, { instrument, source, tag }) {
  const categories = []
  const keyByTema = new Map()
  for (const s of statements) {
    if (keyByTema.has(s.tema)) continue
    const key = slug(s.tema) || `tema_${categories.length + 1}`
    keyByTema.set(s.tema, key)
    categories.push({
      key,
      // The client's own wording, numeral and all: "I. Liderazgo y Gestión" is how they
      // ordered their own instrument, and renumbering it here would be the first place the
      // product and their document disagree.
      nameEn: s.tema,
      nameEs: s.tema,
      parent: null,
      order: categories.length + 1,
    })
  }

  const items = statements.map((s) => {
    const anchors = s.anchors ? ANCHORS[s.anchors] : null
    return {
      category: keyByTema.get(s.tema),
      type: s.type,
      textEn: s.text,
      textEs: s.text,
      ...(s.scale ? { scaleMin: s.scale.min, scaleMax: s.scale.max } : {}),
      ...(anchors
        ? {
            scaleLabelMinEn: anchors.minEn, scaleLabelMinEs: anchors.minEs,
            scaleLabelMaxEn: anchors.maxEn, scaleLabelMaxEs: anchors.maxEs,
          }
        : {}),
      dimension: s.dimension,
      tags: [tag, `item-${s.number}`],
    }
  })

  return { instrument, source, categories, items }
}

/** One line per thing the file says, so a reviewer can read the run instead of the JSON. */
export function summarise(statements, doc) {
  const lines = [
    `${statements.length} statements → ${doc.categories.length} categories`,
  ]
  const byType = {}
  for (const s of statements) {
    const key = `${s.type}${s.scale ? ` ${s.scale.min}-${s.scale.max}` : ''}`
    byType[key] = (byType[key] ?? 0) + 1
  }
  for (const [key, n] of Object.entries(byType)) lines.push(`  ${String(n).padStart(3)}  ${key}`)
  for (const c of doc.categories) {
    const n = doc.items.filter((i) => i.category === c.key).length
    lines.push(`  ${String(n).padStart(3)}  ${c.nameEs}`)
  }
  return lines
}

export async function run(values) {
  // Its own logger, so the test that rebuilds the instrument to compare it does not print the
  // whole summary into CI's output.
  const log = values.quiet ? () => {} : (line) => process.stdout.write(`${line}\n`)
  if (blank(values.file)) throw new Error('--file <workbook.xlsx> is required')
  const bytes = await readFile(values.file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const sheets = readWorkbook(values.file)
  const names = Object.keys(sheets)
  const name = values.sheet ?? (names.length === 1 ? names[0] : null)
  if (!name) throw new Error(`the workbook has ${names.length} sheets (${names.join(', ')}); choose one with --sheet`)
  const cells = sheets[name]
  if (!cells) throw new Error(`no sheet named "${name}" (have: ${names.join(', ')})`)
  const lastRow = Math.max(...Object.keys(cells).map((ref) => Number(ref.match(/\d+$/)[0])))

  const columns = locateColumns(cells, values['text-header'])
  log(`${basename(values.file)} · sheet "${name}" · header row ${columns.headerRow}`)
  log(`text column: ${columns.text} "${columns.headerText}"  (matched --text-header "${values['text-header']}")`)
  log(`sha256: ${sha256}`)

  const statements = readStatements(cells, columns, lastRow)
  const doc = buildInstrument(statements, {
    instrument: values.instrument ?? `${name} — ${basename(values.file)}`,
    source: {
      file: basename(values.file),
      sheet: name,
      textColumn: `${columns.text} (${columns.headerText})`,
      sha256,
      statements: statements.length,
    },
    tag: values.tag,
  })
  for (const line of summarise(statements, doc)) log(line)

  if (values.out) {
    await writeFile(values.out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    log(`wrote ${values.out}`)
  } else {
    log('no --out: nothing written')
  }
  return { doc, statements, sha256, columns }
}

export function parseCli(argv) {
  return parseArgs({
    args: argv,
    options: {
      file: { type: 'string' },
      out: { type: 'string' },
      sheet: { type: 'string' },
      'text-header': { type: 'string', default: 'versión final' },
      instrument: { type: 'string' },
      tag: { type: 'string', default: 'procomer-2026' },
      quiet: { type: 'boolean', default: false },
    },
  }).values
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await run(parseCli(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
