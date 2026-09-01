import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import QuestionBankPage from './QuestionBankPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import type { QuestionBankItem, QuestionBankMetrics } from '../api/questionBank'

/** An unsigned JWT carrying just the claims the page reads. */
function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const OWN = 'company-1'

function bankRow(overrides: Partial<QuestionBankItem> = {}): QuestionBankItem {
  return {
    id: 'q1',
    companyId: OWN,
    text: 'I can raise a concern without fear',
    language: 'en',
    type: 'likert',
    category: 'psychological_safety',
    subcategory: null,
    industry: null,
    companySize: null,
    usageCount: 3,
    responseRate: 98,
    insightScore: 0.8,
    lastUsedAt: null,
    isActive: true,
    isAiGenerated: false,
    version: 1,
    parentQuestionBankItemId: null,
    tags: [],
    ...overrides,
  }
}

function metrics(id: string, asked: number, answered: number): QuestionBankMetrics {
  const rate = asked === 0 ? 0 : (answered / asked) * 100
  return {
    questionBankItemId: id,
    surveysUsedIn: 1,
    questionsCreated: 1,
    timesAsked: asked,
    timesAnswered: answered,
    responseRate: rate,
    skipRate: 100 - rate,
    averageTimeSpentSeconds: 12,
    lastUsedAt: null,
  }
}

function effectivenessFor(rows: Array<{ item: QuestionBankItem; metrics: QuestionBankMetrics }>) {
  return {
    items: rows.map(({ item, metrics: m }) => ({
      questionBankItemId: item.id,
      text: item.text,
      language: item.language,
      category: item.category,
      subcategory: item.subcategory,
      isActive: item.isActive,
      metrics: m,
    })),
  }
}

/**
 * Routes by URL rather than by call order: the list, the categories and the
 * effectiveness read come from two separate effects, so a `mockResolvedValueOnce` chain
 * would be asserting on the scheduler.
 *
 * The captured URLs are returned so a test can assert what the page ASKED for, which is
 * the only way to check a server-side filter from here.
 */
