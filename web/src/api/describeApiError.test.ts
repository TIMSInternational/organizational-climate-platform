import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { describeApiError } from './describeApiError'
import { ApiError, authFetch } from './authFetch'
import { setToken, clearToken } from '../auth/token'
import { CATALOGUES, LOCALES, LOCALE_STORAGE_KEY } from '../i18n/locale'
import { createTranslator } from '../i18n/translate'

/**
 * G30: an admin on a Spanish screen never reads the API's English or `Request failed: N`.
 * Every case asserts the Spanish sentence AND that the server's words are absent.
 */
const es = CATALOGUES.es
const t = createTranslator(CATALOGUES.es, CATALOGUES.en)
const SERVER_ENGLISH = 'A person cannot be their own manager'

function str(path: string): string {
  let node: unknown = es
  for (const segment of path.split('.')) node = (node as Record<string, unknown>)[segment]
  if (typeof node !== 'string') throw new Error(`no es string at ${path}`)
  return node
}

describe('describeApiError', () => {
  it.each([
    [403, 'errors.api.forbidden'],
    [404, 'errors.api.notFound'],
    [409, 'errors.api.conflict'],
    [413, 'errors.api.tooLarge'],
    [429, 'errors.api.rateLimited'],
    [500, 'errors.api.server'],
    [503, 'errors.api.server'],
  ])('says a %i in Spanish, not the server\'s English', (status, key) => {
    const text = describeApiError(new ApiError(status, SERVER_ENGLISH), t)
    expect(text).toBe(str(key))
    expect(text).not.toContain(SERVER_ENGLISH)
  })

  it('gives an unmapped refusal (400) the screen\'s own fallback', () => {
    const text = describeApiError(new ApiError(400, SERVER_ENGLISH), t, 'users.next.edit.saveFailed')
    expect(text).toBe(str('users.next.edit.saveFailed'))
  })

  it('says "refused, check the details" for a 400 when the screen names no fallback', () => {
    expect(describeApiError(new ApiError(400, SERVER_ENGLISH), t)).toBe(str('errors.api.rejected'))
  })

  it('never shows the synthetic "Request failed: N"', () => {
    const text = describeApiError(new ApiError(422, 'Request failed: 422'), t)
    expect(text).not.toMatch(/Request failed/)
  })

  it('says a known code in Spanish, over the status', () => {
    const text = describeApiError(
      new ApiError(400, 'A survey in status \'closed\' has ended…', 'survey_ended_audience_frozen'),
      t,
      'users.next.edit.saveFailed',
    )
    expect(text).toBe(str('errors.api.codes.survey_ended_audience_frozen'))
  })

  it('treats an unknown code as no code', () => {
    expect(describeApiError(new ApiError(404, SERVER_ENGLISH, 'not_found'), t)).toBe(str('errors.api.notFound'))
  })

  it('keeps a transport failure as the network sentence', () => {
    const offline = new Error('whatever', { cause: new TypeError('Failed to fetch') })
    expect(describeApiError(offline, t)).toBe(str('errors.networkError'))
  })

  it('does not pass through a plain Error\'s text', () => {
    expect(describeApiError(new Error(SERVER_ENGLISH), t, 'surveys.distribution.loadFailed')).toBe(
      str('surveys.distribution.loadFailed'),
    )
  })

  it('handles a non-Error', () => {
    expect(describeApiError('boom', t)).toBe(str('errors.generic'))
  })

  it('has every sentence it can return in both catalogues', () => {
    const keys = [
      'errors.api.forbidden', 'errors.api.notFound', 'errors.api.conflict', 'errors.api.tooLarge',
      'errors.api.rateLimited', 'errors.api.server', 'errors.api.rejected', 'errors.sessionExpired',
      'errors.networkError', 'errors.generic',
      'errors.api.codes.survey_ended_audience_frozen', 'errors.api.codes.credential_mode_frozen',
      'errors.api.codes.not_mass_invite', 'errors.api.codes.inactive', 'errors.api.codes.batch_too_large',
      'errors.api.codes.per_survey_person',
    ]
    for (const locale of LOCALES) {
      const lt = createTranslator(CATALOGUES[locale])
      for (const key of keys) expect(lt(key), `${key} in ${locale}`).not.toBe(key)
    }
  })
})

describe('authFetch carries the body\'s code onto ApiError', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    setToken('header.eyJzdWIiOiJ1MSJ9.signature')
  })
  afterEach(() => {
    clearToken()
    localStorage.removeItem(LOCALE_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  it('reads `code` and leaves `message` exactly as the server sent it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This account is deactivated.', code: 'inactive' }), { status: 409 }),
    )
    const caught = await authFetch('/x').catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('inactive')
    expect((caught as ApiError).message).toBe('This account is deactivated.')
    expect(describeApiError(caught, t)).toBe(str('errors.api.codes.inactive'))
  })

  it('a body with no code leaves it undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 400 }))
    const caught = (await authFetch('/x').catch((e: unknown) => e)) as ApiError
    expect(caught.code).toBeUndefined()
  })

  it('a transport failure reads as the network sentence in Spanish', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const caught = await authFetch('/x').catch((e: unknown) => e)
    expect(describeApiError(caught, t)).toBe(str('errors.networkError'))
  })
})
