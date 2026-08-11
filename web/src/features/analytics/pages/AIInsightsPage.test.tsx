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
function renderPage(locale: 'en' | 'es' = 'en') {
  return render(
    <TranslationProvider initialLocale={locale}>
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

describe('AIInsightsPage headline counts', () => {
  /**
   * The three tiles are counted from the list on screen, not fetched, so this
   * asserts they agree with the cards under them. `priority` is matched against
   * the stored value `critical` — the label is "Critical" with a capital, and a
   * count written against the label would silently read zero.
   */
  it('counts open, critical and acknowledged from the rows it has', async () => {
    routeFetch([
      [
        /\/admin\/ai-insights(\?|$)/,
        () => [
          listRow({ id: 'a', title: 'A', priority: 'critical', isAcknowledged: false }),
          listRow({ id: 'b', title: 'B', priority: 'critical', isAcknowledged: true }),
          listRow({ id: 'c', title: 'C', priority: 'high', isAcknowledged: false }),
          listRow({ id: 'd', title: 'D', priority: 'low', isAcknowledged: false }),
        ],
      ],
    ])

    const { container } = renderPage()
    await screen.findByText('A')

    // Through `data-slot`, not through the label text: "Open" and "Critical" are
    // also badges on the cards below, so `getByText('Open')` would be ambiguous
    // and could pass by matching a card.
    const tiles = [...container.querySelectorAll('[data-slot="kpi-tile"]')].map(
      (tile) => tile.textContent,
    )
    expect(tiles).toEqual(['Open3', 'Critical2', 'Acknowledged1'])
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
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(await screen.findByText(/Acknowledged by Ana Rojas on/)).toBeTruthy()
  })

  /**
   * `confidenceScore` is an integer 0-100 on the entity, so it is already a
   * percentage: `formatMetric`'s percentage kind would divide by 100 and print
   * "0 %". The word has to be beside it too — a bare 82 is not a confidence.
   */
  it('states the model confidence as a labelled reading', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ confidenceScore: 82 })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow()]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))

    const panel = (await screen.findByRole('heading', { level: 2 })).closest('section')!
    expect(panel.textContent).toContain('Confidence')
    expect(panel.textContent).toContain('82%')
    expect(panel.textContent).not.toContain('0%')
  })

  it('falls back to wording rather than printing a raw user id when the lookup is refused', async () => {
    routeFetch([
      // No /admin/users handler: a CompanyAdmin can legitimately be refused a
      // read on an acknowledger outside their tenant.
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: true, acknowledgedBy: 'u-9', acknowledgedAt: '2026-08-05T14:30:00Z' })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: true })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))

    expect(await screen.findByText(/Acknowledged by an unknown user on/)).toBeTruthy()
    expect(screen.queryByText(/u-9/)).toBeNull()
  })

  it('does not claim a date it was not given', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: true, acknowledgedBy: null, acknowledgedAt: null })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: true })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))

    expect(await screen.findByText(/did not record who or when/)).toBeTruthy()
  })

  it('offers no acknowledge button on an already-acknowledged insight', async () => {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail({ isAcknowledged: true, acknowledgedBy: null, acknowledgedAt: '2026-08-05T14:30:00Z' })],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow({ isAcknowledged: true })]],
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))

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
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))

    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy()
  })
})

/**
 * #282. Found by rendering this page in real Chrome under `preferredLocale=es`: the
 * column headers translated, Status translated (`Open` → `Abierto`), and Type and
 * Priority sat in the same row still reading `risk` and `high`. These assert the
 * whole row rather than the helper, because the helper being right is not what was
 * broken — the components were not calling one.
 */