function routeFetch(handlers: Array<[RegExp, (url: string) => { body: unknown; status?: number }]>) {
  const calls: string[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    for (const [pattern, handle] of handlers) {
      if (pattern.test(url)) {
        const { body, status = 200 } = handle(url)
        return Promise.resolve(new Response(JSON.stringify(body), { status }))
      }
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  return calls
}

/**
 * The provider is not optional scaffolding: the page reads `useCompanyScope`, which is
 * how a company_admin's own claim and a super_admin's explicit selection are reconciled.
 * In the app `AdminLayout` supplies it, which is why the screenshot rendered while these
 * tests did not.
 */
function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <QuestionBankPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('QuestionBankPage', () => {
  it('shows each question with the metrics behind its response rate', async () => {
    const item = bankRow()
    routeFetch([
      [/\/effectiveness/, () => ({ body: effectivenessFor([{ item, metrics: metrics('q1', 200, 196) }]) })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [item], total: 1 } })],
    ])

    renderPage()

    const row = within(await screen.findByRole('row', { name: /raise a concern/ }))
    // Asked, answered and skipped — not just the percentage. The rate alone cannot tell
    // "everybody skips this" from "nobody has been asked it".
    expect(row.getByText('200')).toBeTruthy()
    expect(row.getByText('98%')).toBeTruthy()
    expect(row.getByText('2%')).toBeTruthy()
  })

  /**
   * The list carries `responseRate` already, so a page could render metrics without the
   * effectiveness read. It must not go blank when that read fails — the corpus is usable
   * without its derivation and unusable without the rows.
   */
  it('still lists the corpus when the effectiveness read fails', async () => {
    const item = bankRow()
    routeFetch([
      [/\/effectiveness/, () => ({ body: { message: 'nope' }, status: 500 })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [item], total: 1 } })],
    ])

    renderPage()

    const row = within(await screen.findByRole('row', { name: /raise a concern/ }))
    // An em dash, never a zero: "we could not measure" is not "we measured none".
    await waitFor(() => expect(row.getAllByText('—').length).toBe(3))
  })

  it('flags a question people skip, once it has been asked enough times', async () => {
    const skipped = bankRow({ id: 'q2', text: 'A question nobody answers' })
    routeFetch([
      [/\/effectiveness/, () => ({ body: effectivenessFor([{ item: skipped, metrics: metrics('q2', 200, 40) }]) })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [skipped], total: 1 } })],
    ])

    renderPage()
    const row = within(await screen.findByRole('row', { name: /nobody answers/ }))
    await waitFor(() => expect(row.getByText('Needs attention')).toBeTruthy())
  })

  /** Four people skipping a question says nothing about the question. */
  it('does not flag a poor rate that rests on too few askings', async () => {
    const barelyAsked = bankRow({ id: 'q3', text: 'Asked only four times' })
    routeFetch([
      [/\/effectiveness/, () => ({ body: effectivenessFor([{ item: barelyAsked, metrics: metrics('q3', 4, 1) }]) })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [barelyAsked], total: 1 } })],
    ])

    renderPage()
    await screen.findByRole('row', { name: /four times/ })
    expect(screen.queryByText('Needs attention')).toBeNull()
  })

  /**
   * A retired question is already dealt with. The screenshot caught this: the badge fired
   * beside "Retired", telling an admin to act on a decision somebody had already taken.
   */
  it('does not flag a retired question, however badly it scored', async () => {
    const retired = bankRow({ id: 'q4', text: 'Rate the canteen', isActive: false })
    routeFetch([
      [/\/effectiveness/, () => ({ body: effectivenessFor([{ item: retired, metrics: metrics('q4', 96, 41) }]) })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [retired], total: 1 } })],
    ])

    renderPage()
    const row = within(await screen.findByRole('row', { name: /canteen/ }))
    expect(row.getByText('Retired')).toBeTruthy()
    expect(screen.queryByText('Needs attention')).toBeNull()
  })

  /**
   * `ListAsync` returns ACTIVE rows only by default, so a curation page that never sends
   * `includeRetired` hides exactly the rows an admin opened it to review.
   */
  it('asks the server for retired rows only once the toggle is on', async () => {
    const item = bankRow()
    const calls = routeFetch([
      [/\/effectiveness/, () => ({ body: { items: [] } })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [item], total: 1 } })],
    ])

    renderPage()
    await screen.findByRole('row', { name: /raise a concern/ })
    expect(calls.some((url) => url.includes('includeRetired'))).toBe(false)

    await userEvent.click(screen.getByRole('switch', { name: 'Show retired' }))
    await waitFor(() => expect(calls.some((url) => url.includes('includeRetired=true'))).toBe(true))
  })

  /**
   * Retirement is the only removal this API offers: an item asked of real respondents has
   * to stay resolvable for as long as their answers do (#106). So the button must reach
   * `/lifecycle` and never DELETE.
   */
  it('retires through the lifecycle route rather than deleting', async () => {
    const item = bankRow()
    const calls = routeFetch([
      [/\/effectiveness/, () => ({ body: { items: [] } })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/lifecycle/, () => ({ body: { id: 'q1', state: 'retired', instantiatedQuestionCount: 3, updatedAt: '' } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [item], total: 1 } })],
    ])

    renderPage()
    const row = within(await screen.findByRole('row', { name: /raise a concern/ }))
    await userEvent.click(row.getByRole('button', { name: 'Retire' }))

    await waitFor(() => expect(calls.some((url) => url.endsWith('/admin/question-bank/q1/lifecycle'))).toBe(true))
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  /**
   * `ranking` is a SURVEY question type and not a repository one — the bank accepts only
   * `ForSurvey ∩ ForMicroclimate`. Offering it would let an author pick a value the create
   * endpoint answers 400 for.
   */
  it('offers only the types the bank accepts, never ranking', async () => {
    routeFetch([
      [/\/effectiveness/, () => ({ body: { items: [] } })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [], total: 0 } })],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New question' }))

    const types = within(screen.getByLabelText('Answer type')).getAllByRole('option')
    const labels = types.map((option) => option.textContent)
    expect(labels).toContain('Likert Scale')
    expect(labels).not.toContain('Ranking')
  })

  it('creates a question scoped to the caller company, never a global row', async () => {
    const calls = routeFetch([
      [/\/effectiveness/, () => ({ body: { items: [] } })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [], total: 0 } })],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New question' }))
    await userEvent.type(screen.getByLabelText('Question text'), 'A new question')
    await userEvent.type(screen.getByLabelText('Category'), 'trust')
    await userEvent.click(screen.getByRole('button', { name: 'Create question' }))

    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        text: 'A new question',
        category: 'trust',
        companyId: OWN,
      })
    })
    expect(calls.length).toBeGreaterThan(0)
  })

  it('says so when the corpus is empty rather than rendering an empty table', async () => {
    routeFetch([
      [/\/effectiveness/, () => ({ body: { items: [] } })],
      [/\/categories/, () => ({ body: { categories: [] } })],
      [/\/admin\/question-bank(\?|$)/, () => ({ body: { items: [], total: 0 } })],
    ])

    renderPage()
    expect(await screen.findByText('No questions in the bank yet')).toBeTruthy()
  })
})
