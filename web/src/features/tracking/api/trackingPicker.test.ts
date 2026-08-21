import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken, clearToken } from '../../../auth/token'
import { getNodoNames } from './trackingPicker'

const baseUrl = 'http://api.test'

beforeEach(() => {
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  clearToken()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('getNodoNames', () => {
  it('asks the MAIN api for the company nodo directory', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ nodos: [{ id: 'n1', name: 'Operaciones' }] }), { status: 200 }),
    )

    const names = await getNodoNames('co-1', baseUrl)

    // `/tracking/picker/nodos` lives on climate-project-api, not on the tracking
    // service — different origin, different base URL. See the module note.
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/tracking/picker/nodos?companyId=co-1`,
      expect.anything(),
    )
    expect(names.get('n1')).toBe('Operaciones')
  })

  it('escapes the company id rather than pasting it into the query', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ nodos: [] }), { status: 200 }))
    await getNodoNames('co 1&x=2', baseUrl)
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/tracking/picker/nodos?companyId=co%201%26x%3D2`,
      expect.anything(),
    )
  })

  it('defaults baseUrl to VITE_API_BASE_URL, with the optional parameter last', async () => {
    // The house rule, and the bug it exists for: a `baseUrl` placed BEFORE the
    // required arguments once broke five exports of trackingApi.ts.
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.env.test')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ nodos: [] }), { status: 200 }))

    await getNodoNames('co-1')

    expect(fetch).toHaveBeenCalledWith(
      'http://api.env.test/tracking/picker/nodos?companyId=co-1',
      expect.anything(),
    )
  })

  it('survives a response with no nodos array at all', async () => {
    // The lookup is decorative — every caller falls back to the raw external id —
    // so a shape it did not expect must not throw into a page render.
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }))
    expect((await getNodoNames('co-1', baseUrl)).size).toBe(0)
  })

  it('rejects when the caller may not read the directory, so the page can fall back', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(getNodoNames('co-1', baseUrl)).rejects.toThrow()
  })
})
