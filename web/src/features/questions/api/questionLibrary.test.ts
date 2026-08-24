import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  getQuestionLibraryItem,
  listQuestionCategories,
  listQuestionLibraryItems,
} from './questionLibrary'

const baseUrl = 'http://api.test'

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('questionLibrary api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('unwraps the category list from its envelope', async () => {
    const categories = [
      {
        id: 'c1',
        companyId: null,
        parentCategoryId: null,
        nameEn: 'Leadership',
        nameEs: 'Liderazgo',
        descriptionEn: null,
        descriptionEs: null,
        order: 0,
        icon: null,
        color: null,
        isActive: true,
        itemCount: 4,
      },
    ]
    vi.mocked(fetch).mockResolvedValueOnce(ok({ categories }))

    expect(await listQuestionCategories(baseUrl)).toEqual(categories)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/question-categories`, expect.anything())
  })

  it('sends no query string when no filter was asked for', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [] }))
    await listQuestionLibraryItems(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/question-library`, expect.anything())
  })

  it('passes only the filters it was given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [] }))
    await listQuestionLibraryItems(baseUrl, { categoryId: 'c1', tag: 'trust' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-library?categoryId=c1&tag=trust`,
      expect.anything(),
    )
  })

  it('reads one item by id, un-enveloped', async () => {
    const detail = { id: 'q1', options: [{ order: 0, value: 'yes', labelEn: 'Yes', labelEs: 'Sí' }] }
    vi.mocked(fetch).mockResolvedValueOnce(ok(detail))

    const result = await getQuestionLibraryItem(baseUrl, 'q1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/question-library/q1`, expect.anything())
    expect(result.options).toEqual(detail.options)
  })

  it('reaches the library and never the question bank', async () => {
    // #58 and the endpoint's own docstring: the library is the AUTHORING repository
    // and the bank (#110) is the CURATION surface. "They do not overlap in purpose
    // and must not be merged." A picker that quietly read the bank instead would
    // return plausible rows with a flat string category and no hierarchy at all.
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [] }))
    await listQuestionLibraryItems(baseUrl)
    const url = vi.mocked(fetch).mock.calls[0]?.[0]
    expect(String(url)).not.toContain('question-bank')
  })
})
