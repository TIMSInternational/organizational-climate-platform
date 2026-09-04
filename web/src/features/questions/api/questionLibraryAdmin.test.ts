import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  QUESTION_LIBRARY_TYPES,
  createQuestionCategory,
  createQuestionLibraryItem,
  requiresOptions,
  updateQuestionCategory,
  updateQuestionLibraryItem,
} from './questionLibraryAdmin'
import { setToken, clearToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'

const BASE = 'https://api.test'

function captureFetch() {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return Promise.resolve(new Response(JSON.stringify({ id: 'new-id' }), { status: 200 }))
  })
  return calls
}

beforeEach(() => {
  setToken(tokenFor({ role: 'super_admin', companyId: '' }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  clearToken()
  vi.unstubAllGlobals()
})

describe('the library vocabulary', () => {
  /**
   * Pinned, not derived, because the web cannot read the C#.
   *
   * Server-side this is `QuestionTypes.ForSurvey ∩ ForMicroclimate`
   * (`QuestionRepositoryTypes.Supported`): a library item must be instantiable into
   * either kind of instrument. `ranking` is survey-only and `emoji_rating` is
   * microclimate-only, so neither is here. If someone widens either set, this test is
   * what turns a silent 400 in front of an author into a failing build.
   */
  it('offers exactly the five types both instruments accept', () => {
    expect([...QUESTION_LIBRARY_TYPES]).toEqual([
      'likert',
      'multiple_choice',
      'open_ended',
      'rating',
      'yes_no',
    ])
  })

  it('requires options for multiple choice and for nothing else', () => {
    expect(requiresOptions('multiple_choice')).toBe(true)
    for (const type of QUESTION_LIBRARY_TYPES.filter((t) => t !== 'multiple_choice')) {
      expect(requiresOptions(type)).toBe(false)
    }
  })
})

describe('question library writes', () => {
  it('posts a category to the categories collection', async () => {
    const calls = captureFetch()
    await createQuestionCategory(BASE, { nameEn: 'Belonging', nameEs: 'Pertenencia' })

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(`${BASE}/admin/question-categories`)
    expect(calls[0].body).toEqual({ nameEn: 'Belonging', nameEs: 'Pertenencia' })
  })

  it('puts a category update at its own id', async () => {
    const calls = captureFetch()
    await updateQuestionCategory(BASE, 'cat-1', { nameEn: 'Belonging', nameEs: 'Pertenencia' })

    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(`${BASE}/admin/question-categories/cat-1`)
  })

  it('posts an item to the library collection, not to the bank', async () => {
    const calls = captureFetch()
    await createQuestionLibraryItem(BASE, {
      questionCategoryId: 'cat-1',
      textEn: 'I can raise a concern',
      textEs: 'Puedo expresar una preocupación',
      type: 'likert',
    })

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(`${BASE}/admin/question-library`)
    // The two repositories must not be merged; a write that leaked to the bank would be
    // writing a different set of tables entirely.
    expect(calls[0].url).not.toContain('question-bank')
  })

  /**
   * `companyId` and `type` are absent from the update input type by design — both are
   * immutable after creation. This asserts the serialised body, because a field the type
   * forbids can still arrive through a cast at a call site.
   */
  it('never sends companyId or type on an item update', async () => {
    const calls = captureFetch()
    await updateQuestionLibraryItem(BASE, 'q1', {
      questionCategoryId: 'cat-1',
      textEn: 'Updated',
      textEs: 'Actualizado',
      tags: ['clima'],
    })

    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe(`${BASE}/admin/question-library/q1`)
    expect(Object.keys(calls[0].body as object)).not.toContain('companyId')
    expect(Object.keys(calls[0].body as object)).not.toContain('type')
    expect((calls[0].body as { tags: string[] }).tags).toEqual(['clima'])
  })
})
