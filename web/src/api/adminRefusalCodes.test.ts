import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describeApiError, describeKnownRefusal, KNOWN_REFUSAL_CODES } from './describeApiError'
import { ApiError } from './authFetch'
import { setToken, clearToken } from '../auth/token'
import { CATALOGUES, LOCALES } from '../i18n/locale'
import { createTranslator } from '../i18n/translate'
import { updateUser } from '../features/org-structure/api/users'
import { updateErrorText } from '../features/org-structure/components/emailRefusal'

/**
 * The admin refusals the API marks with a stable `code` (`AdminRefusals.cs`) are said in the
 * reader's language, one specific sentence each, instead of the status's generic line.
 *
 * The list is READ from the API source, not copied: a code added there without a sentence here
 * fails the sweep below, which is the drift a copied list could not see.
 */
const ADMIN_REFUSALS = join(resolve(process.cwd(), '..'), 'src', 'ClimateProject.Api', 'Endpoints', 'AdminRefusals.cs')
const API_CODES = [...readFileSync(ADMIN_REFUSALS, 'utf8').matchAll(/public const string \w+ = "([a-z_]+)";/g)].map((m) => m[1])

const es = createTranslator(CATALOGUES.es)
const en = createTranslator(CATALOGUES.en)
const SERVER_ENGLISH = 'Department with this name already exists at this level'

describe('the API\'s admin refusal codes', () => {
  it('are read from AdminRefusals.cs (a sweep that matched nothing would pass for the wrong reason)', () => {
    expect(API_CODES.length).toBeGreaterThanOrEqual(30)
    expect(new Set(API_CODES).size).toBe(API_CODES.length)
  })

  it.each(API_CODES)('%s has a sentence in describeApiError', (code) => {
    expect(KNOWN_REFUSAL_CODES).toContain(code)
  })

  it.each(API_CODES)('%s is said in Spanish and in English, never as the server\'s words or the status line', (code) => {
    for (const status of [400, 409]) {
      const refusal = new ApiError(status, SERVER_ENGLISH, code)
      const spanish = describeApiError(refusal, es, 'users.next.edit.saveFailed')
      const english = describeApiError(refusal, en, 'users.next.edit.saveFailed')

      expect(spanish).toBe(es(`errors.api.codes.${code}`))
      expect(english).toBe(en(`errors.api.codes.${code}`))
      // Resolved, specific, and not the generic lines a code-less refusal would get.
      expect(spanish).not.toBe(`errors.api.codes.${code}`)
      expect(spanish).not.toBe(es('errors.api.conflict'))
      expect(spanish).not.toBe(es('errors.api.rejected'))
      expect(spanish).not.toBe(es('users.next.edit.saveFailed'))
      expect(spanish).not.toContain(SERVER_ENGLISH)
      // Spanish must be Spanish.
      expect(spanish).not.toBe(english)
      expect(describeKnownRefusal(refusal, es)).toBe(spanish)
    }
  })

  it('every mapped key exists in both catalogues', () => {
    for (const locale of LOCALES) {
      const lt = createTranslator(CATALOGUES[locale])
      for (const code of KNOWN_REFUSAL_CODES) {
        expect(lt(`errors.api.codes.${code}`), `${code} in ${locale}`).not.toBe(`errors.api.codes.${code}`)
      }
    }
  })

  it('describeKnownRefusal stays out of the way of an uncoded or unknown refusal', () => {
    expect(describeKnownRefusal(new ApiError(409, SERVER_ENGLISH), es)).toBeNull()
    expect(describeKnownRefusal(new ApiError(404, SERVER_ENGLISH, 'not_found'), es)).toBeNull()
    expect(describeKnownRefusal(new Error(SERVER_ENGLISH), es)).toBeNull()
  })
})

describe('the person editor keeps a refusal\'s code', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    setToken('header.eyJzdWIiOiJ1MSJ9.signature')
  })
  afterEach(() => {
    clearToken()
    vi.unstubAllGlobals()
  })

  // `updateUser` reads 400/409 bodies itself (for the four address refusals), and used to
  // rebuild every other refusal WITHOUT its code -- so `user_own_manager` never reached the map.
  it('says "cannot be their own manager" in Spanish, not the editor\'s generic failure', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'A person cannot be their own manager', code: 'user_own_manager' }), { status: 400 }),
    )

    const caught = await updateUser('', 'u1', { managerId: 'u1' }).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('user_own_manager')
    expect((caught as ApiError).message).toBe('A person cannot be their own manager')
    expect(updateErrorText(es, caught, 'users.next.edit.saveFailed')).toBe(es('errors.api.codes.user_own_manager'))
  })
})
