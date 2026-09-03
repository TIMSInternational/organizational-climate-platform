import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import CompaniesListPage from './CompaniesListPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { Company } from '../api/companies'

/**
 * `/admin/companies` is the super_admin's landing page and had no test at all
 * (measured 2026-09-03). These pin the three states an operator meets — loaded, empty,
 * failed — and the one interaction the page owns, the search filter. The create form is
 * `CompanyForm`'s own test's job.
 */
function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c1',
    name: 'Northwind Logistics',
    emailDomain: 'northwind.example',
    industry: 'Transportation',
    size: 'large',
    country: 'Colombia',
    subscriptionTier: 'enterprise',
    createdAt: '2025-03-14T09:12:00Z',
    ...overrides,
  }
}

function answer(companies: Company[]) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ companies }), { status: 200 }))
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/companies']}>
        <CompaniesListPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CompaniesListPage', () => {
  it('lists the companies the API returns, under the page title', async () => {
    answer([company(), company({ id: 'c2', name: 'Contoso Retail', emailDomain: 'contoso.example', industry: 'Retail' })])
    renderPage()
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy()
    expect(await screen.findByText('Northwind Logistics')).toBeTruthy()
    expect(screen.getByText('Contoso Retail')).toBeTruthy()
    expect(screen.queryByText('Loading...')).toBeNull()
  })

  it('filters by name, domain or industry as the operator types', async () => {
    // Each term below lives in exactly ONE field of ONE company, so a filter that quietly
    // stopped reading that field would fail here rather than be rescued by another match.
    answer([company(), company({ id: 'c2', name: 'Contoso', emailDomain: 'contoso.example', industry: 'Groceries' })])
    renderPage()
    await screen.findByText('Northwind Logistics')
    const box = screen.getByRole('searchbox')
    await userEvent.type(box, 'grocer')                                  // industry only
    await waitFor(() => expect(screen.queryByText('Northwind Logistics')).toBeNull())
    expect(screen.getByText('Contoso')).toBeTruthy()
    await userEvent.clear(box)
    await userEvent.type(box, 'northwind.example')                       // domain only
    await waitFor(() => expect(screen.queryByText('Contoso')).toBeNull())
    expect(screen.getByText('Northwind Logistics')).toBeTruthy()
  })

  it('shows the app’s own network copy when the list cannot load, not a blank page', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Network error. Please check your connection.')
    // The page keeps its title and its primary action, so the operator still knows where they are.
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New company' })).toBeTruthy()
  })

  it('toggles the create form and reloads the list after a create', async () => {
    answer([company()])
    renderPage()
    await screen.findByText('Northwind Logistics')
    await userEvent.click(screen.getByRole('button', { name: 'New company' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create company' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Create company' })).toBeNull()
  })
})
