import { describe, it, expect } from 'vitest'
import {
  applyDomainFixes,
  chunkForImport,
  columnLetter,
  createdDepartments,
  credentialsNotSent,
  formatModelName,
  mergeImportResponses,
  parseColumnChoice,
  parseDepartmentChoice,
  departmentChoice,
  columnChoice,
  rowList,
  stageStates,
  stagesFor,
} from './intakeModel'
import type { IntakeRow } from '../../api/intake'

describe('formatModelName', () => {
  it('names a Claude id as a person would say it', () => {
    expect(formatModelName('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5')
  })

  it('leaves anything else as the server sent it', () => {
    expect(formatModelName('unknown')).toBe('unknown')
  })
})

describe('applyDomainFixes', () => {
  const rows = [
    { rowNumber: 2, name: 'A', email: 'a@gmial.com', role: 'employee', department: null },
    { rowNumber: 3, name: 'B', email: 'b@GMIAL.com', role: 'employee', department: null },
    { rowNumber: 4, name: 'C', email: 'c@gmail.com', role: 'employee', department: null },
    { rowNumber: 5, name: 'D', email: '', role: 'employee', department: null },
  ]

  it('rewrites only the domain, only on the rows that carry it', () => {
    expect(applyDomainFixes(rows, { 'gmial.com': 'gmail.com' }).map((r) => r.email)).toEqual([
      'a@gmail.com',
      'b@gmail.com',
      'c@gmail.com',
      '',
    ])
  })

  it('returns the same rows when there is nothing to fix', () => {
    expect(applyDomainFixes(rows, {})).toBe(rows)
  })
})

describe('stageStates', () => {
  it('never finishes the last stage on the clock', () => {
    const states = stageStates(stagesFor('initial'), 60_000, null)
    expect(states).toEqual({ read: 'done', detect: 'done', ai: 'active', apply: 'pending' })
  })

  it('resolves the AI stage by what the response says happened', () => {
    expect(stageStates(stagesFor('initial'), 0, 'ai').ai).toBe('done')
    expect(stageStates(stagesFor('initial'), 0, 'template').ai).toBe('skipped')
    expect(stageStates(stagesFor('initial'), 0, 'heuristic').ai).toBe('failed')
  })

  it('has no AI stage for a corrected mapping', () => {
    expect(stagesFor('manual')).toEqual(['read', 'apply'])
  })
})

describe('choices', () => {
  it('round-trips a column and a department choice', () => {
    expect(parseColumnChoice(columnChoice({ target: 'demographic', demographicField: 'gender' }))).toEqual({
      target: 'demographic',
      demographicField: 'gender',
    })
    expect(parseColumnChoice('email')).toEqual({ target: 'email', demographicField: null })
    for (const value of [
      { department: 'Ventas', createNew: true },
      { department: 'Ingeniería', createNew: false },
      { department: null, createNew: false },
    ]) {
      expect(parseDepartmentChoice(departmentChoice(value))).toEqual(value)
    }
  })
})

describe('small formatting', () => {
  it('names columns as Excel does', () => {
    expect([1, 26, 27, 52].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AZ'])
  })

  it('caps a long row list', () => {
    expect(rowList([1, 2, 3], 2)).toEqual({ shown: '1, 2', more: 1 })
  })
})

describe('createdDepartments', () => {
  it('announces only departments an invited row actually used', () => {
    const result = {
      rows: [
        { rowNumber: 2, name: 'A', email: 'a@x.test', role: 'employee', department: 'logística', status: 'invited', errors: [] },
        { rowNumber: 3, name: 'B', email: 'b@x.test', role: 'employee', department: 'Ventas', status: 'error', errors: [] },
      ],
      successCount: 1,
      errorCount: 1,
    }
    expect(createdDepartments(['Logística', 'Ventas'], result)).toEqual(['Logística'])
  })

  // A mass invite returns `created`, not `invited`. Reading only `invited` meant the done step
  // stayed silent about a department the import had really created.
  it('counts a created account, which is what a mass invite returns', () => {
    const result = {
      rows: [
        { rowNumber: 2, name: 'A', email: 'a@x.test', role: 'employee', department: 'logística', status: 'created', errors: [] },
        { rowNumber: 3, name: 'B', email: 'b@x.test', role: 'employee', department: 'Ventas', status: 'error', errors: [] },
      ],
      successCount: 1,
      errorCount: 1,
    }
    expect(createdDepartments(['Logística', 'Ventas'], result)).toEqual(['Logística'])
  })
})

describe('credentialsNotSent', () => {
  const row = (rowNumber: number, issues: { code: string }[]) => ({
    rowNumber, name: 'A', email: `a${rowNumber}@x.test`, role: 'employee', department: null,
    status: 'created', errors: [], issues,
  })

  // The API says so and the client used to throw it away, so a mass invite whose mail never
  // left read as "N correctas, 0 errores".
  it('names the rows whose sign-in details did not go out', () => {
    const result = {
      rows: [row(2, [{ code: 'credentials_not_sent' }]), row(3, []), row(4, [{ code: 'credentials_not_sent' }])],
      successCount: 3,
      errorCount: 0,
    }
    expect(credentialsNotSent(result)).toEqual([2, 4])
  })

  it('is empty when every mail went, and survives a row with no issues array at all', () => {
    const result = {
      rows: [row(2, []), { ...row(3, []), issues: undefined }],
      successCount: 2,
      errorCount: 0,
    }
    expect(credentialsNotSent(result)).toEqual([])
  })
})

/**
 * The batching the 120-second request budget forces, and the merge that makes a batched import
 * read as one. `IMPORT_CHUNK_ROWS` in `api/intake.ts` holds the arithmetic.
 */
describe('chunkForImport', () => {
  const people = (count: number): IntakeRow[] =>
    Array.from({ length: count }, (_, i) => ({
      rowNumber: i + 2,
      name: `Persona ${i + 1}`,
      email: `persona${i + 1}@esph.test`,
      role: 'employee',
      department: null,
    }))

  it('sends a file that fits in one request as one request', () => {
    expect(chunkForImport(people(100)).map((batch) => batch.length)).toEqual([100])
    expect(chunkForImport(people(1)).map((batch) => batch.length)).toEqual([1])
  })

  it('splits 800 people into eight requests of a hundred', () => {
    expect(chunkForImport(people(800)).map((batch) => batch.length)).toEqual([100, 100, 100, 100, 100, 100, 100, 100])
  })

  it('leaves the remainder in a last, shorter batch', () => {
    expect(chunkForImport(people(250)).map((batch) => batch.length)).toEqual([100, 100, 50])
  })

  it('keeps the file order, so the batches concatenate back into the reviewed rows', () => {
    const rows = people(250)
    expect(chunkForImport(rows).flat()).toEqual(rows)
  })

  it('asks the server once for an empty file rather than deciding the verdict itself', () => {
    expect(chunkForImport([])).toEqual([[]])
  })
})

describe('mergeImportResponses', () => {
  const part = (rowNumbers: number[], successCount: number, errorCount: number) => ({
    rows: rowNumbers.map((rowNumber) => ({
      rowNumber,
      name: `Persona ${rowNumber}`,
      email: `persona${rowNumber}@esph.test`,
      role: 'employee',
      department: null,
      status: 'created',
      errors: [],
      issues: [],
    })),
    successCount,
    errorCount,
  })

  it('reads as the one answer the done step was written for', () => {
    const merged = mergeImportResponses([part([2, 3], 2, 0), part([4, 5, 6], 2, 1)])
    expect(merged.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4, 5, 6])
    expect(merged.successCount).toBe(4)
    expect(merged.errorCount).toBe(1)
  })

  it('sums the server\'s own counts rather than recounting the statuses', () => {
    // Both rows say `created`, and the server still called one of them an error. Whatever
    // reason it had, this function is not entitled to a second opinion about it.
    const merged = mergeImportResponses([part([2, 3], 1, 1)])
    expect(merged.successCount).toBe(1)
    expect(merged.errorCount).toBe(1)
  })

  it('reports only what landed, which after a failure part-way is fewer batches than were sent', () => {
    expect(mergeImportResponses([part([2, 3], 2, 0)]).rows).toHaveLength(2)
    expect(mergeImportResponses([])).toEqual({ rows: [], successCount: 0, errorCount: 0 })
  })
})
