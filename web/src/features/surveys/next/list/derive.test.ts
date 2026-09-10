import { describe, it, expect } from 'vitest'
import { groupBySection, orderSurveys, primaryActionFor } from './derive'
import type { SurveyRow } from './model'

function row(over: Partial<SurveyRow>): SurveyRow {
  return {
    id: 'id',
    title: 'T',
    companyId: 'c1',
    type: 'periodic',
    status: 'closed',
    language: 'es',
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-02-01T00:00:00Z',
    responseCount: 0,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const rows = [
  row({ id: 'copy', status: 'archived', endDate: '2026-10-10T00:00:00Z', createdAt: '2026-09-10T00:00:00Z' }),
  row({ id: 'q1', status: 'closed', endDate: '2026-02-12T00:00:00Z' }),
  row({ id: 'q3', status: 'closed', endDate: '2026-08-06T00:00:00Z' }),
  row({ id: 'draft', status: 'draft', startDate: '2026-11-01T00:00:00Z' }),
  row({ id: 'q4', status: 'active', endDate: '2026-10-10T00:00:00Z' }),
  row({ id: 'q2', status: 'closed', endDate: '2026-05-13T00:00:00Z' }),
]

const admin = { canAuthorSurveys: true, canOpenResults: () => true }
const leader = { canAuthorSurveys: false, canOpenResults: () => false }

describe('list derive', () => {
  it('puts the open survey first, closed ones newest first, and archived last whatever their date', () => {
    expect(orderSurveys(rows).map((r) => r.id)).toEqual(['q4', 'draft', 'q3', 'q2', 'q1', 'copy'])
    expect(groupBySection(rows).map((s) => [s.section, s.rows.length])).toEqual([
      ['open', 1],
      ['upcoming', 1],
      ['closed', 3],
      ['archived', 1],
    ])
  })

  it('offers exactly one action per row by status, and only one the viewer may take', () => {
    expect(primaryActionFor(row({ id: 'a', status: 'active' }), admin)).toEqual({ kind: 'distribution', to: '/surveys/a/distribution' })
    expect(primaryActionFor(row({ id: 'a', status: 'active' }), leader)).toEqual({ kind: 'open', to: '/surveys/a' })
    expect(primaryActionFor(row({ id: 'c', status: 'closed' }), admin)).toEqual({ kind: 'results', to: '/surveys/c/results' })
    expect(primaryActionFor(row({ id: 'c', status: 'closed' }), leader)).toEqual({ kind: 'open', to: '/surveys/c' })
    expect(primaryActionFor(row({ id: 'd', status: 'draft' }), admin)).toEqual({ kind: 'open', to: '/surveys/d' })
    expect(primaryActionFor(row({ id: 'x', status: 'archived' }), admin)).toBeNull()
  })
})
