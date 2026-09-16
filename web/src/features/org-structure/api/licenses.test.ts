import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { listServiceLicenses, grantServiceLicense, suspendServiceLicense, reactivateServiceLicense } from './licenses'

const BASE_URL = 'http://localhost:5080'
const COMPANY = '11111111-1111-1111-1111-111111111111'

function view(overrides: Record<string, unknown> = {}) {
  return {
    serviceType: 'general_climate',
    seatsTotal: 100,
    seatsUsed: 3,
    status: 'active',
    licensed: true,
    notes: null,
    updatedAt: '2026-09-16T00:00:00Z',
    ...overrides,
  }
}

describe('service licences API client', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('lists a company licences', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ services: [view(), view({ serviceType: 'microclimate', licensed: false, seatsTotal: 0, seatsUsed: 0 })] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await listServiceLicenses(BASE_URL, COMPANY)

    expect(result).toHaveLength(2)
    expect(result[0].serviceType).toBe('general_climate')
    expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/admin/companies/${COMPANY}/licenses`, expect.objectContaining({
      headers: expect.any(Headers),
    }))
  })

  it('grants a licence with a PUT carrying seatsTotal', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(view({ seatsTotal: 250 })) })
    vi.stubGlobal('fetch', mockFetch)

    const result = await grantServiceLicense(BASE_URL, COMPANY, 'general_climate', { seatsTotal: 250, notes: 'PO-1' })

    expect(result.seatsTotal).toBe(250)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/admin/companies/${COMPANY}/licenses/general_climate`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ seatsTotal: 250, notes: 'PO-1' })
  })

  it('suspends and reactivates via POST', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(view({ status: 'suspended' })) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(view({ status: 'active' })) })
    vi.stubGlobal('fetch', mockFetch)

    const suspended = await suspendServiceLicense(BASE_URL, COMPANY, 'general_climate')
    expect(suspended.status).toBe('suspended')
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE_URL}/admin/companies/${COMPANY}/licenses/general_climate/suspend`)
    expect(mockFetch.mock.calls[0][1].method).toBe('POST')

    const reactivated = await reactivateServiceLicense(BASE_URL, COMPANY, 'general_climate')
    expect(reactivated.status).toBe('active')
    expect(mockFetch.mock.calls[1][0]).toBe(`${BASE_URL}/admin/companies/${COMPANY}/licenses/general_climate/reactivate`)
  })
})
