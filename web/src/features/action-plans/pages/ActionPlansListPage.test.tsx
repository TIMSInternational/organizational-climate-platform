import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ActionPlansListPage from './ActionPlansListPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'

/**
 * #124. This page is the one every other lane's TODO pointed at: it was the
 * documented example of a SuperAdmin being silently scoped to whatever company
 * their own user row pointed at, and it was blocked outright rather than fixed.
 *
 * These tests pin the two halves of the replacement — a SuperAdmin is *asked*
 * rather than guessed at, and a CompanyAdmin is unaffected by anything the
 * selector stores.
 */

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/action-plan-templates')
      ? { templates: [] }
      : { actionPlans: [{ id: 'p1', title: 'Raise engagement', companyId: 'chosen-co', departmentId: null, dueDate: '2026-12-01T00:00:00Z', status: 'not_started', priority: 'high', createdAt: '2026-01-01T00:00:00Z' }] }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <ActionPlansListPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('ActionPlansListPage company scoping', () => {
  it('asks a super_admin which company they mean rather than picking one', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('never falls back to a super_admin own companyId claim', async () => {
    // The exact defect the old block comment described: a super_admin whose user
    // row does point at a company would have been scoped to it, silently, and any
    // plan they created would have been filed under it.
    setToken(tokenFor({ role: 'super_admin', companyId: 'their-own-row' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('loads the company a super_admin selected, and asks the API for that one', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: 'their-own-row' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'chosen-co')
    renderPage()

    expect(await screen.findByText('Raise engagement')).toBeTruthy()
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('companyId=chosen-co'))).toBe(true)
    expect(urls.some((url) => url.includes('their-own-row'))).toBe(false)
  })

  it('scopes a company_admin to their own claim, ignoring any stored selection', async () => {
    // The client half of the escalation guard. `CanAccessCompany` on the API is the
    // boundary; this asserts the UI does not even try.
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'someone-elses-co')
    setToken(tokenFor({ role: 'company_admin', companyId: 'their-co' }))
    renderPage()

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.every((url) => url.includes('companyId=their-co'))).toBe(true)
    expect(urls.some((url) => url.includes('someone-elses-co'))).toBe(false)
  })

  it('still says so for a company_admin whose token names no tenant', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: '' }))
    renderPage()

    // Not "choose a company": there is nothing for this role to choose from.
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No company is associated with your account.',
    )
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
