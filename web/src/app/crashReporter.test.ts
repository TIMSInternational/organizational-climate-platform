import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installCrashReporting,
  MAX_REPORTS_PER_PAGE_LOAD,
  reportCrash,
  routePatternFor,
  scrub,
  UNMATCHED_ROUTE,
} from './crashReporter'
import { router } from './router'

const ROUTES = [
  { path: '/s/:token', element: null },
  { path: '/surveys/:id/results', element: null },
  { path: '/admin', element: null, children: [{ path: 'companies/:companyId', element: null }] },
]

const fetchMock = vi.fn<typeof fetch>()
let uninstall: () => void = () => undefined

function install(baseUrl: string | undefined = 'https://api.example.test/') {
  uninstall = installCrashReporting({ baseUrl, resolveRoute: (pathname) => routePatternFor(ROUTES, pathname) })
}

function sentBodies(): Record<string, string>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, string>)
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  uninstall()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('routePatternFor', () => {
  it('names the pattern with its placeholders, never the values', () => {
    expect(routePatternFor(ROUTES, '/s/SECRET-TOKEN-123')).toBe('/s/:token')
    expect(routePatternFor(ROUTES, '/surveys/sv-42/results')).toBe('/surveys/:id/results')
    expect(routePatternFor(ROUTES, '/admin/companies/co-7')).toBe('/admin/companies/:companyId')
    expect(routePatternFor(ROUTES, '/nowhere/at-all')).toBe(UNMATCHED_ROUTE)
  })

  it('resolves against the app router itself', () => {
    expect(routePatternFor(router.routes, '/s/SECRET-TOKEN-123')).toBe('/s/:token')
  })
})

describe('reportCrash', () => {
  it('sends the route pattern and never the pathname', () => {
    install()
    reportCrash(new Error('boom'), '/s/SECRET-TOKEN-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/client-errors')
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' })
    expect(new Headers(init?.headers).get('Authorization')).toBeNull()
    expect(sentBodies()[0].route).toBe('/s/:token')
    expect(String(init?.body)).not.toContain('SECRET-TOKEN-123')
  })

  it('reports an uncaught error and an unhandled rejection with the current route pattern', () => {
    install()
    window.history.replaceState({}, '', '/surveys/sv-SECRET/results?companyId=SECRETQ')

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught'), message: 'uncaught' }))
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('rejected') })
    window.dispatchEvent(rejection)

    expect(sentBodies().map((body) => body.route)).toEqual(['/surveys/:id/results', '/surveys/:id/results'])
    for (const [, init] of fetchMock.mock.calls) {
      expect(String(init?.body)).not.toContain('SECRET')
    }
  })

  it(`sends at most ${MAX_REPORTS_PER_PAGE_LOAD} reports per page load, and each distinct error once`, () => {
    install()
    const repeated = new Error('same')
    reportCrash(repeated, '/s/a')
    reportCrash(repeated, '/s/b')
    for (let i = 0; i < 20; i += 1) reportCrash(new Error(`distinct ${i}`), '/s/a')

    expect(fetchMock).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE_LOAD)
    expect(sentBodies().filter((body) => body.message.endsWith(': same'))).toHaveLength(1)
  })

  it('swallows a failing send, a throwing fetch and a missing fetch', async () => {
    install()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(() => reportCrash(new Error('one'), '/s/a')).not.toThrow()

    fetchMock.mockImplementationOnce(() => {
      throw new Error('fetch itself threw')
    })
    expect(() => reportCrash(new Error('two'), '/s/a')).not.toThrow()

    vi.stubGlobal('fetch', undefined)
    expect(() => reportCrash(new Error('three'), '/s/a')).not.toThrow()
    // The rejected send settles without surfacing as an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('never serialises a rejected object, which can be the payload a request was sending', () => {
    install()
    reportCrash({ answers: [{ text: 'mi jefe es injusto' }], email: 'ana@example.com' }, '/s/a')

    expect(sentBodies()[0].message).toBe('non-error object')
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('injusto')
  })

  it('sends nothing without an API base URL, and nothing before it is installed', () => {
    reportCrash(new Error('before install'), '/s/a')
    install('')
    reportCrash(new Error('no base url'), '/s/a')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not report a thrown 404 response, which is the router saying "not here"', () => {
    install()
    reportCrash({ status: 404, statusText: 'Not Found', internal: true, data: '' }, '/s/a')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('scrub', () => {
  it('drops query strings and fragments but keeps a frame position', () => {
    expect(scrub('at x (https://web.test/assets/app.js?v=SECRET:12:345)')).toBe('at x (https://web.test/assets/app.js:12:345)')
    expect(scrub('Failed https://api.test/x?token=SECRET#access_token=ALSO done')).toBe('Failed https://api.test/x done')
  })

  it('replaces emails and token-shaped runs, and keeps chunk names and long identifiers', () => {
    const scrubbed = scrub(
      'ana@example.com eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 SurveyResultsNextPage-CkA1b2c3 useSurveyResultsQueryWithFilters',
    )
    expect(scrubbed).toBe('[email] [redacted] SurveyResultsNextPage-CkA1b2c3 useSurveyResultsQueryWithFilters')
  })
})
