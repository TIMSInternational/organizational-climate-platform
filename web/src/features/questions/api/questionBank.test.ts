import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  createQuestionBankItem,
  getQuestionBankItem,
  getQuestionBankMetrics,
  listQuestionBankCategories,
  listQuestionBankEffectiveness,
  listQuestionBankItems,
  setQuestionBankLifecycle,
  updateQuestionBankItem,
} from './questionBank'

const baseUrl = 'http://api.test'

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('questionBank api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('unwraps the list envelope and keeps the total', async () => {
    const items = [{ id: 'q1', category: 'trust' }]
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items, total: 17 }))

    expect(await listQuestionBankItems(baseUrl)).toEqual({ items, total: 17 })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/question-bank`, expect.anything())
  })

  it('sends no query string when no filter was asked for', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [], total: 0 }))
    await listQuestionBankItems(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/question-bank`, expect.anything())
  })

  it('passes only the filters it was given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [], total: 0 }))
    await listQuestionBankItems(baseUrl, { category: 'trust', search: 'safe' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank?category=trust&search=safe`,
      expect.anything(),
    )
  })

  /**
   * The one filter a curation screen cannot do without. `ListAsync` returns ACTIVE rows
   * only by default, so a page that never sends this shows the admin the corpus while
   * hiding exactly the rows they opened it to review.
   */
  it('sends includeRetired only when it is true', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [], total: 0 }))
    await listQuestionBankItems(baseUrl, { includeRetired: true })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank?includeRetired=true`,
      expect.anything(),
    )

    vi.mocked(fetch).mockResolvedValueOnce(ok({ items: [], total: 0 }))
    await listQuestionBankItems(baseUrl, { includeRetired: false })
    expect(fetch).toHaveBeenLastCalledWith(`${baseUrl}/admin/question-bank`, expect.anything())
  })

  it('reads one item by id, un-enveloped', async () => {
    const detail = { id: 'q1', options: [{ order: 0, value: 'yes', label: 'Yes' }] }
    vi.mocked(fetch).mockResolvedValueOnce(ok(detail))

    expect(await getQuestionBankItem(baseUrl, 'q1')).toEqual(detail)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/question-bank/q1`, expect.anything())
  })

  it('unwraps the category counts', async () => {
    const categories = [{ category: 'trust', subcategory: null, itemCount: 4, activeItemCount: 3 }]
    vi.mocked(fetch).mockResolvedValueOnce(ok({ categories }))

    expect(await listQuestionBankCategories(baseUrl)).toEqual(categories)
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank/categories`,
      expect.anything(),
    )
  })

  it('unwraps the effectiveness envelope', async () => {
    const items = [{ questionBankItemId: 'q1', metrics: { timesAsked: 10, timesAnswered: 9 } }]
    vi.mocked(fetch).mockResolvedValueOnce(ok({ items }))

    expect(await listQuestionBankEffectiveness(baseUrl, 'co-1')).toEqual(items)
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank/effectiveness?companyId=co-1`,
      expect.anything(),
    )
  })

  it('reads one item metrics un-enveloped', async () => {
    const metrics = { questionBankItemId: 'q1', timesAsked: 3, timesAnswered: 2 }
    vi.mocked(fetch).mockResolvedValueOnce(ok(metrics))

    expect(await getQuestionBankMetrics(baseUrl, 'q1')).toEqual(metrics)
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank/q1/metrics`,
      expect.anything(),
    )
  })

  it('POSTs a create', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ id: 'q9' }))
    await createQuestionBankItem(baseUrl, { text: 'New', type: 'likert', category: 'trust' })

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'New', type: 'likert', category: 'trust' }),
      }),
    )
  })

  it('PUTs an update to the item route', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ id: 'q1' }))
    await updateQuestionBankItem(baseUrl, 'q1', { text: 'Edited', category: 'trust' })

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank/q1`,
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  /**
   * Retirement is the only removal this API offers, so it must reach `/lifecycle` and not
   * DELETE: an item that has been asked of real respondents has to stay resolvable for as
   * long as their answers do (#106).
   */
  it('PUTs the lifecycle state to /lifecycle, never DELETE', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ id: 'q1', state: 'retired', instantiatedQuestionCount: 4 }))
    const result = await setQuestionBankLifecycle(baseUrl, 'q1', 'retired')

    expect(result.instantiatedQuestionCount).toBe(4)
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/admin/question-bank/q1/lifecycle`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ state: 'retired' }) }),
    )
  })

  /** Nothing on this client may reach the LIBRARY — see the module note and #58. */
  it('never calls a question-library route', async () => {
    // A fresh Response per call: a body can only be read once, so a single shared
    // instance makes the second await throw rather than assert anything.
    vi.mocked(fetch).mockImplementation(async () => ok({ items: [], total: 0, categories: [] }))
    await listQuestionBankItems(baseUrl, { category: 'trust' })
    await listQuestionBankCategories(baseUrl)
    await listQuestionBankEffectiveness(baseUrl)

    for (const call of vi.mocked(fetch).mock.calls) {
      expect(String(call[0])).not.toContain('/admin/question-library')
      expect(String(call[0])).not.toContain('/admin/question-categories')
    }
  })
})
