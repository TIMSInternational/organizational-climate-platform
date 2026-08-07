import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import MySurveysPage from './MySurveysPage'
import type { MySurveyListItem } from '../api/surveys'

/**
 * The respondent surface. Its acceptance criterion is that it works for a *plain
 * employee*, which is why none of these tests establish a role: the page reads no
 * role claim, and `GET /surveys/my` resolves the caller's own user row instead.
 */

function row(overrides: Partial<MySurveyListItem> = {}): MySurveyListItem {
  return {
    id: 's1',
    title: 'Q3 climate survey',
    description: 'How the last quarter felt',
    type: 'periodic',
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-09-30T00:00:00Z',
    questionCount: 8,
    anonymous: true,
    timeLimitMinutes: null,
    ...overrides,
  }
}

function ok(...rows: MySurveyListItem[]) {
  return new Response(JSON.stringify({ surveys: rows }), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <MySurveysPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
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

describe('MySurveysPage', () => {
  it('loads for a plain employee, hitting the per-user endpoint and no admin one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByText('Q3 climate survey')).toBeTruthy()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/surveys/my')
    // No company or status scoping is sent: the server derives both from the
    // caller's own user row, which is what makes this loadable without an admin role.
    expect(url).not.toContain('companyId')
  })

  it('surfaces anonymity as a labelled badge, the fact a respondent most needs before answering', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ anonymous: true }))))
    renderPage()

    expect(await screen.findByText('Anonymous')).toBeTruthy()
    expect(screen.queryByText('Identified')).toBeNull()
  })

  it('shows a time limit only when the survey declares one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ timeLimitMinutes: 20 }))))
    renderPage()

    expect(await screen.findByText('20 min limit')).toBeTruthy()
  })

  it('renders an employee-facing empty state rather than an admin “adjust your filters”', async () => {
    // This page has no filters, so the admin listing's empty copy would be nonsense
    // here — and a global super_admin correctly lands on this exact state.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    renderPage()

    expect(await screen.findByText('No surveys assigned to you')).toBeTruthy()
    expect(screen.queryByText(/adjusting your filters/)).toBeNull()
  })

  it('says answering is not available yet instead of linking rows nowhere', async () => {
    // No respond page exists on main. A row linking to an unresolvable route is worse
    // for an employee than a row that does not pretend to.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row())))
    renderPage()

    expect(
      await screen.findByText('Answering surveys from this page is not available yet.'),
    ).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
