import { describe, it, expect } from 'vitest'
import type { ClimateTrendsResponse } from '../../api/climateTrends'
import {
  deltaSince,
  latestValue,
  orderByLatest,
  sharedTrendAxis,
  standing,
  standings,
  trendAxis,
  waveMean,
  withoutArchived,
} from './derive'
import type { TrendDimension } from './model'

const dims: TrendDimension[] = [
  { key: 'a', name: 'A', values: [3.3, 3.7, 4.0] },
  { key: 'b', name: 'B', values: [3.0, 3.3, 3.7] },
  { key: 'c', name: 'C', values: [2.8, 3.1, 3.4] },
]

describe('trends derive', () => {
  it('judges a reading against the target at one decimal: above, on, below', () => {
    expect(standing(4.0, 3.7)).toBe('above')
    expect(standing(3.7, 3.7)).toBe('on')
    expect(standing(3.71, 3.7)).toBe('on')
    // 3,67 prints "3,7" beside "meta 3,7": on target, not below it.
    expect(standing(3.67, 3.7)).toBe('on')
    expect(standing(3.4, 3.7)).toBe('below')
    // The canvas's grey band: 3,46 prints "3,5" and is on target; 3,44 prints "3,4" and is below.
    expect(standing(3.46, 3.7)).toBe('on')
    expect(standing(3.44, 3.7)).toBe('below')
    expect(standings(dims, 3.7).map((s) => s.standing)).toEqual(['above', 'on', 'below'])
  })

  it('carries each standing\'s last move, and none across a withheld wave', () => {
    const judged = standings(
      [
        { key: 'a', name: 'A', values: [3.0, 3.3] },
        { key: 'b', name: 'B', values: [3.0, null, 3.4] },
      ],
      3.7,
    )
    expect(judged[0].lastMove).toBeCloseTo(0.3)
    // The wave before the latest reading is withheld: no move, never a reconstruction.
    expect(judged[1].lastMove).toBeNull()
  })

  it('never differences from or to a withheld wave, and does difference across one', () => {
    const values = [3.0, null, 3.6]
    expect(latestValue({ key: 'x', name: 'X', values })).toBe(3.6)
    // From a withheld wave: null, never 0 — a zero would read as "no change".
    expect(deltaSince(values, 1)).toBeNull()
    expect(deltaSince([null, 3.2, 3.6], 0)).toBeNull()
    // Across a withheld wave: both endpoints are disclosed, so the delta is.
    expect(deltaSince(values, 0)).toBeCloseTo(0.6)
    // To: the latest *disclosed* wave, so a trailing withheld wave is skipped, not differenced.
    expect(deltaSince([3.0, 3.2, null], 0)).toBeCloseTo(0.2)
    expect(deltaSince([3.0, 3.2, null], 1)).toBeNull()
    expect(deltaSince([null, null], 0)).toBeNull()
    // The move between the readings AS PRINTED: 2,75 → 3,33 prints "2,8" and "3,3", so +0,5.
    expect(deltaSince([2.75, 3.04, 3.33], 0)).toBe(0.5)
  })

  it('averages a wave over the dimensions that disclosed it, leaving withheld ones out of the denominator', () => {
    expect(waveMean(dims, 2)).toBeCloseTo((4.0 + 3.7 + 3.4) / 3)
    expect(waveMean([{ key: 'x', name: 'X', values: [null] }], 0)).toBeNull()
    const mixed: TrendDimension[] = [
      { key: 'a', name: 'A', values: [4.0] },
      { key: 'b', name: 'B', values: [null] },
      { key: 'c', name: 'C', values: [3.0] },
    ]
    expect(waveMean(mixed, 0)).toBeCloseTo(3.5)
  })

  it('spans a domain around every reading and the target, and labels the half-points from the lowest reading up', () => {
    // The canvas's linechart: domain 2,5–4,5, labels 3,0 · 3,5 · 4,0 · 4,5 over readings down to 2,8.
    expect(trendAxis([2.8, null, 3.4, 4.0], 3.7)).toEqual({ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] })
    expect(trendAxis([3.3, 3.7, 4.0], 3.7)).toEqual({ low: 3.0, high: 4.5, ticks: [3.5, 4.0, 4.5] })
    // A lowest reading of 2,75 prints "2,8": the first label is still 3,0.
    expect(trendAxis([2.75, 3.33], 3.7).ticks[0]).toBe(3.0)
    // A reading on a half-point is labelled at its own level.
    expect(trendAxis([3.0, 3.6], 3.7).ticks[0]).toBe(3.0)
  })

  it('puts every chart on ONE axis: the domain and the labels of every dimension together', () => {
    // A alone would start its labels at 3,5 and C at 3,0; side by side they must share one scale.
    expect(sharedTrendAxis(dims, 3.7)).toEqual({ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] })
  })

  it('orders the dimensions by the latest reading, highest first, ties and gaps stable', () => {
    const order = orderByLatest([
      { key: 'workload', name: 'W', values: [2.8, 3.3] },
      { key: 'belonging', name: 'B', values: [3.3, 4.0] },
      { key: 'never', name: 'N', values: [null, null] },
      { key: 'growth', name: 'G', values: [3.2, 3.8] },
      { key: 'safety', name: 'S', values: [3.2, 3.8] },
    ]).map((dimension) => dimension.key)
    expect(order).toEqual(['belonging', 'growth', 'safety', 'workload', 'never'])
  })
})

