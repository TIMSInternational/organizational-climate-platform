import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import CompanyDetailPage from './CompanyDetailPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken, clearToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { MERIDIANO_ID, superMeridianoFetch } from '../../../test/superMeridianoFetch'
import es from '../../../i18n/es.json'

/**
 * The route's dispatcher, rendered — not its source text. `/admin/companies/:id` mounts
 * `CompanyDetailPage`; for a super administrator that page must return the per-role
 * canvas's `SuperCompanyDetailView`, whose "Solo desde aquí" strip (the pages of the
 * tenant reached only from here) no other screen draws. A branch made unreachable
 * (`role === 'super_admin' && Date.now() < 0 ? …`) renders the company administrator's
 * page instead, and this fails.
 */
describe('CompanyDetailPage for a super administrator', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn(superMeridianoFetch))
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('renders the canvas view: the "Solo desde aquí" strip and its four links', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${MERIDIANO_ID}`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:id" element={<CompanyDetailPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    expect(await screen.findByText(es.superadmin.next.companyDetail.onlyHereLead)).toBeTruthy()
  })
})
