import { describe, it, expect, beforeEach, vi } from 'vitest'
import { authFetch } from '../../../api/authFetch'
import { allResponsesFileName, getAllResponsesWorkbook } from './responseExport'

vi.mock('../../../api/authFetch', () => ({ authFetch: vi.fn() }))

const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function reply(body: string, type: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': type } })
}

describe('the response workbook download', () => {
  beforeEach(() => vi.mocked(authFetch).mockReset())

  it('asks the API origin, not a relative path', async () => {
    // A fresh Response per call: a Response body can only be read once.
    vi.mocked(authFetch).mockImplementation(() => Promise.resolve(reply('xlsx', WORKBOOK)))

    await getAllResponsesWorkbook('https://api.example.test')
    await getAllResponsesWorkbook('https://api.example.test', 's1')

    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe('https://api.example.test/admin/exports/responses')
    expect(vi.mocked(authFetch).mock.calls[1][0]).toBe('https://api.example.test/admin/exports/responses?surveyId=s1')
  })

  /**
   * The defect this file exists for. A relative path resolves against the WEB origin, where
   * the SPA host answers every unknown path with `index.html` and a **200** — so `response.ok`
   * is true, the download "succeeds", and the reader opens a kilobyte of HTML named .xlsx.
   * Status is not enough; the content type is the check.
   */
  it('refuses an app-shell answer even though it is a 200', async () => {
    vi.mocked(authFetch).mockResolvedValue(reply('<!doctype html><title>OCC</title>', 'text/html; charset=utf-8'))

    await expect(getAllResponsesWorkbook('')).rejects.toThrow('surveys.next.super.exportFailed')
  })

  it('refuses a rejected request', async () => {
    vi.mocked(authFetch).mockResolvedValue(reply('nope', WORKBOOK, 403))

    await expect(getAllResponsesWorkbook('https://api.example.test')).rejects.toThrow('surveys.next.super.exportFailed')
  })

  it('names the file for the climate and the day, so two pulls are tellable apart', () => {
    const day = new Date('2026-10-16T04:00:00Z')

    expect(allResponsesFileName(day)).toBe('respuestas-clima-2026-10-16.xlsx')
    expect(allResponsesFileName(day, 'Ensayo clima IDENTIFICADO octubre 2026'))
      .toBe('respuestas-ensayo-clima-identificado-octubre-2026-2026-10-16.xlsx')
  })
})
