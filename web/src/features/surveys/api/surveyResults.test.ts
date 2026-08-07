import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getSurveyAnalytics,
  getSurveyRealTimeStats,
  getSurveyResults,
  getSurveyStatistics,
} from './surveyResults'
import { setToken } from '../../../auth/token'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function calledUrl(): string {
  return vi.mocked(fetch).mock.calls[0][0] as string
}

describe('survey results API client', () => {
  beforeEach(() => {
    setToken('header.payload.signature')
    // A fresh Response per call: a single shared one has its body consumed by the
    // first `.json()` and every later call throws "Body has already been used".
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({}))))
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('asks each of the three heavy presentations for its own route', async () => {
    await getSurveyResults('http://api', 's1')
    expect(calledUrl()).toBe('http://api/surveys/s1/results')

    vi.mocked(fetch).mockClear()
    await getSurveyStatistics('http://api', 's1')
    expect(calledUrl()).toBe('http://api/surveys/s1/statistics')

    vi.mocked(fetch).mockClear()
    await getSurveyAnalytics('http://api', 's1')
    expect(calledUrl()).toBe('http://api/surveys/s1/analytics')
  })

  it('passes the requested locale through as ?lang', async () => {
    await getSurveyAnalytics('http://api', 's1', 'es')
    expect(calledUrl()).toBe('http://api/surveys/s1/analytics?lang=es')
  })

  it('omits ?lang entirely when none is asked for, rather than sending an empty one', async () => {
    await getSurveyAnalytics('http://api', 's1')
    expect(calledUrl()).not.toContain('lang')
  })

  it('sends no locale to real-time-stats, which carries no authored content', async () => {
    // The payload is counters and department names. Nothing in it is `_en`/`_es`
    // paired, so there is nothing for a locale to resolve and sending one would
    // imply otherwise.
    await getSurveyRealTimeStats('http://api', 's1')
    expect(calledUrl()).toBe('http://api/surveys/s1/real-time-stats')
  })

  it('encodes the survey id', async () => {
    await getSurveyAnalytics('http://api', 'a/b')
    expect(calledUrl()).toBe('http://api/surveys/a%2Fb/analytics')
  })

  it('returns the payload as parsed by the server, including the suppression fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        surveyId: 's1',
        isSuppressed: true,
        suppressionReason: 'below_minimum_respondents',
        minimumGroupSize: 5,
        resolvedLocale: 'es',
      }),
    )

    const payload = await getSurveyAnalytics('http://api', 's1', 'en')

    // The locale asked for was `en` and what came back is Spanish. The client must
    // not paper over that — the page is required to say so.
    expect(payload.resolvedLocale).toBe('es')
    expect(payload.isSuppressed).toBe(true)
    expect(payload.suppressionReason).toBe('below_minimum_respondents')
  })

  it('surfaces a failure rather than resolving with an empty result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, 403))
    await expect(getSurveyAnalytics('http://api', 's1')).rejects.toThrow('Forbidden')
  })
})
