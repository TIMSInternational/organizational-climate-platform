import { describe, it, expect, vi } from 'vitest'
import { buildComparison, buildTrend, followPriorPeriodChain } from './benchmarkAnalysis'
import type { Benchmark, BenchmarkMetric } from './api/benchmarks'

function metric(name: string, value: number, unit = '%', percentile: number | null = null): BenchmarkMetric {
  return { id: `${name}-${value}`, metricName: name, value, unit, percentile, sampleSize: null }
}

function benchmark(id: string, metrics: BenchmarkMetric[], priorPeriodBenchmarkId: string | null = null): Benchmark {
  return {
    id,
    name: `Benchmark ${id}`,
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
    qualityScore: 1,
    priorPeriodBenchmarkId,
    metrics,
    priorPeriodStatus: priorPeriodBenchmarkId === null ? 'unlinked' : 'linked',
    priorPeriod: null,
  }
}

describe('buildComparison', () => {
  it('lines metrics up by name and marks a benchmark that lacks one', () => {
    const rows = buildComparison([
      benchmark('a', [metric('engagement', 70), metric('retention', 90)]),
      benchmark('b', [metric('engagement', 65)]),
    ])

    expect(rows.map((row) => row.metricName)).toEqual(['engagement', 'retention'])
    expect(rows[0].cells.map((cell) => cell.value)).toEqual([70, 65])
    // Not 0 -- an absent metric and a metric measured at zero are different facts,
    // and averaging the second into a comparison as the first is the whole risk.
    expect(rows[1].cells.map((cell) => cell.value)).toEqual([90, null])
  })

  it('keeps the first benchmark\'s metric order rather than sorting', () => {
    const rows = buildComparison([
      benchmark('a', [metric('zeta', 1), metric('alpha', 2)]),
      benchmark('b', [metric('alpha', 3)]),
    ])
    expect(rows.map((row) => row.metricName)).toEqual(['zeta', 'alpha'])
  })

  it('flags a metric whose units disagree across the selected benchmarks', () => {
    const rows = buildComparison([
      benchmark('a', [metric('responseTime', 1.2, 's')]),
      benchmark('b', [metric('responseTime', 1200, 'ms')]),
    ])
    expect(rows[0].unitsDiffer).toBe(true)
  })

  it('does not flag a metric that only one benchmark records', () => {
    const rows = buildComparison([
      benchmark('a', [metric('responseTime', 1.2, 's')]),
      benchmark('b', []),
    ])
    expect(rows[0].unitsDiffer).toBe(false)
  })
})

describe('buildTrend', () => {
  it('returns periods oldest first and deltas against the previous period', () => {
    // Chain arrives newest first, the order followPriorPeriodChain produces.
    const series = buildTrend([
      benchmark('q3', [metric('engagement', 74)]),
      benchmark('q2', [metric('engagement', 70)]),
      benchmark('q1', [metric('engagement', 80)]),
    ])

    expect(series).toHaveLength(1)
    expect(series[0].points.map((point) => point.benchmarkId)).toEqual(['q1', 'q2', 'q3'])
    expect(series[0].points.map((point) => point.delta)).toEqual([null, -10, 4])
  })

  it('reports the change as a fraction of the previous value', () => {
    const series = buildTrend([benchmark('b', [metric('engagement', 60)]), benchmark('a', [metric('engagement', 50)])])
    expect(series[0].points[1].changeRatio).toBeCloseTo(0.2)
  })

  it('does not divide by a previous value of zero', () => {
    const series = buildTrend([benchmark('b', [metric('engagement', 5)]), benchmark('a', [metric('engagement', 0)])])
    expect(series[0].points[1].delta).toBe(5)
    expect(series[0].points[1].changeRatio).toBeNull()
  })

  it('leaves a gap null rather than spanning two periods as one change', () => {
    const series = buildTrend([
      benchmark('q3', [metric('engagement', 90)]),
      benchmark('q2', []),
      benchmark('q1', [metric('engagement', 50)]),
    ])
    // q2 has no value, so q3's delta cannot honestly be "+40 since last period".
    expect(series[0].points.map((point) => point.delta)).toEqual([null, null, null])
  })
})

describe('followPriorPeriodChain', () => {
  it('walks back through prior periods, newest first', async () => {
    const rows: Record<string, Benchmark> = {
      q2: benchmark('q2', [], 'q1'),
      q1: benchmark('q1', [], null),
    }
    const head = benchmark('q3', [], 'q2')
    const chain = await followPriorPeriodChain(head, (id) => Promise.resolve(rows[id]))
    expect(chain.map((entry) => entry.id)).toEqual(['q3', 'q2', 'q1'])
  })

  it('stops at a cycle instead of looping forever', async () => {
    const head = benchmark('a', [], 'b')
    const rows: Record<string, Benchmark> = { b: benchmark('b', [], 'a') }
    const chain = await followPriorPeriodChain(head, (id) => Promise.resolve(rows[id]))
    expect(chain.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('ends the chain when a prior period cannot be read, rather than failing', async () => {
    const head = benchmark('a', [], 'forbidden')
    const load = vi.fn().mockRejectedValue(new Error('Forbidden'))
    const chain = await followPriorPeriodChain(head, load)
    expect(chain.map((entry) => entry.id)).toEqual(['a'])
  })

  it('respects the period cap on a long chain', async () => {
    const load = (id: string) => Promise.resolve(benchmark(id, [], `${Number(id) + 1}`))
    const chain = await followPriorPeriodChain(benchmark('0', [], '1'), load, 3)
    expect(chain).toHaveLength(3)
  })
})
