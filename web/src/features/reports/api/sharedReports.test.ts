import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSharedReport, SharedReportUnavailableError } from './sharedReports'
import { setToken } from '../../../auth/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const DOCUMENT = JSON.stringify({
  generationNote: '',
  surveys: [],
  aiInsights: [],
})

/**
 * Everything about a rejection that a caller could branch on.
 *
 * `stack` is excluded because it names the line that threw, which differs between two
 * `throw` sites in the same file and is not something a client can read a status out of.
 * Everything else is fair game: a `status` field, a `reason`, a message copied off the
 * response body, or an enumerable own property would all show up here.
 */
function fingerprint(error: unknown): Record<string, unknown> {
  const value = error as Error
  return {
    constructor: value.constructor.name,
    name: value.name,
    message: value.message,
    own: Object.getOwnPropertyNames(value)
      .filter((key) => key !== 'stack')
      .sort(),
    enumerable: JSON.stringify({ ...value }),
  }
}

async function rejectionFor(response: Response | Error): Promise<unknown> {
  vi.mocked(fetch).mockImplementationOnce(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  )
  try {
    await getSharedReport('http://api.test', 'tok')
    throw new Error('expected getSharedReport to reject')
  } catch (error) {
    return error
  }
}

describe('getSharedReport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('reads the legacy share path, with the token escaped', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ title: 'Q3', reportOutput: DOCUMENT }))

    await getSharedReport('http://api.test', 'a/../b')

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://api.test/shared/reports/a%2F..%2Fb')
  })

  it('sends the locale when one is asked for, and no query when it is not', async () => {
    // A fresh `Response` per call: a body can only be read once, so reusing one object
    // across two calls fails the second with a consumed stream rather than a real result.
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(jsonResponse({ title: 'Q3', reportOutput: DOCUMENT })),
    )

    await getSharedReport('http://api.test', 'tok', { lang: 'es' })
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://api.test/shared/reports/tok?lang=es')

    await getSharedReport('http://api.test', 'tok')
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('http://api.test/shared/reports/tok')
  })

  /**
   * The token in the path is the credential; a bearer would be a second one, sent to a
   * route that cannot read it. This is asserted with a token actually in storage,
   * because that is the case that would fail: an administrator opening a share link in
   * the browser they administer in.
   */
  it('sends no Authorization header even when a session exists', async () => {
    setToken('admin-session-token')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ title: 'Q3', reportOutput: DOCUMENT }))

    await getSharedReport('http://api.test', 'tok')

    // One argument, so there is no `init` to carry headers at all.
    expect(vi.mocked(fetch).mock.calls[0]).toHaveLength(1)
  })

  it('parses the report and its document', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        title: 'Informe de clima Q3',
        description: 'Resultados de la encuesta',
        type: 'summary',
        generatedAt: '2026-08-01T10:00:00Z',
        reportOutput: JSON.stringify({
          generationNote: 'partial',
          surveys: [{ surveyId: 's1', isSuppressed: false }],
          aiInsights: [],
        }),
      }),
    )

    const report = await getSharedReport('http://api.test', 'tok')

    expect(report.title).toBe('Informe de clima Q3')
    expect(report.description).toBe('Resultados de la encuesta')
    expect(report.generatedAt).toBe('2026-08-01T10:00:00Z')
    expect(report.document?.surveys[0].surveyId).toBe('s1')
  })

  /**
   * THE acceptance criterion of #139, from the client side.
   *
   * Four causes a real deployment produces — an unknown token, a revoked one answered
   * 410 with a `reason`, a forbidden one, and a `fetch` that never reached the network —
   * must be one outcome. The bodies below carry exactly the sentences a server might
   * send, so a client that read `body.message` (the way `authFetch` does) fails here.
   */
  it('makes every failure indistinguishable from every other', async () => {
    const rejections = [
      await rejectionFor(jsonResponse({ message: 'Report not found' }, 404)),
      await rejectionFor(jsonResponse({ message: 'This link was revoked', reason: 'revoked' }, 410)),
      await rejectionFor(jsonResponse({ message: 'This link expired', reason: 'expired' }, 410)),
      await rejectionFor(jsonResponse({ message: 'Forbidden' }, 403)),
      await rejectionFor(jsonResponse({ message: 'Too many requests' }, 429)),
      await rejectionFor(new TypeError('Failed to fetch')),
    ]

    for (const rejection of rejections) {
      expect(rejection).toBeInstanceOf(SharedReportUnavailableError)
      expect(fingerprint(rejection)).toEqual(fingerprint(rejections[0]))
    }

    // And nothing the server said reaches the caller, under any spelling.
    const seen = rejections.map((rejection) => JSON.stringify(fingerprint(rejection))).join(' ')
    for (const leak of ['revoked', 'expired', 'not found', '404', '410', '403', '429']) {
      expect(seen.toLowerCase()).not.toContain(leak)
    }
  })

  it('rejects a 200 whose body is not an object, rather than returning a hollow report', async () => {
    // The exact shape `reports.report_output` held before #88: a bare JSON string. A
    // client that trusted a 200 would render a report with an empty title here.
    await expect(rejectionFor(jsonResponse('Report generation is stubbed'))).resolves.toBeInstanceOf(
      SharedReportUnavailableError,
    )
  })

  it('reports no document when the column is empty, rather than throwing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ title: 'Q3', reportOutput: null }))

    const report = await getSharedReport('http://api.test', 'tok')

    expect(report.document).toBeNull()
    expect(report.title).toBe('Q3')
  })
})
