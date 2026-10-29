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
          { path: '/settings/notifications', element: <h1>PREFERENCES</h1> },
          { path: '/tracking/mis-tareas', element: <h1>MIS TAREAS</h1> },
          { path: '/tracking/planes', element: <h1>PLANS</h1> },
          { path: '/tracking/planes/:id', element: <h1>PLAN</h1> },
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
  beforeEach(() => {
    cleanup()
    clearToken()
  })

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
   * G26: the two links the product itself hands an employee, followed as that employee.
   *
   * Every notification email's footer reads "Gestiona tus preferencias de notificación"
   * and links to `/settings/notifications` (`NotificationEmailComposer.PreferencesPath`),
   * and every row of Mis tareas links to `/tracking/planes/<id>`
   * (`MisTareasNextPage.tsx`). Measured on d346a7d8 before the fix: both landed on
   * DASHBOARD, so the opt-out link in the mail and the task's own plan were dead ends.
   *
   * Both are the employee's own: `GET/PUT /notifications/preferences` resolve the caller
   * from the token and take no user id, and `GET /api/planes-accion/{id}` admits a
   * responsable or involucrado read-only (`PlanAccessHandler`) -- the same predicate
   * `MisTareasAsync` lists by, so every row of that list opens.
   */
  it('lets a respondent follow the preferences link in their notification email', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderAt('/settings/notifications')
    expect(screen.getByRole('heading', { name: 'PREFERENCES' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'DASHBOARD' })).toBeNull()
  })

  it('lets an employee open the plan behind a row of Mis tareas', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderAt('/tracking/planes/7d1c2f7e-3b7a-4f37-9a43-6c9f3c7a1b52')
    expect(screen.getByRole('heading', { name: 'PLAN' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'DASHBOARD' })).toBeNull()
  })

  it('still keeps a respondent off the plans LIST, which is not theirs', () => {
    // Pattern, not prefix: admitting `/tracking/planes/:id` must not admit `/tracking/planes`.
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderAt('/tracking/planes')
    expect(screen.getByRole('heading', { name: 'DASHBOARD' })).toBeTruthy()
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
