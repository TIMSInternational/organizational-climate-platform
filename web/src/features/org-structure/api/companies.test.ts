import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { listCompanies, createCompany, getCompany, updateCompany } from './companies'

const BASE_URL = 'http://localhost:5080'

describe('companies API client', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('lists companies', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ companies: [{ id: '1', name: 'Acme', emailDomain: 'acme.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await listCompanies(BASE_URL)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Acme')
    expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/admin/companies`, expect.objectContaining({
      headers: expect.any(Headers),
    }))
  })

  it('creates a company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '2', name: 'New Co', emailDomain: 'newco.test', industry: 'Tech', size: 'small', country: 'US', subscriptionTier: 'basic', createdAt: '2026-01-01T00:00:00Z', userCount: 0 }),
    }))

    const result = await createCompany(BASE_URL, { name: 'New Co', emailDomain: 'newco.test', industry: 'Tech', size: 'small', country: 'US' })

    expect(result.name).toBe('New Co')
  })

  it('gets a company by id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', name: 'Acme', emailDomain: 'acme.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z', userCount: 3 }),
    }))

    const result = await getCompany(BASE_URL, '1')

    expect(result.userCount).toBe(3)
  })

  it('updates a company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', name: 'Acme Renamed', emailDomain: 'acme.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z', userCount: 3 }),
    }))

    const result = await updateCompany(BASE_URL, '1', { name: 'Acme Renamed' })

    expect(result.name).toBe('Acme Renamed')
  })

  it('throws with the server message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'Domain already exists' }),
    }))

    await expect(createCompany(BASE_URL, { name: 'Dup', emailDomain: 'dup.test', industry: 'Tech', size: 'small', country: 'US' }))
      .rejects.toThrow('Domain already exists')
  })
})
