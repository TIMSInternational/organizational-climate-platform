import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SurveyLinkError,
  getSurveyInvitation,
  recordSurveyInvitationStep,
  resolveSurveyPublicLink,
} from './surveyLinks'
import { setToken, clearToken } from '../../../auth/token'

const BASE = 'https://api.example.invalid'

/** 43 base64url characters, the shape `SurveyAccessTokens.HasExpectedShape` accepts. */
const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/**
 * A fresh `Response` per call.
 *
 * `mockResolvedValue` hands every caller the *same* object, and a body can only be read
 * once — so a test that makes three requests fails on the second with "Body has already
 * been used", which reads like a bug in the module under test and is not one.
 */
function alwaysOk(body: unknown, status = 200): void {
  vi.mocked(fetch).mockImplementation(() => Promise.resolve(ok(body, status)))
}

function requestInit(call: number): RequestInit | undefined {
  return vi.mocked(fetch).mock.calls[call][1] as RequestInit | undefined
}

function requestUrl(call: number): string {
  return String(vi.mocked(fetch).mock.calls[call][0])
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearToken()
})

describe('the token-addressed link routes', () => {
  /**
   * The rule this module exists to keep, and it is not the same rule
   * `surveyResponses.ts` keeps.
   *
   * That module forwards a bearer when one happens to be present, because the same two
   * endpoints also serve an authenticated respondent. These three do not: checked
   * against the handlers, `ResolvePublicLinkAsync`, `ValidateInvitationTokenAsync` and
   * `RecordStateAsync` take no `ClaimsPrincipal` and their group carries no
   * `RequireAuthorization()`. The token in the path is the whole credential, so sending
   * a second one is a leak with no upside — and an administrator opening a share link
   * in the browser they administer from is the routine case, not the exotic one.
   */
  it('sends no Authorization header, even when a token is sitting in storage', async () => {
    setToken('an-admin-jwt')
    alwaysOk({ surveyId: 's1' })

    await resolveSurveyPublicLink(BASE, TOKEN)
    await getSurveyInvitation(BASE, TOKEN)
    await recordSurveyInvitationStep(BASE, TOKEN, 'opened')

    for (let call = 0; call < 3; call += 1) {
      const headers = new Headers(requestInit(call)?.headers)
      expect(headers.get('Authorization'), `call ${call}`).toBeNull()
    }
  })

  /**
   * `authFetch` clears the stored token and sets `window.location.href = '/login'` on a
   * 401. On these routes that would throw a respondent with no account off the page
   * before an error could render, so nothing here may reach for it.
   */
  it('does not clear the session when a request fails', async () => {
    setToken('an-admin-jwt')
    vi.mocked(fetch).mockResolvedValue(ok({ message: 'nope' }, 401))

    await expect(resolveSurveyPublicLink(BASE, TOKEN)).rejects.toBeInstanceOf(SurveyLinkError)

    expect(window.localStorage.getItem('climate_platform_token')).toBe('an-admin-jwt')
  })

  it('addresses the routes the API actually maps', async () => {
    alwaysOk({})

    await resolveSurveyPublicLink(BASE, TOKEN)
    await getSurveyInvitation(BASE, TOKEN, { lang: 'es' })
    await recordSurveyInvitationStep(BASE, TOKEN, 'started')

    expect(requestUrl(0)).toBe(`${BASE}/survey-links/${TOKEN}`)
    expect(requestUrl(1)).toBe(`${BASE}/survey-invitations/${TOKEN}?lang=es`)
    expect(requestUrl(2)).toBe(`${BASE}/survey-invitations/${TOKEN}/started`)
    expect(requestInit(2)?.method).toBe('POST')
  })

  /**
   * The share-link resolve is the request that increments
   * `survey_distributions.total_accesses`, and its localized title is never rendered.
   * A `lang` parameter would invite a caller to re-issue it on a language switch and
   * report one respondent as several in the only access figure an administrator has.
   */
  it('takes no locale on the share link, which counts every call', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({}))

    await resolveSurveyPublicLink(BASE, TOKEN)

    expect(requestUrl(0)).not.toContain('?')
  })

  it('escapes a token that came out of the address bar', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({}))

    await recordSurveyInvitationStep(BASE, '../../admin/companies', 'opened')

    // A path segment, not extra segments: the server's own shape check would refuse it,
    // but the request must not be able to address a different route on the way there.
    expect(requestUrl(0)).toBe(`${BASE}/survey-invitations/..%2F..%2Fadmin%2Fcompanies/opened`)
  })
})

describe('SurveyLinkError', () => {
  /**
   * The reason it exists rather than reusing `SurveyRespondError`: a revoked invitation
   * and an expired one are both 410 and are separated only by `reason` — a distinction
   * the server takes deliberate trouble to preserve, checking revoked *before* expiry so
   * an admin's act is not reported as the passage of time.
   */
  it('carries the reason alongside the status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ message: 'This invitation has been revoked.', reason: 'revoked' }, 410),
    )

    const error = await getSurveyInvitation(BASE, TOKEN).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(SurveyLinkError)
    expect((error as SurveyLinkError).status).toBe(410)
    expect((error as SurveyLinkError).reason).toBe('revoked')
    expect((error as SurveyLinkError).message).toBe('This invitation has been revoked.')
  })

  it('reports a null reason for a response that carries none', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ message: 'This link is not valid.' }, 404))

    const error = await resolveSurveyPublicLink(BASE, TOKEN).catch((thrown: unknown) => thrown)

    expect((error as SurveyLinkError).reason).toBeNull()
    expect((error as SurveyLinkError).status).toBe(404)
  })

  /**
   * A rate-limited request is rejected by middleware and need not be JSON at all. An
   * unparseable body must still produce an error the page can render, not a `SyntaxError`
   * escaping from a `.json()` nobody guarded.
   */
  it('survives a rejection that is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Too Many Requests', { status: 429 }))

    const error = await getSurveyInvitation(BASE, TOKEN).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(SurveyLinkError)
    expect((error as SurveyLinkError).status).toBe(429)
    expect((error as SurveyLinkError).message).toBe('')
    expect((error as SurveyLinkError).reason).toBeNull()
  })

  it('ignores a non-string message or reason rather than rendering an object', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ message: { text: 'no' }, reason: 7 }, 410))

    const error = await getSurveyInvitation(BASE, TOKEN).catch((thrown: unknown) => thrown)

    expect((error as SurveyLinkError).message).toBe('')
    expect((error as SurveyLinkError).reason).toBeNull()
  })
})
