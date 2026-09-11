import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import QuestionBankNextPage from './SuperQuestionBankView'
import RoutedQuestionBankPage from '../QuestionBankNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import type { QuestionBankEffectivenessItem, QuestionBankItem } from '../../api/questionBank'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

const next = en.questionBank.next
const OWN = 'company-1'

function item(overrides: Partial<QuestionBankItem> = {}): QuestionBankItem {
  return {
    id: 'q1',
    companyId: OWN,
    text: 'I feel part of the team',
    language: 'en',
    type: 'likert',
    category: 'Belonging',
    subcategory: null,
    industry: null,
    companySize: null,
    usageCount: 1,
    responseRate: 80,
    insightScore: 0,
    lastUsedAt: null,
    isActive: true,
    isAiGenerated: false,
    version: 1,
    parentQuestionBankItemId: null,
    tags: [],
    ...overrides,
  }
}

function effectiveness(id: string, timesAsked: number, timesAnswered: number): QuestionBankEffectivenessItem {
  return {
    questionBankItemId: id,
    text: null,
    language: 'en',
    category: 'Belonging',
    subcategory: null,
    isActive: true,
    metrics: {
      questionBankItemId: id,
      surveysUsedIn: 1,
      questionsCreated: 1,
      timesAsked,
      timesAnswered,
      responseRate: timesAsked === 0 ? 0 : (timesAnswered / timesAsked) * 100,
      skipRate: timesAsked === 0 ? 0 : ((timesAsked - timesAnswered) / timesAsked) * 100,
      averageTimeSpentSeconds: null,
      lastUsedAt: null,
    },
  }
}

interface Served {
  items: QuestionBankItem[]
  metrics?: QuestionBankEffectivenessItem[] | 'fail'
}

function serve({ items, metrics = [] }: Served) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (init?.method === 'PUT' || init?.method === 'POST') return ok(items[0] ?? {})
    if (url.includes('/admin/question-bank/effectiveness')) {
      return metrics === 'fail' ? Promise.resolve(new Response(null, { status: 500 })) : ok({ items: metrics })
    }
    if (url.includes('/admin/question-bank/categories')) return ok({ categories: [{ category: 'Belonging', subcategory: null, itemCount: 1, activeItemCount: 1 }] })
    if (url.includes('/admin/question-bank')) return ok({ items, total: items.length })
    if (url.includes('/admin/question-categories')) return ok({ categories: [] })
    if (url.includes('/admin/question-library')) return ok({ items: [] })
    if (url.includes('/admin/companies')) {
      return ok({ companies: [{ id: 'acme', name: 'Acme Corporation', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] })
    }
    if (url.includes('/profile')) return ok({ companyName: 'Meridiano' })
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <QuestionBankNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function rowOf(id: string): HTMLElement {
  return document.querySelector(`tr[data-bank-item="${id}"]`) as HTMLElement
}

function requests(method: string, pattern: RegExp) {
  return vi.mocked(fetch).mock.calls.filter(([input, init]) => (init?.method ?? 'GET') === method && pattern.test(String(input)))
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
})

