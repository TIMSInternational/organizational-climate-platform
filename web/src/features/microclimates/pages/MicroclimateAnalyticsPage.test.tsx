import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import MicroclimateAnalyticsPage from './MicroclimateAnalyticsPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import type { Microclimate } from '../api/microclimates'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

function row(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm1',
    title: 'Friday pulse',
    companyId: 'company-1',
    status: 'active',
    language: 'en',
    responseCount: 20,
    targetParticipantCount: 40,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function routeFetch(...rows: Microclimate[]) {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ microclimates: rows }), { status: 200 }),
  )
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <MicroclimateAnalyticsPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'company_admin', companyId: 'company-1' }))
  vi.stubGlobal('fetch', vi.fn())
  routeFetch(row())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MicroclimateAnalyticsPage', () => {
  it('aggregates the listing rather than calling an analytics endpoint that does not exist', async () => {
    renderPage()
    await screen.findByText('All sessions')

    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/microclimates?companyId=company-1')
    expect(urls[0]).not.toContain('analytics')
  })

  it('averages participation over the sessions that have a target, not over all of them', async () => {
    // A session created with targetParticipantCount: 0 has no rate at all. Folding it
    // in as a zero drags the average down with a number nobody measured: the honest
    // answer here is 50%, not 25%.
    // 40% and 60% average to 50%. Chosen so the average matches no individual row,
    // which is what makes the assertion about the average rather than about a cell.
    routeFetch(
      row({ id: 'm1', responseCount: 16, targetParticipantCount: 40 }),
      row({ id: 'm2', title: 'Sprint check', responseCount: 24, targetParticipantCount: 40 }),
      row({ id: 'm3', title: 'Untargeted', responseCount: 3, targetParticipantCount: 0 }),
    )
    renderPage()

    expect(await screen.findByText('50%')).toBeTruthy()
  })

  it('shows an em dash rather than 0% for a session with no expected audience', async () => {
    routeFetch(row({ responseCount: 3, targetParticipantCount: 0 }))
    renderPage()

    await screen.findByText('All sessions')
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('counts sessions by status using the translated vocabulary', async () => {
    routeFetch(
      row({ id: 'm1', status: 'active' }),
      row({ id: 'm2', title: 'Closed one', status: 'closed' }),
      row({ id: 'm3', title: 'Draft one', status: 'draft' }),
    )
    renderPage()

    await screen.findByText('All sessions')
    expect(screen.getByText('Total Microclimates')).toBeTruthy()
    // "Active"/"Closed" rather than the wire's own "active"/"closed".
    expect((await screen.findAllByText('Active')).length).toBeGreaterThan(0)
  })

  it('says there is nothing yet rather than rendering empty charts', async () => {
    routeFetch()
    renderPage()

    expect(await screen.findByText('No Analytics Data Available')).toBeTruthy()
    expect(screen.queryByText('All sessions')).toBeNull()
  })

  it('asks a super admin which company they mean rather than aggregating a guess', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('offers a retry on a failed load instead of a blank page', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderPage()

    expect(await screen.findByText('offline')).toBeTruthy()

    routeFetch(row())
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('All sessions')).toBeTruthy())
  })

  it('links each row at its own results page', async () => {
    renderPage()

    const link = await screen.findByRole('link', { name: 'Friday pulse' })
    expect(link.getAttribute('href')).toBe('/microclimates/m1/results')
  })
})
