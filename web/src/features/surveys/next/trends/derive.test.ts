import { describe, it, expect } from 'vitest'
import { DEFAULT_RESULT_BANDS } from '../../../../components/charts'
import type { ClimateTrendsResponse } from '../../api/climateTrends'
import {
  deltaSince,
  latestValue,
  orderByLatest,
  bandOfReading,
  sharedTrendAxis,
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
  it('reads a reading in the company’s bands at one decimal: strength, opportunity, critical', () => {
    const B = DEFAULT_RESULT_BANDS
    expect(bandOfReading(4.0, B)).toBe('strength')
    // 3,96 prints "4,0": strength, not opportunity.
    expect(bandOfReading(3.96, B)).toBe('strength')
    expect(bandOfReading(3.7, B)).toBe('opportunity')
    // 2,96 prints "3,0": opportunity; 2,94 prints "2,9": critical.
    expect(bandOfReading(2.96, B)).toBe('opportunity')
    expect(bandOfReading(2.94, B)).toBe('critical')
    expect(standings(dims, B).map((s) => s.band)).toEqual(['strength', 'opportunity', 'opportunity'])
  })

  it('carries each standing\'s last move, and none across a withheld wave', () => {
    const judged = standings(
      [
        { key: 'a', name: 'A', values: [3.0, 3.3] },
        { key: 'b', name: 'B', values: [3.0, null, 3.4] },
      ],
      DEFAULT_RESULT_BANDS,
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

  it('averages the UNROUNDED means, so it is 3,65 and never the artboard’s 3,67', () => {
    // Ruled 2026-09-14 (`docs/decisions/app-wide-mean.md`). The case above cannot tell the
    // two rules apart: its values are already at one decimal, so both give the same answer.
    // These are Grupo Meridiano's real Q3 company row from
    // `scripts/shot-fixtures/redesign-meridiano.json`, which do separate them:
    //   unrounded  21,92 / 6 = 3,6533 -> 3,65   <- the rule
    //   as printed 22,0  / 6 = 3,6667 -> 3,67   <- what the artboard draws, rejected
    const q3: TrendDimension[] = [4, 3.79, 3.75, 3.38, 3.67, 3.33].map((value, index) => ({
      key: `d${index}`,
      name: `D${index}`,
      values: [value],
    }))
    expect(waveMean(q3, 0)).toBeCloseTo(3.6533, 4)
    expect(Number(waveMean(q3, 0)?.toFixed(2))).toBe(3.65)
    expect(Number(waveMean(q3, 0)?.toFixed(2))).not.toBe(3.67)
  })

  it('spans a domain around every reading and both band boundaries, and labels the half-points from the lowest up', () => {
    const B = DEFAULT_RESULT_BANDS
    // The canvas's linechart: domain 2,5–4,5, labels 3,0 · 3,5 · 4,0 · 4,5 over readings down to 2,8.
    expect(trendAxis([2.8, null, 3.4, 4.0], B)).toEqual({ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] })
    // Readings all in 3,3–4,0 still show the critical boundary at 3,00: all three areas are on the chart.
    expect(trendAxis([3.3, 3.7, 4.0], B)).toEqual({ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] })
    // …and readings all under 3,5 still reach the strength boundary at 4,00.
    expect(trendAxis([3.1, 3.2], B).high).toBe(4.5)
    // A lowest reading of 2,75 prints "2,8": the first label is still 3,0.
    expect(trendAxis([2.75, 3.33], B).ticks[0]).toBe(3.0)
    // The company's own boundaries widen the axis: a critical area that ends at 2,0.
    expect(trendAxis([3.3, 3.7], { ...B, opportunityMin: 2 }).low).toBe(1.5)
  })

  it('puts every chart on ONE axis: the domain and the labels of every dimension together', () => {
    // A alone would start its labels at 3,5 and C at 3,0; side by side they must share one scale.
    expect(sharedTrendAxis(dims, DEFAULT_RESULT_BANDS)).toEqual({ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] })
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
        {
          // Withheld in one closed wave and disclosed in the other: never protected in
          // EVERY wave that is left, so it must not be counted.
          key: 'd-ops',
          label: 'Operaciones',
          points: [
            { surveyId: 's1', respondentCount: 0, isSuppressed: true, scores: [null] },
            { surveyId: 'copy', respondentCount: 0, isSuppressed: true, scores: [null] },
            { surveyId: 's3', respondentCount: 6, isSuppressed: false, scores: [2.9] },
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

  it('does not count a group withheld in only some of the waves that are left', () => {
    // Operaciones is withheld in Q1 and disclosed in Q3. Counting it would tell the reader
    // a group is protected throughout when Q3 printed its number.
    const cut = withoutArchived(payload())
    const withheldEverywhere = cut.groups.filter((group) => group.points.every((point) => point.isSuppressed))
    expect(withheldEverywhere.map((group) => group.key)).toEqual(['d-fin'])
    expect(cut.suppressedGroupCount).toBe(1)
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
