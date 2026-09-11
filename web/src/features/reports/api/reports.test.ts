import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  listReports,
  createReport,
  getReport,
  downloadReport,
  reportFileName,
  REPORT_FORMATS,
} from './reports'

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
  reportOutput: '{"generationNote":"","surveys":[],"aiInsights":[],"benchmarks":[]}',
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

  it('asks for the titles in the reader\'s language when given a locale', async () => {
    // The list and the share dialog that repeats its title printed the English half of
    // every bilingual title on a Spanish screen; the API resolved `lang` all along.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([row]), { status: 200 }))
    await listReports(baseUrl, 'c1', 'es')
    const [listUrl] = vi.mocked(fetch).mock.calls[0]
    expect(new URL(String(listUrl), 'http://test.local').searchParams.get('lang')).toBe('es')
    expect(new URL(String(listUrl), 'http://test.local').searchParams.get('companyId')).toBe('c1')

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    await getReport(baseUrl, 'r1', 'es')
    const [detailUrl] = vi.mocked(fetch).mock.calls[1]
    expect(new URL(String(detailUrl), 'http://test.local').pathname).toBe('/admin/reports/r1')
    expect(new URL(String(detailUrl), 'http://test.local').searchParams.get('lang')).toBe('es')
  })

  it('downloads the rendered file as a blob, by POST', async () => {
    // A POST, not a GET: the endpoint increments `download_count`, which is the record
    // answering "who exported this data" (#143). And a blob, not JSON -- the response body
    // is the document now.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { status: 200 }),
    )
    const result = await downloadReport(baseUrl, 'r1')
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/reports/r1/download`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(await result.text()).toBe('%PDF-1.4')
  })

  it('asks for the document in the reader\'s language when given a locale', async () => {
    // `DownloadAsync` heads the PDF/CSV for `lang` (ReportEndpoints.cs), as the survey export
    // does. Without it a Spanish reader's copy of a bilingual report opened under an English
    // heading.
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { status: 200 }),
    )
    await downloadReport(baseUrl, 'r1', 'es')
    const [input, init] = vi.mocked(fetch).mock.calls[0]
    const url = new URL(String(input), 'http://test.local')
    expect(url.pathname).toBe('/admin/reports/r1/download')
    expect(url.searchParams.get('lang')).toBe('es')
    expect(init).toEqual(expect.objectContaining({ method: 'POST' }))
  })

  it('names the file from the id and the row format', () => {
    // Not from `Content-Disposition`: it is not a CORS-safelisted response header and the
    // API does not expose it, so the browser reads `null` there in the deployed app.
    expect(reportFileName('r1', 'pdf')).toBe('report-r1.pdf')
    expect(reportFileName('r1', 'csv')).toBe('report-r1.csv')
    // A legacy row saying `excel` renders as a PDF server-side, so the name has to agree.
    expect(reportFileName('r1', 'excel')).toBe('report-r1.pdf')
  })

  it('offers exactly the formats the server will render', () => {
    // Mirrors `ReportFormats.Supported` (C#). `excel` was offered here for a year and never
    // produced a spreadsheet; `CreateAsync` now answers 400 for it.
    expect(REPORT_FORMATS).toEqual(['pdf', 'csv'])
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
