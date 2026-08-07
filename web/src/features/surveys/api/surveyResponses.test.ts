import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken, clearToken } from '../../../auth/token'
import {
  SurveyRespondError,
  getSurveyRespondView,
  submitSurveyResponse,
} from './surveyResponses'

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function requestInit(call: number = 0): RequestInit {
  return vi.mocked(fetch).mock.calls[call][1] as RequestInit
}

function headerOf(name: string, call: number = 0): string | null {
  return new Headers(requestInit(call).headers).get(name)
}

describe('surveyResponses api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearToken()
  })

  /**
   * The reason this module does not use `authFetch`. A genuinely anonymous respondent
   * has no token at all, and `authFetch` sends every 401 to `/login` after clearing
   * storage — which on this page means the respondent is thrown off the form before
   * an error message can render.
   */
  it('sends no Authorization header when there is no token', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ id: 's1' }))

    await getSurveyRespondView('http://api', 's1')

    expect(headerOf('Authorization')).toBeNull()
  })

  it('attaches a bearer token when one is present, so the same route serves an employee', async () => {
    setToken('jwt-value')
    vi.mocked(fetch).mockResolvedValue(ok({ id: 's1' }))

    await getSurveyRespondView('http://api', 's1')

    expect(headerOf('Authorization')).toBe('Bearer jwt-value')
  })

  it('asks for the reader locale explicitly, and passes the resume key', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ id: 's1' }))

    await getSurveyRespondView('http://api', 's1', { lang: 'es', sessionId: 'abc 123' })

    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('/surveys/s1/respond?')
    expect(url).toContain('lang=es')
    // Encoded, not concatenated: the id is client-generated and must survive
    // characters that would otherwise end the query string.
    expect(url).toContain('sessionId=abc+123')
  })

  it('sends no query string at all when nothing was asked for', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ id: 's1' }))

    await getSurveyRespondView('http://api', 's1')

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://api/surveys/s1/respond')
  })

  /**
   * The status is what lets the page tell "gone", "closed", "not yours" and "not
   * available to you" apart. Matching on the server's message text would work today
   * and break the day that message is translated.
   */
  it('carries the status on a failure, not just the message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This survey is not currently accepting responses' }), {
        status: 400,
      }),
    )

    await expect(getSurveyRespondView('http://api', 's1')).rejects.toMatchObject({
      status: 400,
      message: 'This survey is not currently accepting responses',
    })
  })

  it('still reports the status when the body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }))

    const error = await getSurveyRespondView('http://api', 's1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SurveyRespondError)
    expect((error as SurveyRespondError).status).toBe(502)
  })

  it('posts the submission body through unchanged', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ responseId: 'r1' }))

    await submitSurveyResponse('http://api', 's1', {
      answers: [{ questionId: 'q1', value: 'agree' }],
      sessionId: 'session-1',
      isComplete: true,
      language: 'es',
    })

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://api/surveys/s1/responses')
    expect(requestInit().method).toBe('POST')
    expect(headerOf('Content-Type')).toBe('application/json')
    expect(JSON.parse(requestInit().body as string)).toEqual({
      answers: [{ questionId: 'q1', value: 'agree' }],
      sessionId: 'session-1',
      isComplete: true,
      language: 'es',
    })
  })

  it('reports a rejected submission with its status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Required questions are unanswered' }), { status: 400 }),
    )

    await expect(
      submitSurveyResponse('http://api', 's1', { isComplete: true }),
    ).rejects.toMatchObject({ status: 400, message: 'Required questions are unanswered' })
  })
})
