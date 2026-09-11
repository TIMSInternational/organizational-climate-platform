import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import AIInsightsNextPage from './AIInsightsNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import type { AIInsight, AIInsightListItem } from '../../api/insights'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'
import es from '../../../../i18n/es.json'

const copy = en.insights
const next = en.insights.next
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

type Handler = [RegExp, (init?: RequestInit) => Response]

function routeFetch(handlers: Handler[]) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [pattern, respond] of handlers) {
      if (pattern.test(url)) return Promise.resolve(respond(init))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status })

function renderPage(locale: 'en' | 'es' = 'en') {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <AIInsightsNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function calls(pattern: RegExp): string[] {
  return vi.mocked(fetch).mock.calls.map(([input]) => String(input)).filter((url) => pattern.test(url))
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('AIInsightsNextPage — degradation (moved from AIInsightsPage)', () => {
  it('shows an empty state when the API answers 200 with no insights', async () => {
    routeFetch([[/\/admin\/ai-insights\?companyId=/, json([])]])
    renderPage()
    expect(await screen.findByText(copy.noInsights)).toBeTruthy()
  })

  it('shows an error with a retry, NOT an empty state, when the endpoint is absent — and retries', async () => {
    routeFetch([])
    renderPage()
    expect(await screen.findByText(copy.loadFailed)).toBeTruthy()
    expect(screen.queryByText(copy.noInsights)).toBeNull()
    routeFetch([[/\/admin\/ai-insights\?companyId=/, json([])]])
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByText(copy.noInsights)).toBeTruthy()
  })
})

describe('AIInsightsNextPage — whose findings (moved and extended)', () => {
  it('asks a super administrator to choose, and never guesses a company', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: OWN }))
    routeFetch([
      [/\/admin\/companies/, json({ companies: [{ id: 'acme', name: 'Acme Corporation', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] })],
      [/\/surveys/, json({ surveys: [] })],
      [/\/admin\/ai-insights\?companyId=acme/, json([listRow({ companyId: 'acme', isAcknowledged: true })])],
    ])
    renderPage()
    expect(await screen.findByRole('heading', { name: next.chooseTitle })).toBeTruthy()
    // The strip's select lists the company too, so the pick row is found by its id.
    const row = await waitFor(() => {
      const found = document.querySelector('[data-company-id="acme"]') as HTMLElement | null
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    await waitFor(() => expect(within(row).getByText(next.pickAllOne)).toBeTruthy())
    expect(within(row).getByText('Acme Corporation')).toBeTruthy()
    // Only the companies the platform listed are read — never the super administrator's own claim.
    expect(calls(new RegExp(`companyId=${OWN}`))).toEqual([])
    expect(document.querySelector('[data-slot="insight-tiles"]')).toBeNull()
  })

  it('reads the company a super administrator chooses on the card', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    routeFetch([
      [/\/admin\/companies/, json({ companies: [{ id: 'acme', name: 'Acme Corporation', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] })],
      [/\/surveys/, json({ surveys: [] })],
      [/\/admin\/ai-insights\/i1$/, json(insightDetail({ companyId: 'acme' }))],
      [/\/admin\/ai-insights\?companyId=acme/, json([listRow({ companyId: 'acme' })])],
    ])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: next.chooseNamed.replace('{name}', 'Acme Corporation') }))
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('acme')
    expect(await screen.findByRole('heading', { name: 'Engagement is falling in Support' })).toBeTruthy()
  })

  it('still refuses to guess for a company administrator whose token names no tenant', async () => {
    setToken(tokenFor({ role: 'company_admin' }))
    routeFetch([])
    renderPage()
    expect(await screen.findByText(en.common.noCompanyAssociated)).toBeTruthy()
    expect(calls(/ai-insights/)).toEqual([])
  })

  it('tells a leader the page is for administrators and makes no request it would be refused', async () => {
    setToken(tokenFor({ role: 'leader', companyId: OWN, sub: 'u9', nodoId: 'n1' }))
    routeFetch([])
    renderPage()
    expect(await screen.findByText(next.notForRole)).toBeTruthy()
    expect(calls(/ai-insights/)).toEqual([])
  })
})

