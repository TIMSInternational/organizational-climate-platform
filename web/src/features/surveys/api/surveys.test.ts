import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  listSurveys,
  listMySurveys,
  getSurvey,
  updateSurveyStatus,
  duplicateSurvey,
  deleteSurvey,
  type SurveyDetail,
  type SurveyListItem,
  type MySurveyListItem,
} from './surveys'

const baseUrl = 'http://api.test'

const listRow: SurveyListItem = {
  id: 's1',
  title: 'Q3 climate survey',
  companyId: 'c1',
  type: 'periodic',
  status: 'draft',
  language: 'both',
  startDate: '2026-09-01T00:00:00Z',
  endDate: '2026-09-30T00:00:00Z',
  responseCount: 0,
  targetAudienceCount: 120,
  questionCount: 8,
  createdAt: '2026-08-01T00:00:00Z',
}

const myRow: MySurveyListItem = {
  id: 's1',
  title: 'Q3 climate survey',
  description: null,
  type: 'periodic',
  startDate: '2026-09-01T00:00:00Z',
  endDate: '2026-09-30T00:00:00Z',
  questionCount: 8,
  anonymous: true,
  timeLimitMinutes: null,
}

const detail: SurveyDetail = {
  id: 's1',
  title: 'Encuesta de clima',
  description: null,
  companyId: 'c1',
  createdBy: 'u1',
  type: 'periodic',
  status: 'draft',
  language: 'es',
  resolvedLocale: 'es',
  fallbackFields: ['title'],
  startDate: '2026-09-01T00:00:00Z',
  endDate: '2026-09-30T00:00:00Z',
  responseCount: 0,
  targetAudienceCount: null,
  version: 1,
  departmentIds: [],
  questions: [],
  settings: {
    anonymous: true,
    allowPartialResponses: false,
    randomizeQuestions: false,
    showProgress: true,
    autoSave: true,
    timeLimitMinutes: null,
    responseLimit: null,
    notificationSendInvitations: true,
    notificationSendReminders: true,
    notificationReminderFrequencyDays: 3,
    invitationCustomMessage: null,
    invitationCustomSubject: null,
    invitationIncludeCredentials: false,
    invitationSendImmediately: false,
    invitationBrandingEnabled: true,
  },
  allowedStatusTransitions: ['scheduled', 'active', 'archived'],
  isContentEditable: true,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function requestUrl(call = 0): string {
  return String(vi.mocked(fetch).mock.calls[call][0])
}

describe('surveys api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('unwraps the envelope rather than returning it', async () => {
    // `SurveyListResponse` is `{ surveys: [...] }`, not a bare array -- unlike
    // `/admin/reports`. Returning the envelope would make every caller index into
    // `.surveys` themselves, and a page that forgot would render nothing.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [listRow] }))
    expect(await listSurveys(baseUrl)).toEqual([listRow])
  })

  it('lists surveys with no query string when no filters are given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [] }))
    await listSurveys(baseUrl)
    expect(requestUrl()).toBe(`${baseUrl}/surveys`)
  })

  it('sends only the filters that have a value', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [] }))
    await listSurveys(baseUrl, { status: 'active', type: '', q: 'clima' })

    const url = new URL(requestUrl())
    expect(url.pathname).toBe('/surveys')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('q')).toBe('clima')
    // An empty `type` must not be sent: the backend treats a blank filter as absent,
    // but sending `type=` for every unfiltered request makes the URL lie about intent
    // and defeats any future caching on it.
    expect(url.searchParams.has('type')).toBe(false)
    expect(url.searchParams.has('companyId')).toBe(false)
  })

  it('escapes a search term rather than splicing it into the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [] }))
    await listSurveys(baseUrl, { q: 'clima & cultura' })
    expect(new URL(requestUrl()).searchParams.get('q')).toBe('clima & cultura')
  })

  it('passes lang through so the server resolves the content, not the client', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [] }))
    await listSurveys(baseUrl, {}, 'es')
    expect(new URL(requestUrl()).searchParams.get('lang')).toBe('es')
  })

  it('sends the bearer token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [] }))
    await listSurveys(baseUrl)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('lists my surveys from /surveys/my, which is a different endpoint from /surveys', async () => {
    // The two listings are NOT the same list: /surveys is what the caller may
    // administer, /surveys/my is what they are expected to answer.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ surveys: [myRow] }))
    expect(await listMySurveys(baseUrl, 'en')).toEqual([myRow])
    expect(new URL(requestUrl()).pathname).toBe('/surveys/my')
  })

  it('gets one survey and keeps resolvedLocale and fallbackFields intact', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(detail))
    const result = await getSurvey(baseUrl, 's1', 'en')

    expect(new URL(requestUrl()).pathname).toBe('/surveys/s1')
    // Asked for English, served Spanish, and the payload says so. Dropping either
    // field would hide the substitution the whole design exists to make visible.
    expect(result.resolvedLocale).toBe('es')
    expect(result.fallbackFields).toEqual(['title'])
  })

  it('puts a status change on its own route with a PUT', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...detail, status: 'active' }))
    const result = await updateSurveyStatus(baseUrl, 's1', 'active')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(new URL(String(url)).pathname).toBe('/surveys/s1/status')
    expect(init!.method).toBe('PUT')
    expect(JSON.parse(String(init!.body))).toEqual({ status: 'active' })
    expect(result.status).toBe('active')
  })

  it('surfaces the server refusal for an illegal transition instead of swallowing it', async () => {
    // The transition matrix and the publish gate are server-side. This client must
    // report what the server said, not decide for itself -- that is why the pages
    // drive their buttons from `allowedStatusTransitions`.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: 'Cannot transition from closed to active' }, 400),
    )
    await expect(updateSurveyStatus(baseUrl, 's1', 'active')).rejects.toThrow(
      'Cannot transition from closed to active',
    )
  })

  it('duplicates without inventing a title, because the server appends a per-locale suffix', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...detail, id: 's2' }, 201))
    const result = await duplicateSurvey(baseUrl, 's1')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(new URL(String(url)).pathname).toBe('/surveys/s1/duplicate')
    expect(init!.method).toBe('POST')
    // Empty body: sending `title` would mean choosing a language for text the client
    // cannot know the original was authored in, which is the content-mangling the
    // paired columns exist to prevent.
    expect(JSON.parse(String(init!.body))).toEqual({})
    expect(result.id).toBe('s2')
  })

  it('does not parse a body for delete, which answers 204', async () => {
    // `new Response(null, { status: 204 }).json()` rejects. A client that parsed it
    // would turn every successful delete into an error.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteSurvey(baseUrl, 's1')).resolves.toBeUndefined()
    expect(vi.mocked(fetch).mock.calls[0][1]!.method).toBe('DELETE')
  })
})
