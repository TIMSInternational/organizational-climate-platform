import { describe, it, expect, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { TranslationProvider } from '../i18n'
import RequireAuth from './RequireAuth'
import { setToken, clearToken } from '../auth/token'
import { tokenFor } from '../test/jwtFixture'

const SURVEY_ID = '2437d05b-fd0f-47a4-ba67-9d96f1ac4798'

/** A route tree shaped like the real one: everything below one `RequireAuth`. */
function renderAt(pathname: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RequireAuth />,
        children: [
          { path: '/dashboard', element: <h1>DASHBOARD</h1> },
          { path: '/surveys/:id/respond', element: <h1>RESPOND</h1> },
          { path: '/surveys/my', element: <h1>MY SURVEYS</h1> },
          { path: '/profile', element: <h1>PROFILE</h1> },
          { path: '/admin/companies', element: <h1>ADMIN</h1> },
        ],
      },
      { path: '/login', element: <h1>LOGIN</h1> },
    ],
    { initialEntries: [pathname] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

describe('RequireAuth and the respondent surface', () => {
  beforeEach(() => clearToken())

  /**
   * The one that must never break: a respondent reaching the survey they were emailed.
   * Everything else in this file is a restriction; this is the thing being protected.
   */
  it('lets a respondent answer their survey', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderAt(`/surveys/${SURVEY_ID}/respond`)
    expect(screen.getByRole('heading', { name: 'RESPOND' })).toBeTruthy()
  })

  it('lets a respondent reach their dashboard', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderAt('/dashboard')
    expect(screen.getByRole('heading', { name: 'DASHBOARD' })).toBeTruthy()
  })

  it('sends a respondent back to the dashboard from anywhere else', () => {
    for (const path of ['/surveys/my', '/profile', '/admin/companies']) {
      cleanup()
      setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
      renderAt(path)
      expect(screen.getByRole('heading', { name: 'DASHBOARD' }), `${path} should land on the dashboard`).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'ADMIN' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'MY SURVEYS' })).toBeNull()
    }
  })

  /**
   * The scope guard. Enforcing `roleCapabilities` for everyone would have blocked 22 of
   * the router's 61 paths for a company_admin — measured — because that table was written
   * for link checking and never completed for the admin roles.
   */
  it('does not lock down any other role', () => {
    for (const role of ['company_admin', 'super_admin', 'leader', 'supervisor']) {
      cleanup()
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderAt('/admin/companies')
      expect(screen.getByRole('heading', { name: 'ADMIN' }), `${role} must still reach admin pages`).toBeTruthy()
    }
  })

  it('still sends a caller with no token to the login page', () => {
    renderAt('/dashboard')
    expect(screen.getByRole('heading', { name: 'LOGIN' })).toBeTruthy()
  })
})
