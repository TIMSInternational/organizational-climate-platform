import { describe, it, expect } from 'vitest'
import {
  applyDomainFixes,
  columnLetter,
  createdDepartments,
  formatModelName,
  parseColumnChoice,
  parseDepartmentChoice,
  departmentChoice,
  columnChoice,
  rowList,
  stageStates,
  stagesFor,
} from './intakeModel'

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
})
