import type { BulkImportResponse } from '../../api/bulkImport'
import type {
  IntakeColumnMapping,
  IntakeColumnTarget,
  IntakeMapping,
  IntakeRow,
  IntakeSource,
} from '../../api/intake'

/**
 * The intake wizard's pure half: no React, no translation, no classes — only the decisions the
 * screens make about the data, so each can be tested without rendering anything.
 *
 * Class names are deliberately NOT here: `styles/utilityExistence.test.ts` reads `className`
 * out of `.tsx` files only, so a helper that returned a class string would be invisible to it.
 */

/** The column targets the editor offers, in the order it offers them (demographics go before ignore). */
export const COLUMN_TARGETS: readonly Exclude<IntakeColumnTarget, 'demographic' | 'ignore'>[] = [
  'name',
  'first_name',
  'last_name',
  'email',
  'role',
  'department',
]

export const ROLE_TARGETS = ['employee', 'leader', 'supervisor'] as const

/**
 * The known insight codes, each with a sentence in both catalogues (`users.intake.insight.*`).
 * A code outside this set is one the screen predates and is not printed (it has no sentence to
 * say it in); the review step's server verdict still stops any row that is actually invalid.
 */
export const INSIGHT_CODES: ReadonlySet<string> = new Set([
  'email_typo',
  'invalid_email',
  'missing_email',
  'missing_name',
  'duplicate_in_file',
  'outside_domain',
  'no_department',
  'new_department',
])

/** Error codes a refused intake request can carry that the screen says in the reader's language. */
export const REQUEST_ERROR_CODES: ReadonlySet<string> = new Set([
  'not_a_spreadsheet',
  'empty_file',
  'no_file',
  'bad_mapping',
  'not_a_workbook',
])

export const FAILURE_CODES: ReadonlySet<string> = new Set(['ai_unavailable', 'ai_failed', 'ai_refused'])

/**
 * The value a column's "Se usa como" select holds. A demographic target carries its field, so
 * "Sexo" and "Sede" are two different choices rather than one "demographic".
 */
export function columnChoice(column: Pick<IntakeColumnMapping, 'target' | 'demographicField'>): string {
  return column.target === 'demographic' ? `demographic:${column.demographicField ?? ''}` : column.target
}

export function parseColumnChoice(value: string): { target: IntakeColumnTarget; demographicField: string | null } {
  if (value.startsWith('demographic:')) {
    return { target: 'demographic', demographicField: value.slice('demographic:'.length) || null }
  }
  return { target: value as IntakeColumnTarget, demographicField: null }
}

/** The department select's value: an existing department, one to create, or none. */
export function departmentChoice(value: { department: string | null; createNew: boolean }): string {
  if (!value.department) return 'none'
  return value.createNew ? `new:${value.department}` : `existing:${value.department}`
}

export function parseDepartmentChoice(value: string): { department: string | null; createNew: boolean } {
  if (value.startsWith('new:')) return { department: value.slice(4), createNew: true }
  if (value.startsWith('existing:')) return { department: value.slice(9), createNew: false }
  return { department: null, createNew: false }
}

