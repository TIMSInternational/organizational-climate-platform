import { describe, it, expect, beforeEach, vi } from 'vitest'
import { authFetch } from '../../../api/authFetch'
import { getCompanyStatusWorkbook, getDeliveryAuditWorkbook } from './statusExport'

vi.mock('../../../api/authFetch', () => ({ authFetch: vi.fn() }))

const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function reply(body: string, type: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': type } })
}

describe('the per-company workbooks', () => {
  beforeEach(() => vi.mocked(authFetch).mockReset())

  it('asks for the status file and the delivery audit at their own routes', async () => {
    vi.mocked(authFetch).mockImplementation(() => Promise.resolve(reply('xlsx', WORKBOOK)))

    await getCompanyStatusWorkbook('https://api.example.test', 'c 1')
    await getDeliveryAuditWorkbook('https://api.example.test', 'c 1')

    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe('https://api.example.test/admin/companies/c%201/participation/export')
    expect(vi.mocked(authFetch).mock.calls[1][0]).toBe('https://api.example.test/admin/companies/c%201/delivery-audit')
  })

  it('repeats ?survey= once per picked sheet, and url-encodes each id', async () => {
    vi.mocked(authFetch).mockImplementation(() => Promise.resolve(reply('xlsx', WORKBOOK)))

    await getCompanyStatusWorkbook('https://api.example.test', 'c1', ['a 1', 'b2'])

    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe(
      'https://api.example.test/admin/companies/c1/participation/export?survey=a%201&survey=b2',
    )
  })

  /**
   * An empty list is "all of them" and must send no query at all: that is the request the route
   * answered before a picker existed, and it lets the server include a survey distributed since
   * the page was loaded instead of refusing an id the caller could not have known about.
   */
  it('sends no query for an empty pick, exactly as it did before the picker', async () => {
    vi.mocked(authFetch).mockImplementation(() => Promise.resolve(reply('xlsx', WORKBOOK)))

    await getCompanyStatusWorkbook('https://api.example.test', 'c1', [])

    expect(vi.mocked(authFetch).mock.calls[0][0]).toBe(
      'https://api.example.test/admin/companies/c1/participation/export',
    )
  })

  /** A refusal used to be saved under an .xlsx name, which a reader opens as a corrupt file. */
  it('refuses a refused request', async () => {
    vi.mocked(authFetch).mockResolvedValue(reply('{"message":"forbidden"}', 'application/json', 403))

    await expect(getDeliveryAuditWorkbook('https://api.example.test', 'c1')).rejects.toThrow()
  })

  it('refuses the app shell even though it is a 200', async () => {
    vi.mocked(authFetch).mockResolvedValue(reply('<!doctype html>', 'text/html; charset=utf-8'))

    await expect(getCompanyStatusWorkbook('', 'c1')).rejects.toThrow()
  })
})