describe('AIInsightsNextPage — reading and acknowledging (moved and extended)', () => {
  it('counts to review, high priority and reviewed from the rows it has', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, json(insightDetail())],
      [/\/admin\/ai-insights\/i2$/, json(insightDetail({ id: 'i2', priority: 'critical' }))],
      [/\/admin\/ai-insights\/i3$/, json(insightDetail({ id: 'i3', priority: 'low', isAcknowledged: true }))],
      [
        /\/admin\/ai-insights\?companyId=/,
        json([listRow(), listRow({ id: 'i2', priority: 'critical', title: 'Two' }), listRow({ id: 'i3', priority: 'low', isAcknowledged: true, title: 'Three' })]),
      ],
    ])
    renderPage()
    await screen.findByText('Two')
    const tiles = document.querySelector('[data-slot="insight-tiles"]') as HTMLElement
    const values = [...tiles.querySelectorAll('[data-slot="kpi-value"]')].map((node) => node.textContent)
    expect(values).toEqual(['2', '2', '1'])
    expect(within(tiles).getByText(next.criticalOne)).toBeTruthy()
  })

  it('acknowledges the open finding and attributes it to a named person with a date', async () => {
    let acknowledged = false
    routeFetch([
      [/\/acknowledge$/, () => { acknowledged = true; return new Response(JSON.stringify(insightDetail({ isAcknowledged: true, acknowledgedBy: 'u1', acknowledgedAt: '2026-08-13T15:00:00Z' })), { status: 200 }) }],
      [/\/admin\/users\/u1$/, json({ id: 'u1', name: 'Ana Admin', email: 'a@x.test', role: 'company_admin', departmentId: null, isActive: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z', companyId: OWN, managerId: null })],
      [/\/admin\/ai-insights\/i1$/, () => new Response(JSON.stringify(acknowledged ? insightDetail({ isAcknowledged: true, acknowledgedBy: 'u1', acknowledgedAt: '2026-08-13T15:00:00Z' }) : insightDetail()), { status: 200 })],
      [/\/admin\/ai-insights\?companyId=/, () => new Response(JSON.stringify([listRow({ isAcknowledged: acknowledged })]), { status: 200 })],
    ])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: copy.acknowledge }))
    const line = await screen.findByText(/Ana Admin/, { selector: '[data-slot="acknowledged-line"]' })
    expect(line.textContent).toMatch(/2026/)
    expect(screen.queryByRole('button', { name: copy.acknowledge })).toBeNull()
  })

  it('falls back to wording rather than printing a raw user id when the lookup is refused', async () => {
    routeFetch([
      [/\/admin\/users\//, () => new Response(null, { status: 403 })],
      [/\/admin\/ai-insights\/i1$/, json(insightDetail({ isAcknowledged: true, acknowledgedBy: 'u-raw-id', acknowledgedAt: '2026-08-13T15:00:00Z' }))],
      [/\/admin\/ai-insights\?companyId=/, json([listRow({ isAcknowledged: true })])],
    ])
    renderPage()
    const line = await screen.findByText(new RegExp(copy.unknownUser), { selector: '[data-slot="acknowledged-line"]' })
    expect(line.textContent).not.toContain('u-raw-id')
  })

  it('does not claim a date it was not given', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, json(insightDetail({ isAcknowledged: true }))],
      [/\/admin\/ai-insights\?companyId=/, json([listRow({ isAcknowledged: true })])],
    ])
    renderPage()
    expect(await screen.findByText(copy.acknowledgedUnattributed)).toBeTruthy()
    expect(screen.getByText(next.ackUndated)).toBeTruthy()
  })

  it('surfaces a failed acknowledgement instead of showing it as done', async () => {
    routeFetch([
      [/\/acknowledge$/, () => new Response(JSON.stringify({ message: 'nope' }), { status: 500 })],
      [/\/admin\/ai-insights\/i1$/, json(insightDetail())],
      [/\/admin\/ai-insights\?companyId=/, json([listRow()])],
    ])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: copy.acknowledge }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.acknowledge })).toBeTruthy()
  })

  it('states the confidence as a labelled reading, and the segment and date on the row', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, json(insightDetail({ isAcknowledged: true, acknowledgedAt: '2026-08-13T15:00:00Z' }))],
      [/\/admin\/ai-insights\?companyId=/, json([listRow({ isAcknowledged: true })])],
    ])
    renderPage()
    const card = await screen.findByRole('button', { pressed: true })
    await waitFor(() => expect(card.textContent).toContain(next.confidence.replace('{score}', '82')))
    expect(card.textContent).toContain('Support')
  })

  it('renders the type and priority in Spanish, and an unrecognised value verbatim rather than blank', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, json(insightDetail())],
      [/\/admin\/ai-insights\/i2$/, json(insightDetail({ id: 'i2', type: 'omen', priority: 'urgent' }))],
      [/\/admin\/ai-insights\?companyId=/, json([listRow(), listRow({ id: 'i2', type: 'omen', priority: 'urgent', title: 'Otra' })])],
    ])
    renderPage('es')
    const first = await screen.findByText('Engagement is falling in Support', { selector: '[data-slot="insight-card"] span' })
    const card = first.closest('[data-slot="insight-card"]') as HTMLElement
    expect(within(card).getByText(es.insights.typeRisk)).toBeTruthy()
    const other = screen.getByText('Otra').closest('[data-slot="insight-card"]') as HTMLElement
    expect(within(other).getByText('omen')).toBeTruthy()
    expect(within(other).getByText('urgent')).toBeTruthy()
  })
})
