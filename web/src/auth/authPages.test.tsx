import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import LoginPage from './LoginPage'
import RegisterPage from './RegisterPage'
import AuthErrorPage from './AuthErrorPage'
import AccountInactivePage from './AccountInactivePage'
import AuthSuccessPage from './AuthSuccessPage'
import RequireAuth from '../app/RequireAuth'
import { TranslationProvider } from '../i18n'
import { getToken, setToken, clearToken } from './token'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

/** Renders the current path and router state so a navigation can be asserted on. */
function LocationProbe() {
  const location = useLocation()
  const state = location.state as { message?: unknown } | null
  return (
    <div>
      <span data-testid="path">{`${location.pathname}${location.search}`}</span>
      <span data-testid="state-message">{typeof state?.message === 'string' ? state.message : ''}</span>
    </div>
  )
}

/**
 * Mounts the auth routes for real rather than stubbing `useNavigate`. What these
 * pages get right or wrong is *where they send the user*, so the routing has to
 * be the thing under test.
 */
function renderAuthRoutes(initialEntry: string) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/error" element={<AuthErrorPage />} />
          <Route path="/auth/inactive" element={<AccountInactivePage />} />
          <Route path="/auth/success" element={<AuthSuccessPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/surveys/my" element={<p>guarded page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const path = () => screen.getByTestId('path').textContent

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('LoginPage failure triage', () => {
  it('keeps a 401 on the form, where the fields the user can fix are', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid email or password' }), { status: 401 }),
    )

    renderAuthRoutes('/login')
    await userEvent.type(screen.getByLabelText(/Email/), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(path()).toBe('/login')
  })

  it('routes a 503 to the error page and carries the server maintenance message', async () => {
    // The message is authored content resolved per-locale by the server (#195).
    // `auth/api.ts` used to throw it away and report `Login failed: 503`.
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Volvemos a las 14:00.' }), { status: 503 }),
    )

    renderAuthRoutes('/login')
    await userEvent.type(screen.getByLabelText(/Email/), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(path()).toBe('/auth/error?reason=maintenance'))
    expect(screen.getByTestId('state-message').textContent).toBe('Volvemos a las 14:00.')
    // Shown on the page, in the server's own words — the catalogue cannot
    // paraphrase content an administrator authored.
    expect((await screen.findByRole('alert')).textContent).toBe('Volvemos a las 14:00.')
  })

  it('routes a 403 to the error page as a disabled sign-in', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Login is currently disabled by an administrator.' }), { status: 403 }),
    )

    renderAuthRoutes('/login')
    await userEvent.type(screen.getByLabelText(/Email/), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(path()).toBe('/auth/error?reason=login-disabled'))
    expect(await screen.findByText('Sign-in is turned off')).toBeTruthy()
  })

  it('offers a way to the register page', async () => {
    renderAuthRoutes('/login')
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/register')
  })
})

describe('RegisterPage', () => {
  it('signs up and lands on the success state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFor({ role: 'employee', companyId: 'c1', name: 'Ana Rojas', email: 'ana@acme.com' }) }), {
        status: 201,
      }),
    )

    renderAuthRoutes('/register')
    await userEvent.type(screen.getByLabelText(/Name/), 'Ana Rojas')
    await userEvent.type(screen.getByLabelText(/Email/), 'ana@acme.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'longenough')
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))

    await waitFor(() => expect(path()).toBe('/auth/success'))
    expect(await screen.findByText('Welcome, Ana Rojas. Your account is ready.')).toBeTruthy()
    // The one thing signup decides silently: which organisation you joined.
    expect(screen.getByText('acme.com')).toBeTruthy()
    expect(getToken()).toBeTruthy()
  })

  it('renders the 404 as the invitation route, not as a failure', async () => {
    // No company registered for the domain. That is the product's actual
    // onboarding rule, so it is guidance with a next step -- not a red alert.
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'No company found for this email domain. Please contact your administrator for an invitation.' }),
        { status: 404 },
      ),
    )

    renderAuthRoutes('/register')
    await userEvent.type(screen.getByLabelText(/Name/), 'Ana')
    await userEvent.type(screen.getByLabelText(/Email/), 'ana@nowhere.dev')
    await userEvent.type(screen.getByLabelText(/Password/), 'longenough')
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))

    expect(await screen.findByText('An invitation is needed for this address')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // And the form is still there with what was typed, so nothing has to be redone.
    expect(screen.getByLabelText(/Email/)).toHaveProperty('value', 'ana@nowhere.dev')
  })

  it('shows a 409 beside the form rather than taking the page', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'User with this email already exists' }), { status: 409 }),
    )

    renderAuthRoutes('/register')
    await userEvent.type(screen.getByLabelText(/Name/), 'Ana')
    await userEvent.type(screen.getByLabelText(/Email/), 'ana@acme.com')
    await userEvent.type(screen.getByLabelText(/Password/), 'longenough')
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))

    expect(await screen.findByText('User with this email already exists')).toBeTruthy()
    expect(path()).toBe('/register')
  })

  it('names the organisation the email domain will join before submitting', async () => {
    renderAuthRoutes('/register')
    await userEvent.type(screen.getByLabelText(/Email/), 'ana@acme.com')

    expect(screen.getByText(/You will join the organization registered to acme.com/)).toBeTruthy()
  })
})

