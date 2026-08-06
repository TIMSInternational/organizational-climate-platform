import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listAIInsights, getAIInsight, acknowledgeAIInsight } from './insights'

const baseUrl = 'http://api.test'

const row = {
  id: 'i1',
  companyId: 'c1',
  type: 'trend',
  category: 'engagement',
  title: 'Engagement is falling in Sales',
  priority: 'high',
  isAcknowledged: false,
}

const detail = {
  id: 'i1',
  surveyId: null,
  companyId: 'c1',
  departmentId: null,
  type: 'trend',
  category: 'engagement',
  title: 'Engagement is falling in Sales',
  description: 'Three consecutive periods of decline.',
  confidenceScore: 80,
  priority: 'high',
  affectedSegments: [],
  recommendedActions: [],
  isAcknowledged: false,
  acknowledgedBy: null,
  acknowledgedAt: null,
}

describe('AI insights api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists AI insights for a company', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([row]), { status: 200 }))
    const result = await listAIInsights(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/ai-insights?companyId=c1`, expect.anything())
    expect(result).toEqual([row])
  })

  it('returns an empty list rather than throwing when nothing has been generated yet', async () => {
    // #95's page has to degrade to an empty state until #92 generates anything, so an
    // empty array must stay an ordinary success, not a special case.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await expect(listAIInsights(baseUrl, 'c1')).resolves.toEqual([])
  })

  it('gets a single insight', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    const result = await getAIInsight(baseUrl, 'i1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/ai-insights/i1`, expect.anything())
    expect(result.confidenceScore).toBe(80)
  })

  it('acknowledges an insight and returns the attribution', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...detail,
          isAcknowledged: true,
          acknowledgedBy: 'u1',
          acknowledgedAt: '2026-08-05T10:00:00Z',
        }),
        { status: 200 },
      ),
    )
    const result = await acknowledgeAIInsight(baseUrl, 'i1')
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/ai-insights/i1/acknowledge`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.isAcknowledged).toBe(true)
    // #95 requires the dismissal to be visibly attributable -- who, and when.
    expect(result.acknowledgedBy).toBe('u1')
    expect(result.acknowledgedAt).toBe('2026-08-05T10:00:00Z')
  })

  it('surfaces the 404 the route currently returns everywhere', async () => {
    // MapAIInsightEndpoints is not registered in Program.cs yet (#86 is still open), so
    // every call here 404s today. authFetch turns that into a throw, which means #95's
    // page shows its error state rather than silently rendering an empty list as if the
    // company genuinely had no insights.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(listAIInsights(baseUrl, 'c1')).rejects.toThrow('Request failed: 404')
  })
})
