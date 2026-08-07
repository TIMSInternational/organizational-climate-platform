import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import SurveysListPage from './SurveysListPage'
import type { SurveyListItem } from '../api/surveys'

function row(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 's1',
    title: 'Q3 climate survey',
    companyId: 'c1',
    type: 'periodic',
    status: 'draft',
    language: 'en',
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-09-30T00:00:00Z',
    responseCount: 4,
    targetAudienceCount: 40,
    questionCount: 8,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function ok(...rows: SurveyListItem[]) {
  return new Response(JSON.stringify({ surveys: rows }), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <SurveysListPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0])
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SurveysListPage', () => {
  it('sends no companyId, so a super admin gets a real cross-company view', async () => {
    // `ListAsync` applies NO company predicate for a super_admin who sends no
    // companyId, and overwrites the scope with their own company for anyone else. So
    // omitting it is correct for both roles — and it is why this page needs neither a
    // role gate nor a claim read, unlike /action-plans.
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Q3 climate survey')
    expect(lastUrl(fetchMock)).not.toContain('companyId')
  })

  it('pushes the status filter to the server rather than filtering the fetched array', async () => {
    // Filtering client-side would be a second implementation of a rule the server
    // owns, and would silently disagree the moment the listing is paginated.
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Q3 climate survey')

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))

    await waitFor(() => expect(lastUrl(fetchMock)).toContain('status=active'))
  })

  it('does not refetch on every keystroke in the search box', async () => {
    // Draft-vs-applied filter state. Typing eight characters must not issue eight
    // requests.
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Q3 climate survey')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await userEvent.type(screen.getByLabelText('Search'), 'climate')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(lastUrl(fetchMock)).toContain('q=climate'))
  })

  it('offers only the types actually present, because Survey.Type has no closed vocabulary', async () => {
    // The server validates `type` as non-empty and nothing more, so an enumerated
    // list would promise filters that match nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(ok(row(), row({ id: 's2', title: 'Weekly pulse', type: 'pulse' }))),
    )
    renderPage()
    await screen.findByText('Weekly pulse')

    const options = Array.from(
      screen.getByLabelText('Survey Type').querySelectorAll('option'),
    ).map((option) => option.getAttribute('value'))
    expect(options).toEqual(['', 'periodic', 'pulse'])
  })

  it('degrades a null targetAudienceCount to the bare count, never a fabricated denominator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ targetAudienceCount: null }))))
    renderPage()

    await screen.findByText('Q3 climate survey')
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.queryByText(/4 of/)).toBeNull()
  })

  it('falls back to a label when a survey has no title in any language', async () => {
    // The resolver returns null rather than an empty string or a key path (#195).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ title: null }))))
    renderPage()

    expect(await screen.findByText('Untitled survey')).toBeTruthy()
  })

  it('shows the server’s message on a failed load, with a retry that refetches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Boom' }), { status: 500 }))
      .mockResolvedValueOnce(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByText('Boom')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Q3 climate survey')).toBeTruthy()
  })
})
