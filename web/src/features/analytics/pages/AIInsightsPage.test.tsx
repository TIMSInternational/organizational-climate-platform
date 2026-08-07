import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import AIInsightsPage from './AIInsightsPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import {
  CompanyContextProvider,
  COMPANY_CONTEXT_STORAGE_KEY,
} from '../../../company-context'
import type { AIInsight, AIInsightListItem } from '../api/insights'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const OWN = 'company-1'

function listRow(overrides: Partial<AIInsightListItem> = {}): AIInsightListItem {
  return {
    id: 'i1',
    companyId: OWN,
    type: 'risk',
    category: 'engagement',
    title: 'Engagement is falling in Support',
    priority: 'high',
    isAcknowledged: false,
    ...overrides,
  }
}

function insightDetail(overrides: Partial<AIInsight> = {}): AIInsight {
  return {
    id: 'i1',
    surveyId: null,
    companyId: OWN,
    departmentId: null,
    type: 'risk',
    category: 'engagement',
    title: 'Engagement is falling in Support',
    description: 'Scores dropped 12 points quarter over quarter.',
    confidenceScore: 82,
    priority: 'high',
    affectedSegments: ['Support'],
    recommendedActions: ['Run a focus group'],
    isAcknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...overrides,
  }
}

// #124: the page's company no longer comes from the JWT claim it reads itself, it
// comes from `useCompanyScope()`. The provider is what `AdminLayout` mounts around
// every routed page, so it has to be here too -- the hook throws outside one
// rather than silently defaulting, on purpose.
function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <AIInsightsPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function routeFetch(handlers: Array<[RegExp, () => unknown]>) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    for (const [pattern, body] of handlers) {
      if (pattern.test(url)) return Promise.resolve(new Response(JSON.stringify(body()), { status: 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('AIInsightsPage degradation', () => {
  it('shows an empty state when the API answers 200 with no insights', async () => {
    routeFetch([[/\/admin\/ai-insights(\?|$)/, () => []]])

    renderPage()

    expect(await screen.findByText('No insights yet')).toBeTruthy()
    expect(screen.queryByText('The insights could not be loaded.')).toBeNull()
  })

  /**
   * The distinction this page exists to keep straight. `/admin/ai-insights` is
   * not mapped on `main` — #86 is open — so every request 404s today. Rendering
   * that as an empty list would tell an admin their company has no findings, when
   * in fact the feature is not deployed.
   */
  it('shows an error with a retry, NOT an empty state, when the endpoint is absent', async () => {
    // No handler matches, so `routeFetch` answers 404 — exactly what an unmapped
    // route does today.
    routeFetch([])

    renderPage()

    expect(await screen.findByText('The insights could not be loaded.')).toBeTruthy()
    expect(screen.queryByText('No insights yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('retries the list when asked', async () => {
    routeFetch([])
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      const listCalls = vi.mocked(fetch).mock.calls.filter((call) => /ai-insights\?/.test(String(call[0])))
      expect(listCalls.length).toBeGreaterThan(1)
    })
  })

  it('refuses to guess a company for a super_admin who has selected none', async () => {
    // This used to assert an `alert` reading "no company associated", which was the
    // only thing the page could say: since #191 a global super_admin's companyId
    // claim is `''`, so `navSections.ts` did not even offer this page to the role.
    // #124 turns the dead end into a question. What has NOT changed, and is the
    // point of the test, is that no company is chosen on their behalf and no
    // request goes out.
    clearToken()
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    routeFetch([[/\/admin\/ai-insights(\?|$)/, () => [listRow()]]])

    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('never falls back to a super_admin\'s own companyId claim', async () => {
    // A super_admin whose user row does point at a company. Before #124 the page
    // would have used it -- silently showing one tenant's findings as though they
    // were a platform-wide view.
    clearToken()
    setToken(tokenFor({ role: 'super_admin', companyId: 'their-own-row' }))
    routeFetch([[/\/admin\/ai-insights(\?|$)/, () => [listRow()]]])

    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('loads the company a super_admin selected, and asks the API for that one', async () => {
    clearToken()
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'chosen-co')
    routeFetch([[/\/admin\/ai-insights(\?|$)/, () => [listRow({ companyId: 'chosen-co' })]]])

    renderPage()

    expect(await screen.findByText('Engagement is falling in Support')).toBeTruthy()
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('companyId=chosen-co'))).toBe(true)
  })

  it('still refuses to guess for a company_admin whose token names no tenant', async () => {
    // The other empty state, kept distinct: there is nothing for this role to pick
    // from, so "choose a company" would be a dead end. `GET /admin/companies` is
    // SuperAdmin-only.
    clearToken()
    setToken(tokenFor({ role: 'company_admin', companyId: '' }))
    routeFetch([[/\/admin\/ai-insights(\?|$)/, () => [listRow()]]])

    renderPage()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

describe('AIInsightsPage acknowledgement', () => {
  it('acknowledges an insight and attributes it to a named user with a date', async () => {
    let acknowledged = false
    routeFetch([
      [/\/admin\/users\/u-7$/, () => ({ id: 'u-7', email: 'ana@acme.com', name: 'Ana Rojas', role: 'company_admin', departmentId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z', companyId: OWN, managerId: null })],
      [
        /\/admin\/ai-insights\/i1\/acknowledge$/,
        () => {
          acknowledged = true
          return insightDetail({ isAcknowledged: true, acknowledgedBy: 'u-7', acknowledgedAt: '2026-08-05T14:30:00Z' })
        },
      ],
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: acknowledged })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: acknowledged })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'View Details' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(await screen.findByText(/Acknowledged by Ana Rojas on/)).toBeTruthy()
  })

  it('falls back to wording rather than printing a raw user id when the lookup is refused', async () => {
    routeFetch([
      // No /admin/users handler: a CompanyAdmin can legitimately be refused a
      // read on an acknowledger outside their tenant.
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: true, acknowledgedBy: 'u-9', acknowledgedAt: '2026-08-05T14:30:00Z' })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: true })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'View Details' }))

    expect(await screen.findByText(/Acknowledged by an unknown user on/)).toBeTruthy()
    expect(screen.queryByText(/u-9/)).toBeNull()
  })

  it('does not claim a date it was not given', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: true, acknowledgedBy: null, acknowledgedAt: null })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: true })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'View Details' }))

    expect(await screen.findByText(/did not record who or when/)).toBeTruthy()
  })

  it('offers no acknowledge button on an already-acknowledged insight', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: true, acknowledgedBy: null, acknowledgedAt: '2026-08-05T14:30:00Z' })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: true })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'View Details' }))

    await screen.findByRole('heading', { name: 'Engagement is falling in Support', level: 2 })
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull()
  })

  it('surfaces a failed acknowledgement instead of showing it as done', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }))
      }
      if (/\/admin\/ai-insights\/i1$/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify(insightDetail()), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([listRow()]), { status: 200 }))
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'View Details' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy()
  })
})
