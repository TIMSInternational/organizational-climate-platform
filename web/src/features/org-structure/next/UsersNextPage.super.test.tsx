import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import UsersNextPage from './UsersNextPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken, clearToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { LUIS_MORA_ID, MERIDIANO_ID, superMeridianoFetch } from '../../../test/superMeridianoFetch'
import es from '../../../i18n/es.json'

/**
 * The route's dispatcher, rendered — not its source text. `/admin/companies/:companyId/users`
 * mounts `UsersNextPage`; for a super administrator it must return the per-role canvas's
 * `SuperUsersView`, whose "Editar a <persona>" panel (opened by `?editar=<id>`) only that
 * view draws. A branch made unreachable renders the company administrator's roster
 * instead, and this fails.
 */
describe('UsersNextPage for a super administrator', () => {
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

  it('renders the canvas view: the "Editar a Luis Mora" panel the URL names', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${MERIDIANO_ID}/users?editar=${LUIS_MORA_ID}`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:companyId/users" element={<UsersNextPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    const heading = es.superadmin.next.users.editTitle.replace('{name}', 'Luis Mora')
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
  })
})
