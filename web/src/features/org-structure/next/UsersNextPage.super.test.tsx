import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  /**
   * The same line, on the super administrator's roster of a tenant. A surface that answers for
   * one role and silently returns nothing for the other is the shape three defects here have
   * taken, so the two views are pinned together: this one reads
   * `superadmin.next.users.username`, the company administrator's reads
   * `users.next.roster.username`, and `AdminUsersView.test.tsx` asserts the other half.
   */
  it('prints the usuario on the rows a mass invite created', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${MERIDIANO_ID}/users`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:companyId/users" element={<UsersNextPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    const copy = es.superadmin.next.users
    // This roster renders `visible.slice(0, VISIBLE_ROWS)` until it is expanded, and both
    // mass-invite accounts sit past that cut, so the row has to be on screen before it can be
    // read -- exactly what the administrator does to find the person who is phoning.
    await userEvent.click(await screen.findByRole('button', { name: copy.showAll }))

    // The capture carries exactly two accounts a mass invite made; on every other row the
    // field is absent, and an absent field must print no label at all -- `undefined !== null`
    // is true, so a guard written against null alone labels all 42 rows.
    expect(screen.getAllByText(copy.username)).toHaveLength(2)
    expect(screen.getByText('grupomer-k7m2q9xa')).toBeTruthy()
    expect(screen.getByText('grupomer-p3n8w2ft')).toBeTruthy()
  })
})
