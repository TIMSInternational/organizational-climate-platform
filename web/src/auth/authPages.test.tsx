import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import LoginPage from './LoginPage'
import RegisterPage from './RegisterPage'
import AuthErrorPage from './AuthErrorPage'
import AccountInactivePage from './AccountInactivePage'
import AuthLoadingPage from './AuthLoadingPage'
import AuthSuccessPage from './AuthSuccessPage'
import RequireAuth from '../app/RequireAuth'
import { TranslationProvider } from '../i18n'
import { getToken, setToken, clearToken } from './token'
import { beginGoogleSignIn, peekGoogleHandshake } from './googleOAuth'

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
          <Route path="/auth/loading" element={<AuthLoadingPage />} />
          <Route path="/auth/success" element={<AuthSuccessPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/surveys/my" element={<p>guarded page</p>} />
            {/* Where `resolveInitialRoute()` sends every role since #132. Guarded,
                so "landed here" also means the session was accepted. */}
            <Route path="/dashboard" element={<p>dashboard</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const path = () => screen.getByTestId('path').textContent

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  clearToken()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  // The "offers a way to the register page" test that used to sit here is gone,
  // not moved: the link it asserted was removed on purpose. `POST /auth/signup`
  // derives the company from the email domain and 400s when none is registered for
  // it, so for the employees who reach this page it led to a refusal.
  // `LoginPage.test.tsx` now asserts the absence, and `/register` itself is still
  // routed and still tested below.
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

/**
 * The Google entry point (#81 AC4) and the `/auth/loading` route it produces
 * (#81 AC1). Before this, `POST /auth/google` had no caller anywhere in `web/src`
 * and the loading state was a component with no route in front of it.
 */
describe('Google sign-in', () => {
  const CLIENT_ID = '123.apps.googleusercontent.com'

  /**
   * Starts a handshake the way the login button does and returns the callback URL
   * Google would send the browser back to. Storage keeps the handshake until the
   * loading page consumes it, so parsing it back out of the authorization URL is
   * the honest way to build a matching callback.
   */
  function callbackUrl(claims: Record<string, unknown> = {}): string {
    const authUrl = new URL(beginGoogleSignIn(CLIENT_ID, 'https://app.example'))
    const state = authUrl.searchParams.get('state') as string
    const nonce = authUrl.searchParams.get('nonce') as string
    return `/auth/loading#id_token=${tokenFor({ nonce, ...claims })}&state=${state}`
  }

  it('offers no Google button when no client id is configured', () => {
    renderAuthRoutes('/login')

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
  })

  it('sends the browser to Google and remembers the handshake', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})

    renderAuthRoutes('/login')
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))

    const target = new URL(assign.mock.calls[0][0] as string)
    expect(target.origin).toBe('https://accounts.google.com')
    expect(target.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(target.searchParams.get('response_type')).toBe('id_token')
    // The state that went out is the one that has to come back.
    expect(sessionStorage.getItem('climate.auth.google-handshake')).toContain(
      target.searchParams.get('state') as string,
    )

    assign.mockRestore()
  })

  it('exchanges the callback token and lands the employee on a page they can load', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFor({ role: 'employee', companyId: 'c1', isActive: 'true' }) }), {
        status: 200,
      }),
    )

    renderAuthRoutes(callbackUrl({ email: 'ana@acme.com' }))

    // `/dashboard` since #132 — one route for every role, which is what makes it
    // safe for a Google user, who is always minted the narrowest role there is.
    await waitFor(() => expect(path()).toBe('/dashboard'))
    expect(await screen.findByText('dashboard')).toBeTruthy()
    expect(getToken()).toBeTruthy()

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/auth\/google$/)
    expect(JSON.parse(String((init as RequestInit).body))).toHaveProperty('idToken')
  })

  it('shows the interstitial while the exchange is in flight', async () => {
    // The whole point of AC4: the gap between Google and our own API is a stated
    // state, not a blank page.
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)

    renderAuthRoutes(callbackUrl())

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Finishing sign-in…' })).toBeTruthy()
  })

  it('sends a bare visit to /auth/loading back to login rather than inventing a failure', async () => {
    renderAuthRoutes('/auth/loading')

    await waitFor(() => expect(path()).toBe('/login'))
    expect(fetch).not.toHaveBeenCalled()
  })

  /**
   * The bare visit must also leave a *pending* handshake alone. The page used to
   * consume it before parsing the callback, so opening `/auth/loading` from a
   * bookmark or the back button while a sign-in was in flight destroyed the stored
   * state — and the real redirect that arrived afterwards was then reported as a
   * mismatch it had not earned.
   */
  it('leaves a pending handshake intact when nobody came back from Google', async () => {
    beginGoogleSignIn(CLIENT_ID, 'https://app.example')
    const before = peekGoogleHandshake()

    renderAuthRoutes('/auth/loading')

    await waitFor(() => expect(path()).toBe('/login'))
    expect(peekGoogleHandshake()).toEqual(before)
    expect(before).not.toBeNull()
  })

  /**
   * Pins the **state** check specifically.
   *
   * The sibling test below plants a token whose nonce is wrong too, so the nonce
   * check alone rejects it and removing the state comparison leaves that test green
   * — measured. Here the nonce is the *real* one from this browser's handshake, so
   * the forged `state` is the only thing left that can reject the token. Reachable
   * for an attacker in the case that matters: a token they obtained legitimately for
   * their own account, replayed into the victim's browser to sign the victim in as
   * them.
   */
  it('rejects a forged state even when the nonce is genuine', async () => {
    beginGoogleSignIn(CLIENT_ID, 'https://app.example')
    const handshake = peekGoogleHandshake()
    const planted = tokenFor({ nonce: handshake!.nonce, email: 'attacker@evil.test' })

    renderAuthRoutes(`/auth/loading#id_token=${planted}&state=forged`)

    await waitFor(() => expect(path()).toBe('/auth/error?reason=google-signin'))
    expect(fetch).not.toHaveBeenCalled()
    expect(getToken()).toBeNull()
  })

  /**
   * Login CSRF. A URL fragment is attacker-writable, so without the state check
   * `/auth/loading#id_token=<attacker's token>` silently signs the victim into the
   * ATTACKER's account. The assertion that matters most is that the token is never
   * sent anywhere.
   */
  it('never exchanges a token whose state this browser did not issue', async () => {
    beginGoogleSignIn(CLIENT_ID, 'https://app.example')
    const planted = tokenFor({ nonce: 'nonce-xyz', email: 'attacker@evil.test' })

    renderAuthRoutes(`/auth/loading#id_token=${planted}&state=forged`)

    await waitFor(() => expect(path()).toBe('/auth/error?reason=google-signin'))
    expect(fetch).not.toHaveBeenCalled()
    expect(getToken()).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Google sign-in did not finish' })).toBeTruthy()
  })

  it('reports a cancelled consent screen as a cancellation', async () => {
    beginGoogleSignIn(CLIENT_ID, 'https://app.example')

    renderAuthRoutes('/auth/loading#error=access_denied')

    await waitFor(() => expect(path()).toBe('/auth/error?reason=google-signin'))
    expect(screen.getByTestId('state-message').textContent).toBe(
      'The Google sign-in window was closed before it finished.',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('routes a rejected token to the Google error, keeping password sign-in offered', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Google sign-in failed' }), { status: 401 }),
    )

    renderAuthRoutes(callbackUrl())

    await waitFor(() => expect(path()).toBe('/auth/error?reason=google-signin'))
    expect((await screen.findByRole('alert')).textContent).toBe('Google sign-in failed')
    expect(getToken()).toBeNull()
  })

  it('routes maintenance to the maintenance page, same as password sign-in does', async () => {
    // `/auth/google` shares CheckSystemSettingsGateAsync with `/auth/login`, so
    // 503 has to mean the same thing on both paths.
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Volvemos a las 14:00.' }), { status: 503 }),
    )

    renderAuthRoutes(callbackUrl())

    await waitFor(() => expect(path()).toBe('/auth/error?reason=maintenance'))
  })
})
