import { describe, it, expect } from 'vitest'
import { averageQualityByCategory, QUALITY_SERIES_KEY } from './benchmarkQuality'
import type { BenchmarkListItem } from '../api/benchmarks'

function benchmark(overrides: Partial<BenchmarkListItem> & { id: string }): BenchmarkListItem {
  return {
    name: overrides.id,
    type: 'industry',
    category: 'engagement',
    companyId: 'c1',
    isActive: true,
    qualityScore: 0,
    priorPeriodStatus: 'unlinked',
    ...overrides,
  }
}

describe('averageQualityByCategory', () => {
  it('averages rather than sums, so a crowded category does not look better than a good one', () => {
    const rows = averageQualityByCategory([
      benchmark({ id: 'a', category: 'engagement', qualityScore: 40 }),
      benchmark({ id: 'b', category: 'engagement', qualityScore: 60 }),
      benchmark({ id: 'c', category: 'wellbeing', qualityScore: 90 }),
    ])

    expect(rows).toEqual([
      { label: 'engagement', values: { [QUALITY_SERIES_KEY]: 50 } },
      { label: 'wellbeing', values: { [QUALITY_SERIES_KEY]: 90 } },
    ])
  })

  it('orders categories alphabetically, so the bars do not reshuffle between loads', () => {
    // The list endpoint orders by benchmark NAME, not category, so grouping in
    // arrival order would repaint the axis whenever a benchmark is renamed.
    const rows = averageQualityByCategory([
      benchmark({ id: 'a', category: 'wellbeing', qualityScore: 1 }),
      benchmark({ id: 'b', category: 'engagement', qualityScore: 1 }),
      benchmark({ id: 'c', category: 'leadership', qualityScore: 1 }),
    ])

    expect(rows.map((row) => row.label)).toEqual(['engagement', 'leadership', 'wellbeing'])
  })

  it('keeps an all-zero category as a measured zero, not as a gap', () => {
    // `ChartDatum` reserves `null` for "not measured" and BarChart renders it as a
    // missing bar. A benchmark whose quality really is 0 has been measured.
    const rows = averageQualityByCategory([
      benchmark({ id: 'a', category: 'engagement', qualityScore: 0 }),
    ])

    expect(rows[0].values[QUALITY_SERIES_KEY]).toBe(0)
    expect(rows[0].values[QUALITY_SERIES_KEY]).not.toBeNull()
  })

  it('is empty for no benchmarks, so the chart shows its own empty state', () => {
    expect(averageQualityByCategory([])).toEqual([])
  })
})
