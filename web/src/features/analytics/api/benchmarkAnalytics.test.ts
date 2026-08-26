import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  compareBenchmarks,
  getBenchmarkTrend,
  getIndustryBenchmarks,
  listBenchmarkCategories,
  validateBenchmark,
  importBenchmarks,
} from './benchmarkAnalytics'

const baseUrl = 'http://api.test'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('benchmark analytics api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  /**
   * The ids go over as ONE comma-separated parameter, because that is what the server parses.
   * Sending them as a repeated `ids=` parameter — the other obvious encoding — would reach
   * `CompareAsync` as the single string `"a"` and come back as a 400 saying two ids are
   * needed, which reads on a page as "comparison is broken" rather than as a client bug.
   */
  it('sends every id in one comma-separated parameter, with the named baseline', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ baseline: {}, baselineMetrics: [], comparisons: [] }))

    await compareBenchmarks(baseUrl, ['a', 'b', 'c'], 'c')

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/benchmarks/compare?ids=a%2Cb%2Cc&baselineId=c`,
      expect.anything(),
    )
  })

  it('omits baselineId when the caller does not name one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ baseline: {}, baselineMetrics: [], comparisons: [] }))

    await compareBenchmarks(baseUrl, ['a', 'b'])

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/compare?ids=a%2Cb`, expect.anything())
  })

  it('reads a trend by benchmark id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ periods: [], series: [], stopReason: 'none' }))

    const trend = await getBenchmarkTrend(baseUrl, 'b1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/b1/trends`, expect.anything())
    expect(trend.stopReason).toBe('none')
  })

  /**
   * An absent filter is left off the query string entirely.
   *
   * The two ways to get this wrong both look like an empty sector rather than like a bug:
   * `?industry=undefined` filters on the literal word "undefined", and `?industry=` is read by
   * the server's `Blank` guard — so it is harmless there, but a form that cleared a field and
   * a caller that never set one must not produce different URLs.
   */
  it('leaves absent industry filters off the query string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ filters: {}, benchmarkCount: 0, subject: null, metrics: [] }))

    await getIndustryBenchmarks(baseUrl, { benchmarkId: 'b1', companySize: '' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/industry?benchmarkId=b1`, expect.anything())
  })

  it('asks for the whole sector when given no filters at all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ filters: {}, benchmarkCount: 0, subject: null, metrics: [] }))

    await getIndustryBenchmarks(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/industry`, expect.anything())
  })

  it('lists categories', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok([]))

    await listBenchmarkCategories(baseUrl)

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/benchmarks/categories`, expect.anything())
  })

  it('validates with a POST, because validating writes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ benchmarkId: 'b1', status: 'verified', qualityScore: 76.7 }))

    await validateBenchmark(baseUrl, 'b1')

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/benchmarks/b1/validate`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  /**
   * `validateOnly` is sent explicitly as `false` rather than omitted. The server defaults it
   * to false either way, but an import is the one request here that writes, and a body that
   * silently omits the flag deciding whether it writes is a body nobody can read back and be
   * sure about.
   */
  it('sends validateOnly explicitly on an import', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ applied: true, benchmarks: 1, metrics: 0, created: [] }))

    await importBenchmarks(baseUrl, [
      {
        name: 'Sector 2026',
        description: 'vendor row',
        type: 'industry',
        category: 'engagement',
        source: 'vendor file',
        companyId: null,
      },
    ])

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.validateOnly).toBe(false)
    expect(body.benchmarks).toHaveLength(1)
    expect(body.benchmarks[0].companyId).toBeNull()
  })

  it('passes validateOnly through when the caller is only checking a file', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ applied: false, benchmarks: 1, metrics: 0, created: [] }))

    await importBenchmarks(
      baseUrl,
      [
        {
          name: 'Sector 2026',
          description: 'vendor row',
          type: 'industry',
          category: 'engagement',
          source: 'vendor file',
          companyId: null,
        },
      ],
      { validateOnly: true },
    )

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.validateOnly).toBe(true)
  })
})
