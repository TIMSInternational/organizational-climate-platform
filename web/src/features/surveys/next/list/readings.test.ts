import { describe, it, expect } from 'vitest'
import type { ClimateTrendsResponse } from '../../api/climateTrends'
import { closedSummary, menuItemsFor, visibleFacets, waveReadings } from './derive'
import type { SurveyRow, WaveReading } from './model'

function trends(): ClimateTrendsResponse {
  return {
    companyId: 'c1',
    groupBy: null,
    surveys: [
      { surveyId: 'q1', title: 'Encuesta de Clima Q1', status: 'closed', endDate: '2026-02-12T00:00:00Z', completedCount: 24, isSuppressed: false },
      { surveyId: 'q2', title: 'Encuesta de Clima Q2', status: 'closed', endDate: '2026-05-13T00:00:00Z', completedCount: 24, isSuppressed: false },
      { surveyId: 'copy', title: 'Encuesta de Clima Q4 (Copia)', status: 'archived', endDate: '2026-10-10T00:00:00Z', completedCount: 1, isSuppressed: true },
      { surveyId: 'q3', title: 'Encuesta de Clima Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
    ],
    dimensions: [
      { key: 'belonging', surveyCount: 3 },
      { key: 'workload', surveyCount: 3 },
    ],
    groups: [
      {
        key: '__company__',
        label: null,
        points: [
          { surveyId: 'q1', respondentCount: 24, isSuppressed: false, scores: [3.0, 3.2] },
          { surveyId: 'q2', respondentCount: 24, isSuppressed: false, scores: [3.4, 3.4] },
          { surveyId: 'copy', respondentCount: 0, isSuppressed: true, scores: [null, null] },
          { surveyId: 'q3', respondentCount: 24, isSuppressed: false, scores: [4.0, 3.4] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: '2026-09-10T00:00:00Z',
  }
}

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
    responseCount: 24,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('waveReadings — the "+0,29 frente a Q2" under a closed row', () => {
  it('reads each closed wave against the closed wave before it, skipping an archived one', () => {
    const readings = waveReadings(trends())
    expect(readings.get('q1')).toEqual({ first: true, delta: null, previousCode: null, completedCount: 24 })
    // (3.4 + 3.4) / 2 − (3.0 + 3.2) / 2 = +0.3, against Q1.
    expect(readings.get('q2')?.delta).toBeCloseTo(0.3)
    expect(readings.get('q2')?.previousCode).toBe('Q1')
    // Q3 is read against Q2 — never against the archived copy that sits between them on the wire.
    expect(readings.get('q3')?.delta).toBeCloseTo(0.3)
    expect(readings.get('q3')?.previousCode).toBe('Q2')
    expect(readings.has('copy')).toBe(false)
  })

  it('prints no move beside a wave the floor withheld, on either side of it', () => {
    const payload = trends()
    payload.surveys[1] = { ...payload.surveys[1], isSuppressed: true }
    payload.groups[0].points[1] = { surveyId: 'q2', respondentCount: 3, isSuppressed: true, scores: [3.4, 3.4] }
    const readings = waveReadings(payload)
    expect(readings.get('q2')?.delta).toBeNull()
    // Q3 − Q2 beside a disclosed Q3 would reconstruct the withheld Q2.
    expect(readings.get('q3')?.delta).toBeNull()
  })
})

describe('closedSummary — "Cada una con 24 respuestas · 100 % completadas"', () => {
  const read = (completed: number): WaveReading => ({ first: false, delta: null, previousCode: null, completedCount: completed })

  it('says the shared count and the completed share when both are known', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })]
    expect(closedSummary(rows, new Map([['a', read(24)], ['b', read(24)]]))).toEqual({ each: 24, completion: 100 })
  })

  it('drops the shared count when the counts differ, and the share when a row has no completed count', () => {
    const rows = [row({ id: 'a', responseCount: 24 }), row({ id: 'b', responseCount: 20 })]
    expect(closedSummary(rows, new Map([['a', read(24)], ['b', read(10)]]))).toEqual({ each: null, completion: (34 / 44) * 100 })
    expect(closedSummary(rows, new Map([['a', read(24)]]))).toBeNull()
  })
})

describe('the chip row and the row menu', () => {
  it('draws only the statuses that have a survey, and the chosen one even at zero', () => {
    const facets = [
      { status: 'draft', count: 0 },
      { status: 'active', count: 1 },
      { status: 'closed', count: 3 },
    ]
    expect(visibleFacets(facets, '').map((facet) => facet.status)).toEqual(['active', 'closed'])
    expect(visibleFacets(facets, 'draft').map((facet) => facet.status)).toEqual(['draft', 'active', 'closed'])
  })

  it('offers the survey to everyone and a duplicate only to an author — never a restore', () => {
    expect(menuItemsFor({ canAuthorSurveys: true })).toEqual(['view', 'duplicate'])
    expect(menuItemsFor({ canAuthorSurveys: false })).toEqual(['view'])
  })
})
