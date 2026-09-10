import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { search } from './search'

const baseUrl = 'http://api.test'
const empty = { query: 'clima', groups: [], totalCount: 0 }

describe('search api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('sends the query and the per-type limit, and nothing else when no locale is given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(empty), { status: 200 }))
    await search(baseUrl, 'clima', { limit: 5 })
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://test.local')
    expect(url.pathname).toBe('/search')
    expect(url.searchParams.get('q')).toBe('clima')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('lang')).toBeNull()
  })

  it('asks for the hits in the reader\'s language when given a locale', async () => {
    // `SearchEndpoints.ToItem` resolves title and subtitle for `lang`; without it the
    // palette listed the English half of every bilingual hit on a Spanish screen.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(empty), { status: 200 }))
    await search(baseUrl, 'clima', { lang: 'es' })
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://test.local')
    expect(url.searchParams.get('q')).toBe('clima')
    expect(url.searchParams.get('lang')).toBe('es')
  })
})
