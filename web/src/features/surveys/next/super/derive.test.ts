import { describe, it, expect } from 'vitest'
import type { SurveyRow } from '../list/model'
import {
  ALL_COMPANIES,
  closedNote,
  closedOrdinal,
  companiesWithClosed,
  companyCount,
  draftsNote,
  forCompany,
  sharedOpenWave,
  upcomingKind,
} from './derive'

function row(over: Partial<SurveyRow>): SurveyRow {
  return {
    id: 'id',
    title: 'Encuesta de Clima Q3',
    companyId: 'meridiano',
    type: 'periodic',
    status: 'closed',
    language: 'both',
    startDate: '2026-07-16T00:00:00Z',
    endDate: '2026-08-06T00:00:00Z',
    responseCount: 24,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  }
}

/** The platform the local API answered on 10 Sep 2026: two tenants, the list across both. */
const ROWS: SurveyRow[] = [
  row({ id: 'm-q4', title: 'Encuesta de Clima Q4 (abierta)', status: 'active', targetAudienceCount: 24, responseCount: 3 }),
  row({ id: 'a-q4', title: 'Encuesta de Clima Q4 (abierta)', status: 'active', companyId: 'acme', targetAudienceCount: 24, responseCount: 1 }),
  row({ id: 'm-q1', endDate: '2026-02-12T00:00:00Z' }),
  row({ id: 'm-q3', endDate: '2026-08-06T00:00:00Z' }),
  row({ id: 'm-q2', endDate: '2026-05-13T00:00:00Z' }),
  row({ id: 'a-q1', companyId: 'acme', endDate: '2026-01-29T00:00:00Z' }),
  row({ id: 'd1', status: 'draft', companyId: 'acme', questionCount: 1, createdAt: '2026-08-08T12:00:00Z' }),
  row({ id: 'd2', status: 'draft', companyId: 'acme', questionCount: 1, createdAt: '2026-08-09T12:00:00Z' }),
]

describe('super surveys derive', () => {
  it('cuts the platform list by company, and counts the companies it spans', () => {
    expect(forCompany(ROWS, ALL_COMPANIES)).toHaveLength(8)
    expect(forCompany(ROWS, 'acme').map((r) => r.id)).toEqual(['a-q4', 'a-q1', 'd1', 'd2'])
    expect(companyCount(ROWS)).toBe(2)
  })

  it('names the wave every open survey shares, and no wave when a title names none', () => {
    expect(sharedOpenWave(ROWS)).toBe('Q4')
    expect(sharedOpenWave([row({ status: 'active', title: 'Pulso de bienestar' })])).toBeNull()
    expect(sharedOpenWave([row({ status: 'active', title: 'Clima Q4' }), row({ status: 'active', title: 'Clima Q3' })])).toBeNull()
  })

  it('places a closed survey in its own company\'s series, oldest first', () => {
    expect(closedOrdinal(ROWS.find((r) => r.id === 'm-q1')!, ROWS)).toBe(1)
    expect(closedOrdinal(ROWS.find((r) => r.id === 'm-q3')!, ROWS)).toBe(3)
    expect(closedOrdinal(ROWS.find((r) => r.id === 'a-q1')!, ROWS)).toBe(1)
  })

  it('says "all from Acme, one question each, since the earliest" only when each clause holds', () => {
    expect(draftsNote(ROWS)).toEqual({ companyId: 'acme', oneQuestion: true, since: '2026-08-08T12:00:00Z' })
    const mixed = [...ROWS, row({ id: 'd3', status: 'draft', companyId: 'meridiano', questionCount: 6, createdAt: '2026-08-10T00:00:00Z' })]
    expect(draftsNote(mixed)).toEqual({ companyId: null, oneQuestion: false, since: '2026-08-08T12:00:00Z' })
    expect(draftsNote(ROWS.filter((r) => r.status !== 'draft'))).toBeNull()
  })

  it('heads the not-yet-open block by what it holds', () => {
    expect(upcomingKind(ROWS)).toBe('drafts')
    expect(upcomingKind([row({ status: 'scheduled' })])).toBe('scheduled')
    expect(upcomingKind([row({ status: 'scheduled' }), row({ status: 'draft' })])).toBe('mixed')
  })

  it('says every closed survey has 24 responses and no invitation list — and says neither when it is not so', () => {
    expect(closedNote(ROWS)).toEqual({ each: 24, noInviteLists: true })
    expect(closedNote([row({ responseCount: 24 }), row({ responseCount: 12, targetAudienceCount: 30 })])).toEqual({
      each: null,
      noInviteLists: false,
    })
  })

  it('reads trends only for companies that have a closed survey', () => {
    expect(companiesWithClosed(ROWS).sort()).toEqual(['acme', 'meridiano'])
    expect(companiesWithClosed(ROWS.filter((r) => r.status !== 'closed'))).toEqual([])
  })
})
