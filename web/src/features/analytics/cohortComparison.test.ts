import { describe, it, expect } from 'vitest'
import { buildCohortRows, median, niceMax, trackFraction } from './cohortComparison'
import type { Benchmark, BenchmarkMetric } from './api/benchmarks'

function metric(metricName: string, value: number, unit = '%'): BenchmarkMetric {
  return { id: `${metricName}-${value}`, metricName, value, unit, percentile: null, sampleSize: null }
}

function benchmark(id: string, metrics: BenchmarkMetric[]): Benchmark {
  return {
    id,
    name: id,
    description: '',
    type: 'industry',
    category: 'engagement',
    source: 'survey',
    industry: null,
    companySize: null,
    region: null,
    companyId: null,
    isActive: true,
    validationStatus: 'validated',
    qualityScore: 0.9,
    priorPeriodBenchmarkId: null,
    metrics,
    priorPeriodStatus: 'unlinked',
    priorPeriod: null,
  }
}

describe('median', () => {
  it('is the middle value for an odd count', () => {
    expect(median([9, 1, 5])).toBe(5)
  })

  it('is the mean of the two middle values for an even count', () => {
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })

  it('is null for an empty list rather than NaN', () => {
    expect(median([])).toBeNull()
  })

  it('does not reorder the caller\'s array', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })

  /**
   * The reason this is a median at all: one mis-entered cohort value must not drag
   * the reference the subject is judged against.
   */
  it('ignores a single wild outlier that would move a mean', () => {
    expect(median([68, 70, 850])).toBe(70)
  })
})

describe('niceMax', () => {
  it.each([
    [74, 100],
    [12, 20],
    [1.2, 2],
    [1200, 2000],
    [4200, 5000],
    [0.92, 1],
    [0.0004, 0.0005],
  ])('rounds %d up to the axis stop %d', (value, expected) => {
    expect(niceMax(value)).toBeCloseTo(expected, 10)
  })

  /**
   * A value that already IS a round number must stay there rather than be pushed a
   * step up by the floating-point error in `log10`. `Math.log10(1000)` and the
   * `10 ** n` that follows it are exactly where that goes wrong.
   */
  it.each([1, 2, 5, 10, 20, 100, 200, 1000, 5000])('leaves the round number %d alone', (value) => {
    expect(niceMax(value)).toBe(value)
  })

  it('has no axis for zero or a negative largest value', () => {
    expect(niceMax(0)).toBe(0)
    expect(niceMax(-5)).toBe(0)
  })
})

describe('trackFraction', () => {
  it('is the value as a fraction of the scale', () => {
    expect(trackFraction(35, 70)).toBe(0.5)
  })

  it('clamps above the scale to 1', () => {
    expect(trackFraction(90, 70)).toBe(1)
  })

  /** Bars are anchored at zero, so a negative value draws nothing. */
  it('clamps a negative value to 0 rather than drawing leftwards', () => {
    expect(trackFraction(-20, 70)).toBe(0)
  })

  it('is 0 when the scale is 0, rather than dividing by zero', () => {
    expect(trackFraction(5, 0)).toBe(0)
  })
})

describe('buildCohortRows', () => {
  it('folds the cohort to a median and states the subject\'s difference from it', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 74)]),
      benchmark('a', [metric('engagement', 60)]),
      benchmark('b', [metric('engagement', 70)]),
      benchmark('c', [metric('engagement', 90)]),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].subject).toBe(74)
    expect(rows[0].cohortMedian).toBe(70)
    expect(rows[0].delta).toBe(4)
  })

  it('scales the row to a round number above its largest value, so no bar is always full', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 40)]),
      benchmark('a', [metric('engagement', 90)]),
    ])

    // 90, not 100, would put the cohort bar hard against the end of the track on
    // every row where the cohort is the larger of the two.
    expect(rows[0].scaleMax).toBe(100)
    expect(trackFraction(rows[0].subject!, rows[0].scaleMax)).toBeCloseTo(0.4)
    expect(trackFraction(rows[0].cohortMedian!, rows[0].scaleMax)).toBeCloseTo(0.9)
  })

  /**
   * Each metric is scaled independently. A percentage and a headcount share no
   * axis, so one table-wide scale would flatten every percentage row to nothing.
   */
  it('scales each metric independently', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 74), metric('headcount', 4200, 'people')]),
      benchmark('a', [metric('engagement', 70), metric('headcount', 3000, 'people')]),
    ])

    expect(rows.map((row) => row.scaleMax)).toEqual([100, 5000])
  })

  it('reports no cohort median when no cohort member records the metric', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 74)]),
      benchmark('a', [metric('turnover', 12)]),
    ])

    const engagement = rows.find((row) => row.metricName === 'engagement')!
    expect(engagement.cohortMedian).toBeNull()
    expect(engagement.delta).toBeNull()
  })

  it('reports no subject value when only the cohort records the metric', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 74)]),
      benchmark('a', [metric('turnover', 12)]),
    ])

    const turnover = rows.find((row) => row.metricName === 'turnover')!
    expect(turnover.subject).toBeNull()
    expect(turnover.cohortMedian).toBe(12)
    expect(turnover.delta).toBeNull()
    // The row still has a scale, from the cohort alone, so its tick can be drawn.
    expect(turnover.scaleMax).toBe(20)
  })

  /**
   * Found by rendering the page, not by this suite. With the subject at 1.2 s and
   * the cohort at 1200 ms the row printed a cohort median of "1,200 s" — the
   * cohort's magnitude wearing the subject's unit — and a change of "−1,198.8".
   */
  it('computes no median and no change across benchmarks that disagree about the unit', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('responseTime', 1.2, 's')]),
      benchmark('a', [metric('responseTime', 1200, 'ms')]),
    ])

    expect(rows[0].unitsDiffer).toBe(true)
    expect(rows[0].cohortMedian).toBeNull()
    expect(rows[0].delta).toBeNull()
    // The subject's own reading is still its own, and still true.
    expect(rows[0].subject).toBe(1.2)
    expect(rows[0].unit).toBe('s')
  })

  it('takes the unit from the subject, and from the cohort only when the subject has none', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 74, 'points')]),
      benchmark('a', [metric('engagement', 70, 'points'), metric('turnover', 12, '%')]),
    ])

    expect(rows.find((row) => row.metricName === 'engagement')!.unit).toBe('points')
    expect(rows.find((row) => row.metricName === 'turnover')!.unit).toBe('%')
  })

  it('gives a row of negative values an empty track rather than an inverted one', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('drift', -4)]),
      benchmark('a', [metric('drift', -9)]),
    ])

    expect(rows[0].scaleMax).toBe(0)
    expect(trackFraction(rows[0].subject!, rows[0].scaleMax)).toBe(0)
  })

  it('has nothing to compare with fewer than two benchmarks', () => {
    expect(buildCohortRows([benchmark('subject', [metric('engagement', 74)])])).toEqual([])
    expect(buildCohortRows([])).toEqual([])
  })

  it('treats the first benchmark as the subject, not the largest or the last', () => {
    const rows = buildCohortRows([
      benchmark('subject', [metric('engagement', 40)]),
      benchmark('a', [metric('engagement', 90)]),
    ])

    expect(rows[0].subject).toBe(40)
    expect(rows[0].cohortMedian).toBe(90)
    expect(rows[0].delta).toBe(-50)
  })
})
