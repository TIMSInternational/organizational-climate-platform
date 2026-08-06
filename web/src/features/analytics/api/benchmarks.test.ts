import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  listBenchmarks,
  createBenchmark,
  getBenchmark,
  updateBenchmark,
  addBenchmarkMetric,
} from './benchmarks'

const baseUrl = 'http://api.test'

const globalRow = {
  id: 'b1',
  name: 'Industry median',
  type: 'industry',
  category: 'engagement',
  companyId: null,
  isActive: true,
  qualityScore: 0,
}

const companyRow = { ...globalRow, id: 'b2', name: 'Acme 2025', companyId: 'c1' }

const detail = {
  id: 'b1',
  name: 'Industry median',
  description: 'Sector-wide median',
  type: 'industry',
  category: 'engagement',
  source: 'survey',
  industry: null,
  companySize: null,
  region: null,
  companyId: null,
  isActive: true,
  validationStatus: 'pending',
  qualityScore: 0,
  priorPeriodBenchmarkId: null,
  metrics: [],
}

describe('benchmarks api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists benchmarks without a filter', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listBenchmarks(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks`, expect.anything())
  })

  it('appends the optional companyId filter when given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listBenchmarks(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks?companyId=c1`, expect.anything())
  })

  it('keeps a null companyId distinguishable from a company-scoped one', async () => {
    // A global benchmark (companyId === null) is readable by every tenant but writable
    // only by a SuperAdmin. If this collapsed to `undefined` or to an empty string, a page
    // could not tell "global" from "mine" and would offer an edit button that 403s.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([globalRow, companyRow]), { status: 200 }),
    )
    const result = await listBenchmarks(baseUrl)
    expect(result[0].companyId).toBeNull()
    expect(result[1].companyId).toBe('c1')
  })

  it('creates a global benchmark when companyId is explicitly null', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await createBenchmark(baseUrl, {
      name: 'Industry median',
      description: 'Sector-wide median',
      type: 'industry',
      category: 'engagement',
      source: 'survey',
      companyId: null,
    })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks`, expect.objectContaining({ method: 'POST' }))
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(init!.body as string).companyId).toBeNull()
    expect(result.companyId).toBeNull()
  })

  it('gets a benchmark with its metrics', async () => {
    const metric = { id: 'm1', metricName: 'eNPS', value: 42, unit: 'score', percentile: null, sampleSize: null }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...detail, metrics: [metric] }), { status: 200 }),
    )
    const result = await getBenchmark(baseUrl, 'b1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/b1`, expect.anything())
    expect(result.metrics).toEqual([metric])
  })

  it('updates a benchmark', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...detail, name: 'Renamed' }), { status: 200 }),
    )
    const result = await updateBenchmark(baseUrl, 'b1', { name: 'Renamed', description: 'Sector-wide median' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/b1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.name).toBe('Renamed')
  })

  it('adds a metric and returns the whole benchmark', async () => {
    const metric = { id: 'm1', metricName: 'eNPS', value: 42, unit: 'score', percentile: 75, sampleSize: 120 }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...detail, metrics: [metric] }), { status: 201 }),
    )
    const result = await addBenchmarkMetric(baseUrl, 'b1', {
      metricName: 'eNPS',
      value: 42,
      unit: 'score',
      percentile: 75,
      sampleSize: 120,
    })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/benchmarks/b1/metrics`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.metrics).toHaveLength(1)
  })

  it('surfaces the backend message when a write is rejected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Name, Description, Type, Category, and Source are required' }), {
        status: 400,
      }),
    )
    await expect(
      createBenchmark(baseUrl, {
        name: '',
        description: 'd',
        type: 't',
        category: 'c',
        source: 's',
        companyId: 'c1',
      }),
    ).rejects.toThrow('Name, Description, Type, Category, and Source are required')
  })
})
