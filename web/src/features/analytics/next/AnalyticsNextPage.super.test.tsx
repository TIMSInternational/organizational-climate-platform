import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import AnalyticsNextPage from './AnalyticsNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken, clearToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { MERIDIANO_ID, superMeridianoFetch } from '../../../test/superMeridianoFetch'
import es from '../../../i18n/es.json'

/**
 * The page `/admin/companies/:companyId/analytics` mounts, rendered for a super administrator.
 * #471 put the super administrator's branch in the old `AnalyticsDashboardPage`; this lane
 * mounts `AnalyticsNextPage` on that route, so the branch must live here or it is unreachable
 * (its own test, `AnalyticsDashboardPage.super.test.tsx`, renders the old page directly and
 * would stay green). `SuperAnalyticsView` alone draws the "Referencias propias" tile.
 */
describe('AnalyticsNextPage for a super administrator', () => {
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

  it('renders the per-role canvas view: the "Referencias propias" tile', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${MERIDIANO_ID}/analytics`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:companyId/analytics" element={<AnalyticsNextPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    expect(await screen.findByText(es.superadmin.next.analytics.tiles.own)).toBeTruthy()
  })
})