afterEach(() => {
  cleanup()
  clearToken()
  clearCompanyNameCache()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('QuestionBankNextPage (the old page\'s guarantees, on the redesigned screen)', () => {
  it('shows each question with how often it was asked, answered and skipped', async () => {
    serve({ items: [item()], metrics: [effectiveness('q1', 40, 30)] })
    renderPage()
    const row = await waitFor(() => {
      const found = rowOf('q1')
      expect(within(found).getByText('40')).toBeTruthy()
      return found
    })
    expect(within(row).getByText('30')).toBeTruthy()
    expect(within(row).getByText('10')).toBeTruthy()
  })

  it('still lists the corpus when the effectiveness read fails — dashes, never zeros', async () => {
    serve({ items: [item()], metrics: 'fail' })
    renderPage()
    await screen.findByText('I feel part of the team')
    expect(within(rowOf('q1')).getAllByText('—')).toHaveLength(3)
    expect(within(rowOf('q1')).queryByText('0')).toBeNull()
  })

  it('flags a question people skip once it has been asked enough times', async () => {
    serve({ items: [item()], metrics: [effectiveness('q1', 40, 10)] })
    renderPage()
    expect(await screen.findByText(en.questionBank.needsAttention)).toBeTruthy()
  })

  it('asks the server for retired rows only once the toggle is on', async () => {
    serve({ items: [item()] })
    renderPage()
    await screen.findByText('I feel part of the team')
    expect(requests('GET', /includeRetired=true/)).toHaveLength(0)
    await userEvent.click(screen.getByRole('switch', { name: next.showRetired }))
    await waitFor(() => expect(requests('GET', /\/admin\/question-bank\?.*includeRetired=true/).length).toBeGreaterThan(0))
  })

  it('retires through the lifecycle route rather than deleting', async () => {
    serve({ items: [item()] })
    renderPage()
    await screen.findByText('I feel part of the team')
    await userEvent.click(screen.getByRole('button', { name: next.rowActions.replace('{text}', 'I feel part of the team') }))
    await userEvent.click(await screen.findByRole('menuitem', { name: en.questionBank.retire }))
    await waitFor(() => expect(requests('PUT', /\/admin\/question-bank\/q1\/lifecycle$/)).toHaveLength(1))
    expect(JSON.parse(String(requests('PUT', /lifecycle$/)[0][1]?.body))).toEqual({ state: 'retired' })
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('offers only the types the bank accepts, never ranking', async () => {
    serve({ items: [item()] })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: next.newQuestion }))
    const typeSelect = screen.getByRole('combobox', { name: en.questionBank.typeLabel })
    const values = [...typeSelect.querySelectorAll('option')].map((option) => option.getAttribute('value'))
    expect(values).toEqual(['likert', 'multiple_choice', 'open_ended', 'rating', 'yes_no'])
  })

  it('creates a question scoped to the caller company, never a global row', async () => {
    serve({ items: [item()] })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: next.newQuestion }))
    await userEvent.type(screen.getByRole('textbox', { name: en.questionBank.textLabel }), 'New one')
    await userEvent.type(screen.getByRole('textbox', { name: en.questionBank.categoryLabel }), 'Belonging')
    await userEvent.click(screen.getByRole('button', { name: en.questionBank.createQuestion }))
    await waitFor(() => expect(requests('POST', /\/admin\/question-bank$/)).toHaveLength(1))
    expect(JSON.parse(String(requests('POST', /\/admin\/question-bank$/)[0][1]?.body))).toMatchObject({ companyId: OWN, text: 'New one' })
  })

  it('says what fills the bank when it is empty, rather than rendering an empty table', async () => {
    serve({ items: [] })
    renderPage()
    expect(await screen.findByText(next.emptyTitle)).toBeTruthy()
    expect(screen.getByText(next.emptyBody)).toBeTruthy()
  })
})

describe('QuestionBankNextPage — owners and roles', () => {
  it('offers a company administrator no Edit and no Retire on a global row, and both on their own', async () => {
    serve({ items: [item({ id: 'global', companyId: null, text: 'Global row' }), item({ id: 'own', text: 'Own row' })] })
    renderPage()
    await screen.findByText('Global row')
    expect(within(rowOf('global')).queryByRole('button')).toBeNull()
    expect(within(rowOf('own')).getByRole('button', { name: next.rowActions.replace('{text}', 'Own row') })).toBeTruthy()
    expect(within(rowOf('global')).getByText(next.ownerGlobalChip)).toBeTruthy()
  })

  it('names each row\'s company for a super administrator, and the owner filter narrows to one', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    serve({ items: [item({ id: 'global', companyId: null, text: 'Global row' }), item({ id: 'acme-row', companyId: 'acme', text: 'Acme row' })] })
    renderPage()
    await waitFor(() => expect(within(rowOf('acme-row')).getByText('Acme Corporation')).toBeTruthy())
    await userEvent.selectOptions(screen.getByRole('combobox', { name: next.colOwner }), 'acme')
    expect(rowOf('global')).toBeNull()
    expect(rowOf('acme-row')).toBeTruthy()
  })
})

// `/admin/question-bank` mounts #472's company page; its one role branch sends the super
// administrator here. Rendered through the routed component, so breaking the branch fails.
describe('the route dispatches by role', () => {
  function renderRoute() {
    return render(
      <TranslationProvider>
        <MemoryRouter>
          <CompanyContextProvider>
            <RoutedQuestionBankPage />
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  it('gives a super administrator this view, where each row names its owner', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    serve({ items: [item({ id: 'acme-row', companyId: 'acme', text: 'Acme row' })] })
    renderRoute()
    await waitFor(() => expect(within(rowOf('acme-row')).getByText('Acme Corporation')).toBeTruthy())
  })

  it('gives a company administrator the company page, never this view', async () => {
    serve({ items: [item({ id: 'own', text: 'Own row' })] })
    renderRoute()
    expect(await screen.findByText(next.splitTitle)).toBeTruthy()
    await screen.findByText('Own row')
    expect(rowOf('own')).toBeNull()
  })
})
