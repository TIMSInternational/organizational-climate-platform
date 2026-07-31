import { describe, it, expect, vi, afterEach } from 'vitest'
import { getHealth } from './health'

describe('getHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed health response on a 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ service: 'climate-project-api', status: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await getHealth('http://localhost:5080')

    expect(result).toEqual({ service: 'climate-project-api', status: 'ok' })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:5080/health')
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    )

    await expect(getHealth('http://localhost:5080')).rejects.toThrow('Health check failed: 503')
  })
})
