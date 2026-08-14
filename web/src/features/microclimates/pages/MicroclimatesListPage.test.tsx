import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import MicroclimatesListPage from './MicroclimatesListPage'
import type { Microclimate } from '../api/microclimates'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'

/**
 * The redesigned listing surface: the KPI strip, the live panel and the rule that
 * both read the *unfiltered* set.
 *
 * That last one is the assertion worth having. The strip and the panel are drawn
 * from `microclimates`, not from `filtered`, and nothing but a test says so — a
 * strip wired to the filtered array still renders four plausible numbers, which is
 * exactly how a wrong one survives review.
 */
function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

function session(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm1',
    title: 'Ops all-hands',
    companyId: 'their-co',
    status: 'active',
    language: 'en',
    responseCount: 31,
    targetParticipantCount: 48,
    createdAt: '2026-08-11T09:00:00Z',
    ...overrides,
  }
}

const SESSIONS = [
  session({ id: 'live', status: 'active', responseCount: 31 }),
  session({ id: 'shut', title: 'Engineering retro', status: 'closed', responseCount: 51 }),
  session({ id: 'unopened', title: 'People pulse', status: 'draft', responseCount: 0 }),
]

function routeSessions(sessions: Microclimate[]) {
  vi.mocked(fetch).mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ microclimates: sessions }), { status: 200 })),
  )
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <MicroclimatesListPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'company_admin', companyId: 'their-co' }))
  routeSessions(SESSIONS)
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

/**
 * The tile whose label is `label`, so a reading can be asserted against its own
 * name rather than against "some 1 on the page".
 *
 * Matched on the label element specifically -- `Closed` is also a status badge in
 * the table and an option in the filter, so a bare `getByText` finds three.
 */
function tile(label: string): HTMLElement {
  const heading = screen
    .getAllByText(label)
    .find((node) => node.className.includes('tracking-label'))
  if (!heading?.parentElement) throw new Error(`no KPI tile labelled ${label}`)
  return heading.parentElement
}

describe('MicroclimatesListPage strip and live panel', () => {
  it('counts each status and totals the responses across every session', async () => {
    renderPage()
    await screen.findByText('Engineering retro')

    expect(within(tile('Live now')).getByText('1')).toBeTruthy()
    expect(within(tile('Drafts')).getByText('1')).toBeTruthy()
    expect(within(tile('Closed')).getByText('1')).toBeTruthy()
    expect(within(tile('Responses collected')).getByText('82')).toBeTruthy()
  })

  it('features the open session above the table, with its own count', async () => {
    renderPage()
    await screen.findByText('Open right now')

    const live = screen.getByRole('link', { name: 'View Live' })
    expect(live.getAttribute('href')).toBe('/microclimates/live/live')
  })

  it('keeps the strip and the live panel on the whole company while the table is filtered', async () => {
    // The filter narrows the table. A strip that moved with it would be describing
    // the filter rather than the company, and the panel answers "is anything open
    // right now" -- a question the filter does not get a vote on.
    renderPage()
    await screen.findByText('Engineering retro')

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'Closed' }))

    // The table now holds only the closed one...
    const table = within(screen.getByRole('table'))
    expect(table.queryByText('People pulse')).toBeNull()
    expect(table.getByText('Engineering retro')).toBeTruthy()

    // ...and the readings above it have not moved.
    expect(within(tile('Live now')).getByText('1')).toBeTruthy()
    expect(within(tile('Drafts')).getByText('1')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View Live' })).toBeTruthy()
  })

  it('says nothing is open when every session has closed', async () => {
    routeSessions([session({ id: 'shut', status: 'closed' })])
    renderPage()

    expect(await screen.findByText('Nothing is open right now')).toBeTruthy()
  })

  it('names the anonymity floor in the header rather than hardcoding a number in the copy', async () => {
    renderPage()

    expect(
      await screen.findByText(/stay anonymous at the same floor of 5\./),
    ).toBeTruthy()
  })
})

describe('the curated page eyebrow', () => {
  /**
   * The approved design gives this screen the eyebrow "Live sessions". Left to itself
   * `PageTopBar` derives the NAV SECTION instead, which can only ever be one of three
   * words ("Administration", "Workspace", "Communication") — so the design's curated
   * label is a prop the page has to pass, and deleting that prop is completely silent:
   * every other test in this file still passed with it removed. Hence this one.
   */
  it('names the design’s section, not the nav section', () => {
    renderPage()
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Live sessions')
  })
})