describe('withoutArchived', () => {
  function payload(): ClimateTrendsResponse {
    return {
      companyId: 'c1',
      groupBy: 'department',
      surveys: [
        { surveyId: 's1', title: 'Q1', status: 'closed', endDate: '2026-02-12T00:00:00Z', completedCount: 24, isSuppressed: false },
        { surveyId: 'copy', title: 'Q4 (Copia)', status: 'archived', endDate: '2026-10-10T00:00:00Z', completedCount: 1, isSuppressed: true },
        { surveyId: 's3', title: 'Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
      ],
      dimensions: [{ key: 'belonging', surveyCount: 3 }],
      groups: [
        {
          key: 'd-fin',
          label: 'Finanzas',
          points: [
            { surveyId: 's1', respondentCount: 0, isSuppressed: true, scores: [null] },
            { surveyId: 'copy', respondentCount: 6, isSuppressed: false, scores: [3.9] },
            { surveyId: 's3', respondentCount: 0, isSuppressed: true, scores: [null] },
          ],
        },
        {
          key: 'd-eng',
          label: 'Ingeniería',
          points: [
            { surveyId: 's1', respondentCount: 6, isSuppressed: false, scores: [3.7] },
            { surveyId: 'copy', respondentCount: 0, isSuppressed: true, scores: [null] },
            { surveyId: 's3', respondentCount: 6, isSuppressed: false, scores: [4.3] },
          ],
        },
      ],
      suppressedGroupCount: 0,
      minimumGroupSize: 5,
      generatedAt: '2026-09-10T00:00:00Z',
    }
  }

  it('takes an archived survey out of the window and its point out of every group, keeping the alignment', () => {
    const cut = withoutArchived(payload())
    expect(cut.surveys.map((survey) => survey.surveyId)).toEqual(['s1', 's3'])
    for (const group of cut.groups) {
      expect(group.points.map((point) => point.surveyId)).toEqual(['s1', 's3'])
    }
    expect(cut.groups[1].points.map((point) => point.scores[0])).toEqual([3.7, 4.3])
  })

  it('recounts the groups withheld in every wave that is left', () => {
    // The server counted 0: Finanzas was disclosed in the archived copy. Without it,
    // Finanzas is withheld in every closed wave, and the page must say so.
    expect(withoutArchived(payload()).suppressedGroupCount).toBe(1)
  })

  it('leaves a window with nothing archived exactly as it was', () => {
    const closedOnly = payload()
    closedOnly.surveys = closedOnly.surveys.filter((survey) => survey.status !== 'archived')
    closedOnly.groups = closedOnly.groups.map((group) => ({ ...group, points: group.points.filter((point) => point.surveyId !== 'copy') }))
    const cut = withoutArchived(closedOnly)
    expect(cut.surveys).toEqual(closedOnly.surveys)
    expect(cut.groups).toEqual(closedOnly.groups)
  })
})
