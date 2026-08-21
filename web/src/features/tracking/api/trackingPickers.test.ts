import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listNodoOptions, listPersonaOptions } from './trackingPickers'

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
