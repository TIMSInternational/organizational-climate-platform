import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import AnalyticsDashboardPage from './AnalyticsDashboardPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken, clearToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { MERIDIANO_ID, superMeridianoFetch } from '../../../test/superMeridianoFetch'
import es from '../../../i18n/es.json'

/**
 * The route's dispatcher, rendered — not its source text.
 * `/admin/companies/:companyId/analytics` mounts `AnalyticsDashboardPage`; for a super
 * administrator it must return the per-role canvas's `SuperAnalyticsView`, whose
 * "Referencias propias" tile only that view draws. A branch made unreachable renders the
 * company administrator's analytics instead, and this fails.
 */
describe('AnalyticsDashboardPage for a super administrator', () => {
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

  it('renders the canvas view: the "Referencias propias" tile', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${MERIDIANO_ID}/analytics`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:companyId/analytics" element={<AnalyticsDashboardPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    expect(await screen.findByText(es.superadmin.next.analytics.tiles.own)).toBeTruthy()
  })
})
