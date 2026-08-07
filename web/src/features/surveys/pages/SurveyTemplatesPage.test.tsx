import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import SurveyTemplatesPage from './SurveyTemplatesPage'
import type { SurveyTemplateListItem } from '../api/surveyTemplates'

function row(overrides: Partial<SurveyTemplateListItem> = {}): SurveyTemplateListItem {
  return {
    id: 't1',
    name: 'Quarterly climate',
    description: 'A standard quarterly pulse',
    category: 'climate',
    industry: null,
    companySize: null,
    isPublic: true,
    companyId: null,
    isGlobal: true,
    tags: [],
    usageCount: 3,
    rating: 4,
    questionCount: 12,
    lastUsed: null,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function ok(...rows: SurveyTemplateListItem[]) {
  return new Response(JSON.stringify({ templates: rows }), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <SurveyTemplatesPage />
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

describe('SurveyTemplatesPage', () => {
  it('sends no companyId, because the server scopes the catalogue by role', async () => {
    // A super admin sees every tenant's plus the global ones; a company admin sees the
    // global ones plus their own. Sending an id would narrow a view the server already
    // got right.
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Quarterly climate')
    expect(lastUrl(fetchMock)).toContain('/survey-templates')
    expect(lastUrl(fetchMock)).not.toContain('companyId')
  })

  it('labels a global template distinctly from a company one, rather than leaving it to a null', async () => {
    // `isGlobal` is shipped as its own flag precisely so a client does not infer a
    // security-relevant property (visible to every tenant, super-admin-writable) from
    // `companyId === null`.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok(row(), row({ id: 't2', name: 'Onboarding', companyId: 'c1', isGlobal: false })),
      ),
    )
    renderPage()

    await screen.findByText('Onboarding')
    expect(screen.getByText('Global')).toBeTruthy()
    expect(screen.getByText('Company')).toBeTruthy()
  })

  it('pushes the category filter to the server rather than filtering the fetched array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Quarterly climate')

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'climate')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))

    await waitFor(() => expect(lastUrl(fetchMock)).toContain('category=climate'))
  })

  it('does not refetch on every keystroke in the search box', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Quarterly climate')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await userEvent.type(screen.getByLabelText('Search'), 'pulse')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(lastUrl(fetchMock)).toContain('q=pulse'))
  })

  it('links each row to the template detail route, not to a survey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row())))
    renderPage()

    const link = await screen.findByRole('link', { name: 'View Details' })
    expect(link.getAttribute('href')).toBe('/surveys/templates/t1')
  })

  it('renders an empty state when the catalogue has nothing to show', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    renderPage()

    expect(await screen.findByText('No Templates Found')).toBeTruthy()
  })
})
