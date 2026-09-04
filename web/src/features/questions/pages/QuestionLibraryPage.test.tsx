import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import QuestionLibraryPage from './QuestionLibraryPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import type { QuestionCategory, QuestionLibraryItem } from '../api/questionLibrary'
import { tokenFor } from '../../../test/jwtFixture'

const OWN = 'company-1'

function category(overrides: Partial<QuestionCategory> = {}): QuestionCategory {
  return {
    id: 'cat-1',
    companyId: null,
    parentCategoryId: null,
    nameEn: 'Psychological safety',
    nameEs: 'Seguridad psicológica',
    descriptionEn: null,
    descriptionEs: null,
    order: 0,
    icon: null,
    color: null,
    isActive: true,
    itemCount: 1,
    ...overrides,
  }
}

function item(overrides: Partial<QuestionLibraryItem> = {}): QuestionLibraryItem {
  return {
    id: 'q1',
    companyId: null,
    questionCategoryId: 'cat-1',
    textEn: 'I can raise a concern without fear',
    textEs: 'Puedo expresar una preocupación sin temor',
    type: 'likert',
    dimension: 'psychological_safety',
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: ['clima', 'confianza'],
    ...overrides,
  }
}

interface Recorded {
  url: string
  method: string
  body: unknown
}

function routeFetch(
  handlers: Array<[RegExp, (url: string, init?: RequestInit) => { body: unknown; status?: number }]>,
) {
  const calls: Recorded[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    for (const [pattern, handle] of handlers) {
      if (pattern.test(url)) {
        const { body, status = 200 } = handle(url, init)
        return Promise.resolve(new Response(JSON.stringify(body), { status }))
      }
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  return calls
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <QuestionLibraryPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The reads both sections make on mount, with nothing else asserted about them. */
function readHandlers(
  categories: QuestionCategory[],
  items: QuestionLibraryItem[],
): Array<[RegExp, () => { body: unknown }]> {
  return [
    [/\/admin\/question-categories/, () => ({ body: { categories } })],
    [/\/admin\/question-library(\?|$)/, () => ({ body: { items } })],
  ]
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

describe('QuestionLibraryPage', () => {
  it('lists the categories and the questions it loaded', async () => {
    routeFetch(readHandlers([category()], [item()]))
    renderPage()

    // Scoped to a row: the category name also fills three <option> lists on this page.
    const row = await screen.findByRole('row', { name: /raise a concern/ })
    expect(within(row).getByText('I can raise a concern without fear')).toBeTruthy()
    expect(within(row).getByText('Puedo expresar una preocupación sin temor')).toBeTruthy()
    expect(within(row).getByText('Psychological safety')).toBeTruthy()
  })

  /**
   * The guarantee: **neither read may send `companyId`.**
   *
   * Both endpoints answer `CompanyId == companyId` when it is supplied, which excludes
   * the GLOBAL rows — `QuestionLibraryFilters` says so in its own doc comment. An
   * authoring screen that passed its scope through would show a company_admin only their
   * own rows and hide every shared question, which for an instrument loaded globally
   * means showing an empty library and inviting someone to type it in again.
   */
  it('asks for the global rows too, by sending no companyId on either read', async () => {
    const calls = routeFetch(readHandlers([category()], [item()]))
    renderPage()

    await screen.findByRole('row', { name: /raise a concern/ })

    const reads = calls.filter((c) => c.method === 'GET')
    expect(reads.length).toBeGreaterThan(0)
    for (const call of reads) {
      expect(call.url).not.toContain('companyId')
    }
  })

  /**
   * The guarantee: **editing a question must not destroy its tags.**
   *
   * `UpdateItemAsync` does `RemoveRange` over the item's options and tags and re-adds
   * whatever the request carried. The list projection deliberately omits both, so a PUT
   * built from a list row would silently delete every tag on a question that was only
   * being retitled — and tags are what the picker's search matches on besides the two
   * texts, so the loss would surface much later as "that question stopped being findable".
   * The page therefore GETs the detail first and sends the tags back.
   */
  it('loads the full question before editing, and carries its tags back on save', async () => {
    const row = item()
    const calls = routeFetch([
      [
        /\/admin\/question-library\/q1$/,
        () => ({
          body: {
            ...row,
            language: 'en',
            scaleMin: null,
            scaleMax: null,
            scaleLabelMinEn: null,
            scaleLabelMinEs: null,
            scaleLabelMaxEn: null,
            scaleLabelMaxEs: null,
            previousVersionId: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            options: [],
          },
        }),
      ],
      ...readHandlers([category()], [row]),
    ])

    renderPage()
    await screen.findByText('I can raise a concern without fear')

    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])

    // The detail read is the point of the test: without it there is nothing to send back.
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'GET' && /\/question-library\/q1$/.test(c.url))).toBe(
        true,
      )
    })

    await userEvent.click(screen.getByRole('button', { name: 'Save question' }))

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT')
      expect(put).toBeTruthy()
      expect((put!.body as { tags: string[] }).tags).toEqual(['clima', 'confianza'])
    })
  })

  /**
   * Both languages are mandatory on this surface, unlike the bank. The server refuses a
   * blank either side; the page refuses first so the author is told which field is
   * missing instead of meeting a bare 400 — and, asserted here, sends nothing at all.
   */
  it('refuses a category whose Spanish name is only whitespace, and sends no request', async () => {
    const calls = routeFetch(readHandlers([], []))
    renderPage()

    await screen.findByLabelText('Name (English)')
    await userEvent.type(screen.getByLabelText('Name (English)'), 'Belonging')
    // A space, deliberately. `required` on the input is satisfied by it, so this is the
    // case the markup cannot catch and the trim guard exists for -- and the one that
    // would otherwise reach the server and come back as an unexplained 400.
    await userEvent.type(screen.getByLabelText('Name (Spanish)'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Create category' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Both the English and the Spanish text are required.',
    )
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  /**
   * `CompanyId` is immutable after creation and a company_admin may only ever write their
   * own company's rows, so offering them an ownership choice would be offering a control
   * whose only other setting the server refuses.
   */
  it('offers a company admin no ownership choice, and says what they get instead', async () => {
    routeFetch(readHandlers([category()], []))
    renderPage()

    await screen.findByRole('row', { name: /Psychological safety/ })
    expect(screen.queryByLabelText('Ownership')).toBeNull()
    expect(
      screen.getByText(/Everything created here belongs to your company/),
    ).toBeTruthy()
  })
})
