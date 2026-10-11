import { describe, it, expect } from 'vitest'
import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { SurveyQuestionResult } from '../api/surveyResults'
import type { ClimateMapModel } from '../surveyResultsMap'
import { distributionPoints, groupRows, lowShare, planFor, planForCell } from './derive'
import type { SurveyResultsNextModel } from './model'

function plan(id: string, departmentId: string | null, dueDate: string, tags?: string[]): ActionPlan {
  return { id, title: `Plan ${id}`, companyId: 'c1', departmentId, dueDate, status: 'open', priority: 'high', createdAt: '', ...(tags ? { tags } : {}) }
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
} as unknown as SurveyResultsNextModel

describe('derive', () => {
  it('planFor matches by department and takes the earliest due date', () => {
    const plans = [plan('late', 'd-ops', '2026-12-01'), plan('other', 'd-eng', '2026-09-01'), plan('soon', 'd-ops', '2026-10-15')]
    expect(planFor(plans, 'd-ops')?.id).toBe('soon')
    expect(planFor(plans, 'd-fin')).toBeNull()
    expect(planFor([plan('none', null, '2026-01-01')], 'd-ops')).toBeNull()
  })

  /**
   * The lookup behind the panel's open-or-create control. `planFor` answers "what is being
   * done about this group"; this answers "is THIS finding being acted on", and conflating
   * them made every cell but the first on a department unable to raise a plan.
   */
  it('planForCell matches department AND dimension, and takes the earliest due date', () => {
    const plans = [
      plan('rec', 'd-ops', '2026-10-15', ['seguimiento', 'department:d-ops', 'dimension:recognition']),
      plan('late-workload', 'd-ops', '2026-12-01', ['dimension:workload']),
      plan('soon-workload', 'd-ops', '2026-11-01', ['dimension:workload']),
      plan('other-dept', 'd-eng', '2026-09-01', ['dimension:workload']),
    ]
    expect(planForCell(plans, 'd-ops', 'workload')?.id).toBe('soon-workload')
    expect(planForCell(plans, 'd-ops', 'recognition')?.id).toBe('rec')
    // The group has plans, but none for this dimension — the cell is free to raise one.
    expect(planForCell(plans, 'd-ops', 'trust')).toBeNull()
    expect(planForCell(plans, 'd-fin', 'workload')).toBeNull()
  })

  /**
   * The `dimension:` tag is newer than action plans themselves, and a plan raised from
   * `/action-plans` rather than from a cell never carries one. An untagged plan could be
   * about this cell, so the cell shows it rather than inviting a duplicate; only a group
   * whose plans all name some OTHER dimension leaves this cell free to raise its own.
   */
  it('planForCell falls back to a plan that names no dimension, but not to another dimension’s', () => {
    const untagged = plan('untagged', 'd-ops', '2026-10-01')
    expect(planFor([untagged], 'd-ops')?.id).toBe('untagged')
    expect(planForCell([untagged], 'd-ops', 'workload')?.id).toBe('untagged')

    // Once a plan for THIS cell exists, it wins over the unscoped one regardless of date.
    const mine = plan('mine', 'd-ops', '2026-12-01', ['dimension:workload'])
    expect(planForCell([untagged, mine], 'd-ops', 'workload')?.id).toBe('mine')

    // A group whose only plan names another dimension does not cover this cell.
    expect(planForCell([plan('rec', 'd-ops', '2026-10-01', ['dimension:recognition'])], 'd-ops', 'workload')).toBeNull()
  })

  it('planForCell ignores a cancelled plan', () => {
    const cancelled = { ...plan('gone', 'd-ops', '2026-10-01', ['dimension:workload']), status: 'cancelled' as const }
    expect(planForCell([cancelled], 'd-ops', 'workload')).toBeNull()
    const cancelledUntagged = { ...plan('gone2', 'd-ops', '2026-10-01'), status: 'cancelled' as const }
    expect(planForCell([cancelledUntagged], 'd-ops', 'workload')).toBeNull()
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
