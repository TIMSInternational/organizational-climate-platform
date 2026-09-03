import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
  shareLinkUrl,
} from './reportShares'

const baseUrl = 'http://api.test'

const summary = {
  id: 's1',
  createdAt: '2026-09-01T00:00:00Z',
  expiresAt: '2026-10-01T00:00:00Z',
  revokedAt: null,
  accessCount: 4,
  lastAccessedAt: '2026-09-02T00:00:00Z',
  isActive: true,
}

describe('report shares api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('mints a link and returns the token, once', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 's1',
          token: 'a'.repeat(43),
          path: `/shared/reports/${'a'.repeat(43)}`,
          expiresAt: '2026-10-01T00:00:00Z',
        }),
        { status: 201 },
      ),
    )

    const result = await createReportShare(baseUrl, 'r1', { expiresInDays: 30 })

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/reports/r1/share`,
      expect.objectContaining({ method: 'POST' }),
    )
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(init?.body as string)).toEqual({ expiresInDays: 30 })
    expect(result.path).toBe(`/shared/reports/${'a'.repeat(43)}`)
  })

  it('omits the lifetime entirely when none is given, so the server default applies', async () => {
    // Sending `{ expiresInDays: null }` would be a different request: `ClampLifetimeDays`
    // treats null as the 30-day default, but a `0` or a `NaN` serialised into the body would
    // be clamped to 1 -- a link that dies tomorrow.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 }))
    await createReportShare(baseUrl, 'r1')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(init?.body as string)).toEqual({})
  })

  it('sends the bearer token on every one of the three routes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await createReportShare(baseUrl, 'r1')
    await listReportShares(baseUrl, 'r1')
    await revokeReportShare(baseUrl, 'r1', 's1')

    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer test-token')
    }
  })

  it('lists shares without a token or a hash', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([summary]), { status: 200 }))
    const result = await listReportShares(baseUrl, 'r1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports/r1/shares`, expect.anything())
    expect(result).toEqual([summary])
    expect('token' in result[0]).toBe(false)
  })

  it('revokes by DELETE, scoped to the report in the path', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await revokeReportShare(baseUrl, 'r1', 's1')
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/reports/r1/shares/s1`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('builds the absolute URL from the origin the viewer is on', () => {
    // The server returns only the path, because it does not know which of its front ends is
    // asking (`ReportShareDtos.cs`).
    expect(shareLinkUrl('https://climate.timsint.com', '/shared/reports/abc')).toBe(
      'https://climate.timsint.com/shared/reports/abc',
    )
  })

  it('surfaces the backend message when a mint is refused', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Report not found' }), { status: 404 }),
    )
    await expect(createReportShare(baseUrl, 'r1')).rejects.toThrow('Report not found')
  })
})
