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

  it('links Preview to the template detail route, not to a survey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row())))
    renderPage()

    const link = await screen.findByRole('link', { name: 'Preview Quarterly climate' })
    expect(link.getAttribute('href')).toBe('/surveys/templates/t1')
  })

  it('sends Use into the wizard with the template chosen, rather than instantiating from the card', async () => {
    // `/use` requires a companyId for a super admin and also takes the title, dates and
    // audience the wizard collects (#267). A card that called it would silently accept
    // the defaults for all of them.
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const link = await screen.findByRole('link', { name: 'Use Quarterly climate' })
    expect(link.getAttribute('href')).toBe('/surveys/new?template=t1')
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes('/use'))).toBe(true)
  })

  it('states each template’s size on its card, in the mono face', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ questionCount: 34, usageCount: 12 }))))
    renderPage()

    expect(await screen.findByText('34 questions')).toBeTruthy()
    const used = screen.getByText('12')
    expect(used.className).toContain('font-mono')
    expect(used.className).toContain('tabular-nums')
  })

  it('renders an empty state when the catalogue has nothing to show', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    renderPage()

    expect(await screen.findByText('No Templates Found')).toBeTruthy()
  })
})

describe('the curated page eyebrow', () => {
  /**
   * The approved design gives this screen the eyebrow "Library". Left to itself
   * `PageTopBar` derives the NAV SECTION instead, which can only ever be one of three
   * words ("Administration", "Workspace", "Communication") — so the design's curated
   * label is a prop the page has to pass, and deleting that prop is completely silent:
   * every other test in this file still passed with it removed. Hence this one.
   */
  it('names the design’s section, not the nav section', () => {
    renderPage()
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Library')
  })
})