describe('AIInsightsPage vocabulary', () => {
  function insightRoutes(overrides: Partial<AIInsightListItem> = {}, detail: Partial<AIInsight> = {}) {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail(detail)],
      [/\/admin\/ai-insights(\?|$)/, () => [listRow(overrides)]],
    ])
  }

  it('renders the type and priority in Spanish in the list', async () => {
    insightRoutes()

    renderPage('es')

    // The list is a column of cards now, so the unit is the card rather than a
    // `<tr>`. The regression it guards is identical: the stored values leaking
    // into a Spanish page, on the same surface, in the same place.
    const card = (await screen.findByText('Engagement is falling in Support')).closest('button')!
    expect(card.textContent).toContain('Riesgo')
    expect(card.textContent).toContain('Alta')
    expect(card.textContent).not.toContain('risk')
    expect(card.textContent).not.toContain('high')
  })

  it('renders the type and priority in Spanish on the detail panel too', async () => {
    insightRoutes()

    renderPage('es')
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))

    const panel = (await screen.findByRole('heading', { level: 2 })).closest('section')!
    expect(panel.textContent).toContain('Riesgo')
    expect(panel.textContent).toContain('Alta')
    expect(panel.textContent).not.toContain('risk')
    expect(panel.textContent).not.toContain('high')
  })

  it('renders the type and priority in English when the locale is English', async () => {
    insightRoutes()

    renderPage('en')

    const card = (await screen.findByText('Engagement is falling in Support')).closest('button')!
    expect(card.textContent).toContain('Risk')
    expect(card.textContent).toContain('High')
  })

  /**
   * AC #3. `AIInsightValidation` bounds these two columns at "non-empty, ≤ 20
   * characters" and nothing more, so the wire can carry a value outside the legacy
   * enum. It must show through, not vanish and not print a key path.
   */
  it('shows an unrecognised type and priority verbatim rather than blank', async () => {
    insightRoutes({ type: 'anomaly', priority: 'urgent' })

    renderPage('es')

    const card = (await screen.findByText('Engagement is falling in Support')).closest('button')!
    expect(card.textContent).toContain('anomaly')
    expect(card.textContent).toContain('urgent')
    expect(card.textContent).not.toContain('insights.type')
    expect(card.textContent).not.toContain('actionPlans.')
  })

  /**
   * The second half of #282: the first column was headed "Label" — `common.label`,
   * the generic word for a form field's caption — for what `AIInsightListItem`
   * calls `title`.
   *
   * There are no column headers to check now that the list is cards, so this
   * asserts the thing the heading was standing in for: the card's own accessible
   * name is the finding, and no generic caption stands between the reader and it.
   * A card that opened behind a ninth "View Details" would fail this.
   */
  it('names each card after the finding, not after a generic caption', async () => {
    insightRoutes()

    renderPage('es')

    const cards = await screen.findAllByRole('button')
    const names = cards.map((card) => card.textContent ?? '')
    expect(names.some((name) => name.includes('Engagement is falling in Support'))).toBe(true)
    expect(names).not.toContain('Ver Detalles')
    expect(names).not.toContain('Etiqueta')
  })

  it('names each card after the finding in English too', async () => {
    insightRoutes()

    renderPage('en')

    const cards = await screen.findAllByRole('button')
    const names = cards.map((card) => card.textContent ?? '')
    expect(names.some((name) => name.includes('Engagement is falling in Support'))).toBe(true)
    expect(names).not.toContain('View Details')
    expect(names).not.toContain('Label')
  })
})

/**
 * The card is the only control on this screen and the only way into an insight,
 * so both of its states owe the reader something visible. happy-dom does no
 * layout and computes no cascade, so these assert the CLASSES — which is all this
 * environment can see. The measured values behind each class are in
 * `InsightList.tsx`'s header, and were taken off the rendered page in Chromium in
 * both themes.
 */
describe('AIInsightsPage card states', () => {
  function twoInsights() {
    routeFetch([
      [/\/admin\/ai-insights\/i1$/, () => insightDetail()],
      [
        /\/admin\/ai-insights(\?|$)/,
        () => [listRow(), listRow({ id: 'i2', title: 'Workload is heaviest in Operations' })],
      ],
    ])
  }

  /** Returns the insight cards, never the pagination or acknowledge buttons. */
  async function insightCards(): Promise<HTMLElement[]> {
    const first = await screen.findByRole('button', { name: /Engagement is falling in Support/ })
    const list = first.closest('ul')!
    return [...list.querySelectorAll('li > button')] as HTMLElement[]
  }

  /**
   * The regression this pins. The `<button>` the redesign replaced inherited
   * index.css's `button:hover:not(:disabled)`, but that rule is in `@layer base`
   * and the card's own fill is a `@layer utilities` class, which wins on layer
   * order — so the rewrite silently shipped a card that did not answer the
   * pointer at all. Measured in Chromium with the pointer over the third card:
   * hovered and un-hovered returned identical background and border.
   */
  it('gives every card a hover tint over its own fill', async () => {
    twoInsights()

    renderPage()

    const cards = await insightCards()
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.className).toContain('group')
      const overlay = card.querySelector(':scope > span[aria-hidden="true"]')!
      expect(overlay.className).toContain('group-hover:bg-state-hover')
      // Over the card's own fill, not over the page: `inset-0` on a layer inside
      // the card is what makes the translucent token composite correctly.
      expect(overlay.className).toContain('absolute')
      expect(overlay.className).toContain('inset-0')
      expect(overlay.className).toContain('pointer-events-none')
    }
  })

  /**
   * Dark mode is where the first attempt failed: `bg-surface-panel` against
   * `bg-surface-icon-box` is 1.25:1, `border-line-hover` against the neighbouring
   * cards is 1.47:1, and `shadow-sm` is `rgba(0,0,0,.4)` on a near-black ground.
   * WCAG 1.4.11 asks 3:1 of a state indicator. `border-accent-blue` measures
   * 3.74:1 light / 7.20:1 dark on the surface it encloses, and 3.29:1 / 5.77:1
   * against the closed cards beside it.
   */
  it('marks the open card with the accent border, and only that card', async () => {
    twoInsights()

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Engagement is falling in Support/ }))
    await screen.findByRole('heading', { name: 'Engagement is falling in Support', level: 2 })

    const [open, closed] = await insightCards()
    expect(open.getAttribute('aria-current')).toBe('true')
    expect(open.className).toContain('border-accent-blue')
    expect(closed.getAttribute('aria-current')).toBeNull()
    expect(closed.className).not.toContain('border-accent-blue')
    // The three cues that could not be seen in dark, gone.
    expect(open.className).not.toContain('shadow-sm')
    expect(open.className).not.toContain('border-line-hover')
    // Both cards carry the same border WIDTH, so opening one cannot shift the
    // column sideways by the pixel a 1px -> 2px swap would cost.
    expect(open.className).toContain('border-2')
    expect(closed.className).toContain('border-2')
  })
})
