import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import DemographicFieldsPage from './DemographicFieldsPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken, clearToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { MERIDIANO_ID, superMeridianoFetch } from '../../../test/superMeridianoFetch'
import es from '../../../i18n/es.json'

/**
 * The route's dispatcher, rendered — not its source text.
 * `/admin/companies/:companyId/demographic-fields` mounts `DemographicFieldsPage`; for a
 * super administrator it must return the per-role canvas's `SuperDemographicFieldsView`,
 * whose "Cómo se aplica el umbral" card only that view draws. A branch made unreachable
 * renders the company administrator's page instead, and this fails.
 */
describe('DemographicFieldsPage for a super administrator', () => {
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

  it('renders the canvas view: the "Cómo se aplica el umbral" card', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${MERIDIANO_ID}/demographic-fields`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:companyId/demographic-fields" element={<DemographicFieldsPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    expect(await screen.findByRole('heading', { name: es.superadmin.next.demographics.rules.heading })).toBeTruthy()
  })
})
