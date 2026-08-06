import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listReports, createReport, getReport, downloadReport } from './reports'

const baseUrl = 'http://api.test'

const row = {
  id: 'r1',
  title: 'Q3 climate summary',
  type: 'summary',
  companyId: 'c1',
  status: 'completed',
  format: 'pdf',
  createdAt: '2026-08-01T00:00:00Z',
}

const detail = {
  ...row,
  description: null,
  createdBy: 'u1',
  templateId: null,
  reportOutput: '"Report generation is stubbed -- no real rendering yet."',
  downloadCount: 0,
  generationStartedAt: '2026-08-01T00:00:00Z',
  generationCompletedAt: '2026-08-01T00:00:01Z',
}

describe('reports api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists reports for a company', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([row]), { status: 200 }))
    const result = await listReports(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports?companyId=c1`, expect.anything())
    expect(result).toEqual([row])
  })

  it('sends the bearer token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    await listReports(baseUrl, 'c1')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('creates a report', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await createReport(baseUrl, {
      title: 'Q3 climate summary',
      type: 'summary',
      companyId: 'c1',
      format: 'pdf',
    })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(detail)
  })

  it('gets a single report', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    const result = await getReport(baseUrl, 'r1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/reports/r1`, expect.anything())
    expect(result.reportOutput).toBe(detail.reportOutput)
  })

  it('registers a download and returns the incremented count', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...detail, downloadCount: 1 }), { status: 200 }),
    )
    const result = await downloadReport(baseUrl, 'r1')
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/reports/r1/download`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.downloadCount).toBe(1)
  })

  it('surfaces the backend message when a download is refused', async () => {
    // The backend returns 400 for a report that is not `completed`. authFetch turns a
    // non-2xx into a throw, so a page never sees a half-successful download.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Report is not ready for download' }), { status: 400 }),
    )
    await expect(downloadReport(baseUrl, 'r1')).rejects.toThrow('Report is not ready for download')
  })
})
