import { describe, expect, it } from 'vitest'
import type { ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import { daysToDue, dueDay, elapsedShare, planFinding } from './planDetailDerive'

/** The tenant's plan: due 2026-10-15T02:05Z, which the list prints as the 15th. */
const DUE = '2026-10-15T02:05:50.278+00:00'

describe('the due date', () => {
  it('is the UTC calendar day the list prints', () => {
    expect(dueDay(DUE)).toBe('2026-10-15')
  })

  it('counts 35 days from 10 Sep, as the board reads it, and goes negative once passed', () => {
    expect(daysToDue('2026-09-10', DUE)).toBe(35)
    expect(daysToDue('2026-10-18', DUE)).toBe(-3)
  })

  it('places a plan created today at the left end of its timeline, and a late one at the right', () => {
    expect(elapsedShare('2026-09-10T02:05:50Z', '2026-09-10', DUE)).toBe(0)
    expect(elapsedShare('2026-09-10T02:05:50Z', '2026-09-27', DUE)).toBeCloseTo(17 / 35)
    expect(elapsedShare('2026-09-10T02:05:50Z', '2026-11-01', DUE)).toBe(1)
    expect(elapsedShare(null, '2026-09-27', DUE)).toBe(0)
  })
})

const OPS = 'ops'
const SALES = 'sales'

function trends(opsPoint: { respondentCount: number; isSuppressed: boolean; scores: (number | null)[] }): ClimateTrendsResponse {
  return {
    companyId: 'c1',
    groupBy: 'department',
    surveys: [
      { surveyId: 'q2', title: 'Encuesta de Clima Q2', status: 'closed', endDate: '2026-05-13T00:00:00Z', completedCount: 24, isSuppressed: false },
      { surveyId: 'q3', title: 'Encuesta de Clima Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
    ],
    dimensions: [
      { key: 'trust', surveyCount: 2 },
      { key: 'workload', surveyCount: 2 },
    ],
    groups: [
      {
        key: OPS,
        label: 'Operaciones',
        points: [
          { surveyId: 'q2', respondentCount: 6, isSuppressed: false, scores: [1.1, 1.2] },
          { surveyId: 'q3', ...opsPoint },
        ],
      },
      {
        key: SALES,
        label: 'Ventas',
        points: [
          { surveyId: 'q2', respondentCount: 6, isSuppressed: false, scores: [3.5, 3.6] },
          { surveyId: 'q3', respondentCount: 7, isSuppressed: false, scores: [3.1, 2.9] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: '2026-09-10T00:00:00Z',
  }
}

describe('the originating finding', () => {
  it('is the lowest cell of the plan’s row in the latest closed wave, judged against the target', () => {
    const finding = planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }), 'q3', OPS, 3.7)
    expect(finding).toEqual({
      status: 'shown',
      surveyId: 'q3',
      surveyTitle: 'Encuesta de Clima Q3',
      code: 'Q3',
      dimensionKey: 'workload',
      score: 2.4,
      belowTarget: true,
      lowestOfMap: true,
    })
  })

  it('says when the plan’s cell is not the lowest of the whole map', () => {
    const finding = planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 3.0] }), 'q3', OPS, 3.7)
    expect(finding.status === 'shown' && finding.lowestOfMap).toBe(false)
  })

  it('yields no number for a row the server withheld — never the lowest of an empty row', () => {
    const finding = planFinding(trends({ respondentCount: 0, isSuppressed: true, scores: [null, null] }), 'q3', OPS, 3.7)
    expect(finding).toEqual({ status: 'protected', surveyId: 'q3', surveyTitle: 'Encuesta de Clima Q3', code: 'Q3' })
  })

  it('protects a row under the floor even when the server sent its scores', () => {
    const finding = planFinding(trends({ respondentCount: 4, isSuppressed: false, scores: [3.2, 2.4] }), 'q3', OPS, 3.7)
    expect(finding.status).toBe('protected')
  })

  it('finds nothing for a department the map does not have', () => {
    expect(planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }), 'q3', 'unknown', 3.7)).toEqual({
      status: 'none',
    })
  })

  it('falls back to the latest closed wave the map carries when no survey is named', () => {
    const finding = planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }), null, OPS, 3.7)
    expect(finding.status === 'shown' && finding.surveyId).toBe('q3')
  })
})