describe('AuthErrorPage', () => {
  it('falls back to catalogue copy on a direct visit with no state', async () => {
    renderAuthRoutes('/auth/error?reason=maintenance')

    expect(await screen.findByRole('heading', { name: 'Under maintenance' })).toBeTruthy()
  })

  it('does not render an unrecognised reason as a key path', async () => {
    renderAuthRoutes('/auth/error?reason=auth.password')

    expect(await screen.findByRole('heading', { name: 'Sign-in is unavailable' })).toBeTruthy()
    expect(screen.queryByText('auth.password')).toBeNull()
  })
})

describe('RequireAuth and the inactive state', () => {
  it('sends an unauthenticated visitor to login', async () => {
    renderAuthRoutes('/surveys/my')

    await waitFor(() => expect(path()).toBe('/login'))
  })

  it('lets an active session through', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1', isActive: 'true' }))

    renderAuthRoutes('/surveys/my')

    expect(await screen.findByText('guarded page')).toBeTruthy()
  })

  /**
   * The claim is a STRING. `JwtTokenService` emits `IsActive ? "true" : "false"`,
   * so `!claims.isActive` is false for the string `"false"` and would let a
   * deactivated session straight through — which is exactly what happened before
   * this branch existed.
   */
  it('diverts a deactivated session to the inactive page', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1', isActive: 'false' }))

    renderAuthRoutes('/surveys/my')

    await waitFor(() => expect(path()).toBe('/auth/inactive'))
    expect(await screen.findByRole('heading', { name: 'This account has been deactivated' })).toBeTruthy()
    expect(screen.queryByText('guarded page')).toBeNull()
  })

  it('treats a token minted before the claim existed as active, not as locked out', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))

    renderAuthRoutes('/surveys/my')

    expect(await screen.findByText('guarded page')).toBeTruthy()
  })

  it('clears the token only when the user leaves the inactive page', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1', isActive: 'false' }))
    renderAuthRoutes('/auth/inactive')

    // Still held while the explanation is on screen -- clearing on mount would
    // race RequireAuth's redirect and bounce them before they read it.
    expect(getToken()).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))

    await waitFor(() => expect(path()).toBe('/login'))
    expect(getToken()).toBeNull()
  })
})

describe('AuthSuccessPage', () => {
  it('refuses to congratulate a visitor with no token', async () => {
    renderAuthRoutes('/auth/success')

    await waitFor(() => expect(path()).toBe('/login'))
  })

  it('continues to a page the new employee can actually load', async () => {
    // Before `resolvePostAcceptRoute` learned about /surveys/my, this button's
    // only destination was /admin/companies -- SuperAdmin-only, so a 403. Since
    // #132 it is /dashboard, which every role can load: the page dispatches on the
    // role claim and the employee branch is scoped to the caller's own user row.
    setToken(tokenFor({ role: 'employee', companyId: 'c1', name: 'Ana', email: 'ana@acme.com', isActive: 'true' }))
    renderAuthRoutes('/auth/success')

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(path()).toBe('/dashboard'))
  })
})
