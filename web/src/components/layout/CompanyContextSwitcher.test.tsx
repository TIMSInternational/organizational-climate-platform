import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../i18n'
import { setToken, clearToken } from '../../auth/token'
import {
  CompanyContextProvider,
  COMPANY_CONTEXT_STORAGE_KEY,
  useCompanyScope,
} from '../../company-context'
import { CompanyContextSwitcher } from './CompanyContextSwitcher'
import { tokenFor } from '../../test/jwtFixture'

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** An unsigned JWT carrying just the claims the context reads. */

const COMPANIES = [
  { id: 'co-a', name: 'Acme Holdings', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'co-b', name: 'Bravo Logistics', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' },
]

/**
 * A fresh `Response` per call, not one shared instance.
 *
 * `mockResolvedValue(new Response(...))` hands every caller the same object, and a
 * `Response` body can only be read once — the second `.json()` throws, which the
 * switcher correctly reports as "could not be loaded". The remount test below is
 * the only one that fetches twice, and it is the reason this is an
 * implementation rather than a value.
 */
function stubCompanies(): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ companies: COMPANIES }), { status: 200 })),
    )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Renders whatever a company-scoped page would see, beside the switcher. */
function ScopeProbe() {
  const scope = useCompanyScope()
  return <p data-testid="scope">{`${scope.status}:${scope.companyId ?? '-'}`}</p>
}

function renderSwitcher() {
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <CompanyContextSwitcher />
        <ScopeProbe />
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

describe('CompanyContextSwitcher', () => {
  it('offers a super_admin every company, and selects none of them by default', async () => {
    stubCompanies()
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderSwitcher()

    const select = await screen.findByRole('combobox', { name: 'Company context' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme Holdings' })).toBeTruthy())

    // The empty option is a real state, not a placeholder that will be filled in.
    expect((select as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: 'No company selected' })).toBeTruthy()
    expect(screen.getByTestId('scope').textContent).toBe('needs-selection:-')
  })

  it('scopes the session to the chosen company and persists it across a reload', async () => {
    stubCompanies()
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    const { unmount } = renderSwitcher()

    const select = await screen.findByRole('combobox', { name: 'Company context' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bravo Logistics' })).toBeTruthy())
    await userEvent.selectOptions(select, 'co-b')

    expect(screen.getByTestId('scope').textContent).toBe('ready:co-b')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('co-b')

    // Remount is this test environment's reload: the provider re-reads storage on
    // mount, which is the whole persistence contract.
    unmount()
    renderSwitcher()
    // The scope is right immediately -- it comes from storage, not from the list.
    expect(screen.getByTestId('scope').textContent).toBe('ready:co-b')
    // The *control* can only show the selection once the option it names exists,
    // which is one round trip later. A `<select>` whose value matches no option
    // reports `''`, so reading it before then would assert the wrong thing.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bravo Logistics' })).toBeTruthy())
    expect(
      (screen.getByRole('combobox', { name: 'Company context' }) as HTMLSelectElement).value,
    ).toBe('co-b')
  })

  it('lets a super_admin clear the selection back to none', async () => {
    stubCompanies()
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-a')
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderSwitcher()

    const select = await screen.findByRole('combobox', { name: 'Company context' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme Holdings' })).toBeTruthy())
    await userEvent.selectOptions(select, '')

    expect(screen.getByTestId('scope').textContent).toBe('needs-selection:-')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBeNull()
  })

  it.each(['company_admin', 'employee', 'supervisor', 'leader'])(
    'renders nothing for %s, and does not call the SuperAdmin-only companies endpoint',
    async (role) => {
      const fetchMock = stubCompanies()
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderSwitcher()

      expect(screen.queryByRole('combobox', { name: 'Company context' })).toBeNull()
      // `GET /admin/companies` 403s for these roles. Firing it on every page load
      // for a control they never see would be the cost of a feature they do not have.
      await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('ready:c1'))
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('does not let a stored selection change what a non-super_admin is scoped to', async () => {
    // The client half of the escalation guard. The value is not merely rejected --
    // it is never read for this role. The API enforces the same rule independently.
    stubCompanies()
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-b')
    setToken(tokenFor({ role: 'company_admin', companyId: 'their-own-co' }))
    renderSwitcher()

    await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('ready:their-own-co'))
    expect(screen.queryByRole('combobox', { name: 'Company context' })).toBeNull()
  })

  it('says so when the company list cannot be loaded, rather than showing an empty dropdown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderSwitcher()

    // An empty dropdown reads as "there are no companies", which is a different
    // and worse claim than "the list did not load".
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Companies could not be loaded')).toBeTruthy()
  })

  it('keeps an already-chosen context when the company list fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-a')
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderSwitcher()

    await screen.findByRole('alert')
    // The stored id is still what pages scope by; only the human-readable list is gone.
    expect(screen.getByTestId('scope').textContent).toBe('ready:co-a')
  })
})