/** 1 → "A", 27 → "AA": the column as the admin sees it in Excel. The server's columns are 1-based. */
export function columnLetter(column: number): string {
  let n = column
  let letters = ''
  while (n > 0) {
    const rest = (n - 1) % 26
    letters = String.fromCharCode(65 + rest) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/**
 * "claude-opus-5-5" → "Claude Opus 5.5". Derived rather than looked up, so the next model the
 * server is pointed at is named properly without a release of this screen; a trailing date stamp
 * (`-20260901`) is dropped. Anything that is not a Claude id is shown as the server sent it.
 */
export function formatModelName(id: string): string {
  const parts = id.split('-').filter((part) => part.length > 0)
  if (parts[0]?.toLowerCase() !== 'claude') return id
  const words: string[] = []
  const numbers: string[] = []
  for (const part of parts) {
    if (/^\d{8}$/.test(part)) continue
    if (/^\d+$/.test(part)) numbers.push(part)
    else words.push(part.charAt(0).toUpperCase() + part.slice(1))
  }
  return [words.join(' '), numbers.join('.')].filter((piece) => piece.length > 0).join(' ')
}

/** The domain after the last `@`, lower-cased, or null for a value that has none. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@')
  return at < 0 ? null : email.slice(at + 1).toLowerCase()
}

/**
 * Rewrites each row's email domain through `fixes` (bad domain → good domain). Held as a map
 * rather than applied once, because "Aplicar cambios" re-reads the file on the server and would
 * otherwise bring every typo back.
 */
export function applyDomainFixes(rows: IntakeRow[], fixes: Readonly<Record<string, string>>): IntakeRow[] {
  if (Object.keys(fixes).length === 0) return rows
  return rows.map((row) => {
    const domain = domainOf(row.email)
    const fixed = domain === null ? undefined : fixes[domain]
    return fixed === undefined ? row : { ...row, email: `${row.email.slice(0, row.email.lastIndexOf('@') + 1)}${fixed}` }
  })
}

/** Every low-confidence decision in a mapping, so the editor can say how many to look at first. */
export function countLowConfidence(mapping: IntakeMapping, edited: ReadonlySet<string>): number {
  return (
    mapping.columns.filter((c) => c.confidence === 'low' && !edited.has(columnKey(c.column))).length +
    mapping.roleValues.filter((v) => v.confidence === 'low' && !edited.has(roleKey(v.source))).length +
    mapping.departmentValues.filter((v) => v.confidence === 'low' && !edited.has(departmentKey(v.source))).length +
    mapping.demographicValues.filter((v) => v.confidence === 'low' && !edited.has(demographicKey(v.field, v.source)))
      .length
  )
}

export const columnKey = (column: number) => `column:${column}`
export const roleKey = (source: string) => `role:${source}`
export const departmentKey = (source: string) => `department:${source}`
export const demographicKey = (field: string, source: string) => `demographic:${field}:${source}`

/**
 * The departments an approval actually created: an approved new name is only created when a row
 * that was really invited uses it (`BulkImportEndpoints.ProcessRowsAsync`), so a name every row
 * using it failed for must not be announced as created.
 */
export function createdDepartments(approved: string[], result: BulkImportResponse): string[] {
  return approved.filter((name) =>
    result.rows.some(
      (row) => row.status === 'invited' && row.department !== null && row.department.toLowerCase() === name.toLowerCase(),
    ),
  )
}

/** The rows an insight names, capped so a 300-row typo does not become a 300-number sentence. */
export function rowList(rows: number[], max = 8): { shown: string; more: number } {
  return { shown: rows.slice(0, max).join(', '), more: Math.max(0, rows.length - max) }
}

/**
 * The progress checklist's stages. An upload that names no mapping may reach the model; a
 * corrected mapping never does, so its checklist has no AI stage at all rather than one that
 * would claim work that did not happen.
 */
export type StageName = 'read' | 'detect' | 'ai' | 'apply'
export type StageState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'

export function stagesFor(mode: 'initial' | 'manual'): StageName[] {
  return mode === 'manual' ? ['read', 'apply'] : ['read', 'detect', 'ai', 'apply']
}

/** When each stage is shown as finished while the request is still running, in ms. */
const TIMED_DONE: Partial<Record<StageName, number>> = { read: 700, detect: 1800 }

/**
 * Each stage's state at `elapsedMs`, or — once `source` is known — its final state. The last
 * stage never finishes on the clock: it is only done when the response has landed.
 */
export function stageStates(
  stages: StageName[],
  elapsedMs: number,
  source: IntakeSource | null,
): Record<StageName, StageState> {
  const states = {} as Record<StageName, StageState>
  if (source !== null) {
    for (const stage of stages) {
      states[stage] =
        stage !== 'ai' ? 'done' : source === 'template' ? 'skipped' : source === 'heuristic' ? 'failed' : 'done'
    }
    return states
  }
  let activeTaken = false
  for (const stage of stages) {
    const doneAt = TIMED_DONE[stage]
    if (doneAt !== undefined && elapsedMs >= doneAt) {
      states[stage] = 'done'
    } else if (!activeTaken) {
      states[stage] = 'active'
      activeTaken = true
    } else {
      states[stage] = 'pending'
    }
  }
  return states
}
