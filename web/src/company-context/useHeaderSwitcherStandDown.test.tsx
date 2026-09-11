import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../i18n'
import { setToken, clearToken } from '../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '.'
import { CompanyContextSwitcher } from '../components/layout/CompanyContextSwitcher'
import CompanyContextBar from '../components/layout/CompanyContextBar'
import { useHeaderSwitcherStandDown } from './useHeaderSwitcherStandDown'
import { tokenFor } from '../test/jwtFixture'
import en from '../i18n/en.json'

const COMPANIES = [
  { id: 'co-a', name: 'Acme Corporation', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' },
]

function stubCompanies() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ companies: COMPANIES }), { status: 200 }))),
  )
}

function PlatformPage() {
  useHeaderSwitcherStandDown()
  return <p>platform page</p>
}

/** A shell: the header's switcher, and a page that can be swapped out. */
function Shell({ initial }: { initial: 'platform' | 'bar' | 'plain' }) {
  const [page, setPage] = useState(initial)
  return (
    <>
      <header data-testid="header">
        <CompanyContextSwitcher />
      </header>
      <button type="button" onClick={() => setPage('plain')}>
        leave
      </button>
      {page === 'platform' && <PlatformPage />}
      {page === 'bar' && <CompanyContextBar note="note" />}
    </>
  )
}

function renderShell(initial: 'platform' | 'bar' | 'plain') {
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <Shell initial={initial} />
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

function headerSwitcher(): HTMLElement | null {
  return screen.getByTestId('header').querySelector('select')
}

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('the header switcher stands down under a page that asks', () => {
  it('keeps the header switcher for a super administrator on an ordinary page', () => {
    setToken(tokenFor({ role: 'super_admin' }))
    stubCompanies()
    renderShell('plain')
    expect(headerSwitcher()).not.toBeNull()
  })

  it('stands down while a platform page is mounted, and comes back when it leaves', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    stubCompanies()
    renderShell('platform')
    await waitFor(() => expect(headerSwitcher()).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => expect(headerSwitcher()).not.toBeNull())
  })

  it('draws one company switcher, not two, on a page with the canvas strip — and it writes the one selection', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    setToken(tokenFor({ role: 'super_admin' }))
    stubCompanies()
    renderShell('bar')
    await waitFor(() => expect(document.querySelectorAll('select')).toHaveLength(1))
    expect(headerSwitcher()).toBeNull()
    const strip = screen.getByLabelText(en.companyContext.label)
    await screen.findByRole('option', { name: 'Acme Corporation' })
    await userEvent.selectOptions(strip, 'co-a')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('co-a')
    expect(screen.getByText(en.companyContext.next.active)).toBeTruthy()
  })

  it('clears a stored company the list does not carry, and says nothing is chosen — never "Empresa activa" beside "Ninguna"', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-gone')
    setToken(tokenFor({ role: 'super_admin' }))
    stubCompanies()
    renderShell('bar')
    await screen.findByRole('option', { name: 'Acme Corporation' })
    await waitFor(() => expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBeNull())
    expect(screen.getByText(en.companyContext.next.unchosen)).toBeTruthy()
    expect(screen.queryByText(en.companyContext.next.active)).toBeNull()
    expect((screen.getByLabelText(en.companyContext.label) as HTMLSelectElement).value).toBe('')
  })

  it('keeps a listed company chosen, and keeps any stored company when the list cannot be read', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-a')
    setToken(tokenFor({ role: 'super_admin' }))
    stubCompanies()
    const listed = renderShell('bar')
    await screen.findByRole('option', { name: 'Acme Corporation' })
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('co-a')
    expect(screen.getByText(en.companyContext.next.active)).toBeTruthy()
    listed.unmount()

    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-gone')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 500 }))))
    renderShell('bar')
    await screen.findByText(en.companyContext.loadFailed)
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('co-gone')
    expect(screen.getByText(en.companyContext.next.active)).toBeTruthy()
  })

  it('draws no strip for a company administrator and never asks for the company list', () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'co-a' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderShell('bar')
    expect(document.querySelector('[data-slot="company-context-bar"]')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
