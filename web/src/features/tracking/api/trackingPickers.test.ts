import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getNodoNames, listNodoOptions, listPersonaOptions } from './trackingPickers'

/**
 * The pickers are on climate-project, not on climate-tracking, and their responses
 * are enveloped. Both are easy to get wrong in a way no type error would catch:
 * `body.nodos` typed as `NodoPickerItem[]` would compile and hand every caller
 * `undefined`.
 */
function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the tracking pickers', () => {
  it('unwraps the nodos envelope', () => {
    vi.mocked(fetch).mockReturnValue(ok({ nodos: [{ id: 'nodo-a', name: 'Operaciones' }] }))
    return expect(listNodoOptions('company-1', 'https://api.test')).resolves.toEqual([
      { id: 'nodo-a', name: 'Operaciones' },
    ])
  })

  it('unwraps the personas envelope', () => {
    vi.mocked(fetch).mockReturnValue(
      ok({ personas: [{ id: 'persona-1', name: 'Ana', email: 'ana@acme.test' }] }),
    )
    return expect(listPersonaOptions('company-1', 'https://api.test')).resolves.toEqual([
      { id: 'persona-1', name: 'Ana', email: 'ana@acme.test' },
    ])
  })

  it('hands back an empty list rather than undefined when the envelope is missing', () => {
    // The declared type says these arrays are always there; the server is what
    // actually decides. A page that spread `undefined` would crash on render.
    vi.mocked(fetch).mockReturnValue(ok({}))
    return expect(listNodoOptions('company-1', 'https://api.test')).resolves.toEqual([])
  })

  it('addresses climate-project /tracking/picker with the company as a query parameter', async () => {
    vi.mocked(fetch).mockReturnValue(ok({ nodos: [] }))
    await listNodoOptions('company 1/2', 'https://api.test')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://api.test/tracking/picker/nodos?companyId=company%201%2F2',
    )
  })

  it('takes the optional baseUrl LAST, after the required companyId', async () => {
    // The house rule, and the shape a prior bug in this repository broke by putting
    // `baseUrl` first — which silently made the first positional argument mean
    // something else for five exports at once.
    vi.mocked(fetch).mockReturnValue(ok({ personas: [] }))
    await listPersonaOptions('company-1', 'https://elsewhere.test')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('https://elsewhere.test/')
  })
})

/**
 * `getNodoNames` is the dashboards' shape of the same request. #125 and #126 each
 * built their own picker module against `/tracking/picker/nodos` — two spellings
 * of one request and two copies of `NodoPickerItem`. These are #125's assertions,
 * kept when the two were collapsed into this file, because they pin things the
 * plan-form callers never exercise.
 */
describe('getNodoNames', () => {
  it('asks the MAIN api for the company nodo directory, keyed by external id', async () => {
    vi.mocked(fetch).mockReturnValue(ok({ nodos: [{ id: 'n1', name: 'Operaciones' }] }))

    const names = await getNodoNames('co-1', 'https://api.test')

    // `/tracking/picker/nodos` lives on climate-project-api, not on the tracking
    // service — different origin, different base URL. See the module note.
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://api.test/tracking/picker/nodos?companyId=co-1',
    )
    expect(names.get('n1')).toBe('Operaciones')
  })

  it('escapes the company id rather than pasting it into the query', async () => {
    vi.mocked(fetch).mockReturnValue(ok({ nodos: [] }))
    await getNodoNames('co 1&x=2', 'https://api.test')
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'https://api.test/tracking/picker/nodos?companyId=co%201%26x%3D2',
    )
  })

  it('defaults baseUrl to VITE_API_BASE_URL, with the optional parameter last', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.env.test')
    vi.mocked(fetch).mockReturnValue(ok({ nodos: [] }))

    await getNodoNames('co-1')

    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      'http://api.env.test/tracking/picker/nodos?companyId=co-1',
    )
  })

  it('survives a response with no nodos array at all', async () => {
    // The lookup is decorative — every caller falls back to the raw external id —
    // so a shape it did not expect must not throw into a page render.
    vi.mocked(fetch).mockReturnValue(ok({}))
    expect((await getNodoNames('co-1', 'https://api.test')).size).toBe(0)
  })

  it('rejects when the caller may not read the directory, so the page can fall back', async () => {
    vi.mocked(fetch).mockReturnValue(Promise.resolve(new Response('{}', { status: 403 })))
    await expect(getNodoNames('co-1', 'https://api.test')).rejects.toThrow()
  })
})
