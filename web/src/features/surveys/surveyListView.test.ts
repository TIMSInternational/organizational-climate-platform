import { describe, it, expect } from 'vitest'
import {
  filterSurveysByStatus,
  surveyParticipationPercent,
  surveyResponseReading,
  surveyStatusFacets,
} from './surveyListView'
import { SURVEY_STATUSES } from './surveyVocabulary'
import type { SurveyListItem } from './api/surveys'

function survey(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 's1',
    title: 'Q3 climate survey',
    companyId: 'c1',
    type: 'periodic',
    status: 'draft',
    language: 'en',
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-09-30T00:00:00Z',
    responseCount: 4,
    targetAudienceCount: 40,
    questionCount: 8,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

describe('surveyStatusFacets', () => {
  it('emits every status in SurveyStatuses.All, in lifecycle order', () => {
    // The chip row's positions must not move between loads, and a status with no
    // rows has to be able to say "0" — an absent chip is indistinguishable from a
    // filter that does not exist.
    const facets = surveyStatusFacets([survey({ status: 'active' })])
    expect(facets.map((facet) => facet.status)).toEqual([...SURVEY_STATUSES])
  })

  it('counts the rows holding each status', () => {
    const facets = surveyStatusFacets([
      survey({ id: 'a', status: 'active' }),
      survey({ id: 'b', status: 'active' }),
      survey({ id: 'c', status: 'closed' }),
    ])
    const counts = Object.fromEntries(facets.map((facet) => [facet.status, facet.count]))
    expect(counts).toEqual({ draft: 0, scheduled: 0, active: 2, closed: 1, archived: 0 })
  })
})

describe('filterSurveysByStatus', () => {
  it('keeps only the rows holding the chosen status', () => {
    const rows = [survey({ id: 'a', status: 'active' }), survey({ id: 'b', status: 'closed' })]
    expect(filterSurveysByStatus(rows, 'closed').map((row) => row.id)).toEqual(['b'])
  })

  it('treats the empty string as "all", because that is what the wire means by it', () => {
    // `EMPTY_SURVEY_FILTERS` uses '' for no filter throughout, and a sentinel like
    // 'all' would be a 400 from `SurveyStatuses.IsValid` if it ever reached the wire.
    const rows = [survey({ id: 'a', status: 'active' }), survey({ id: 'b', status: 'closed' })]
    expect(filterSurveysByStatus(rows, '').map((row) => row.id)).toEqual(['a', 'b'])
  })
})

describe('surveyParticipationPercent', () => {
  it('is the response count over the expected audience, in whole points', () => {
    expect(surveyParticipationPercent(175, 208)).toBe(84)
  })

  it('is null when the survey declares no expected audience', () => {
    // Not 0. "Nobody has responded" and "there is nothing to measure against" are
    // different statements, and a bar at zero states the first one falsely.
    expect(surveyParticipationPercent(12, null)).toBeNull()
  })

  it('is null rather than Infinity when the expected audience is zero', () => {
    expect(surveyParticipationPercent(12, 0)).toBeNull()
  })

  it('reports over 100 rather than capping, when more people answered than expected', () => {
    expect(surveyParticipationPercent(56, 50)).toBe(112)
  })
})

describe('surveyResponseReading', () => {
  it('names a denominator only when it can also state a rate', () => {
    expect(surveyResponseReading(175, 208)).toEqual({ count: 175, target: 208, percent: 84 })
  })

  it('withholds the denominator when the expected audience is zero', () => {
    // The defect this exists to prevent: the Participation cell printed an em dash
    // meaning "there is nothing to measure against" while the Responses cell beside
    // it printed "5 of 0" and named one.
    expect(surveyResponseReading(5, 0)).toEqual({ count: 5, target: null, percent: null })
  })

  it('withholds the denominator when the survey declares no expected audience', () => {
    expect(surveyResponseReading(12, null)).toEqual({ count: 12, target: null, percent: null })
  })

  it('keeps target and percent null together, whatever the denominator is', () => {
    // Stated as the invariant rather than case by case, so a future denominator the
    // rate refuses (a negative count, say) cannot be printed by the other cell.
    for (const target of [null, -5, 0, 1, 40, 208]) {
      const reading = surveyResponseReading(5, target)
      expect(
        reading.target === null,
        `target ${String(target)} is printed as a denominator but has no rate`,
      ).toBe(reading.percent === null)
    }
  })
})
