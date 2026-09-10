import { describe, it, expect } from 'vitest'
import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { SurveyQuestionResult } from '../api/surveyResults'
import type { ClimateMapModel } from '../surveyResultsMap'
import { distributionPoints, groupRows, lowShare, planFor } from './derive'
import type { SurveyResultsNextModel } from './model'
import { sampleWave } from './sampleModel'

function plan(id: string, departmentId: string | null, dueDate: string): ActionPlan {
  return { id, title: `Plan ${id}`, companyId: 'c1', departmentId, dueDate, status: 'open', priority: 'high', createdAt: '' }
}

const climate: ClimateMapModel = {
  dimensions: [
    { key: 'workload', questionIds: ['q1'] },
    { key: 'trust', questionIds: ['q2'] },
  ],
  rows: [
    { id: 'd-fin', label: 'Finanzas', responses: 3, scores: [] },
    { id: 'd-ops', label: 'Operaciones', responses: 10, scores: [2.4, 3.0] },
  ],
  target: 3.4,
  deadBandAt: 0.2,
  extremeAt: 1.5,
  threshold: 5,
  omittedDimensions: [],
  omittedSegments: [],
}

const model = {
  climate,
  questions: [] as SurveyQuestionResult[],
  breakdown: null,
  plans: null,
  previous: { status: 'none' },
  sample: sampleWave,
} as unknown as SurveyResultsNextModel

describe('derive', () => {
  it('planFor matches by department and takes the earliest due date', () => {
    const plans = [plan('late', 'd-ops', '2026-12-01'), plan('other', 'd-eng', '2026-09-01'), plan('soon', 'd-ops', '2026-10-15')]
    expect(planFor(plans, 'd-ops')?.id).toBe('soon')
    expect(planFor(plans, 'd-fin')).toBeNull()
    expect(planFor([plan('none', null, '2026-01-01')], 'd-ops')).toBeNull()
  })

  it('groupRows gives a protected row null scores and a null mean, never 0', () => {
    const rows = groupRows(model)
    expect(rows[0]).toMatchObject({ id: 'd-fin', isProtected: true, mean: null, scores: [null, null] })
    expect(rows[1]).toMatchObject({ id: 'd-ops', isProtected: false, mean: 2.7, scores: [2.4, 3.0] })
  })

  it('distributionPoints fills the scale points nobody chose with a true zero', () => {
    const question = {
      scaleMin: 1,
      scaleMax: 5,
      distribution: [
        { value: '2', label: null, count: 4, percentage: 40, averageRank: null },
        { value: '5', label: null, count: 6, percentage: 60, averageRank: null },
      ],
    } as unknown as SurveyQuestionResult
    const points = distributionPoints(question)
    expect(points.map((point) => point.percentage)).toEqual([0, 40, 0, 0, 60])
    expect(lowShare(points)).toBe(40)
  })
})
