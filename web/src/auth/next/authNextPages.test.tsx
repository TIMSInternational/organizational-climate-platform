import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import LoginNextPage from './LoginNextPage'
import RegisterNextPage from './RegisterNextPage'
import AuthErrorNextPage from './AuthErrorNextPage'
import AccountInactiveNextPage from './AccountInactiveNextPage'
import AuthTransitionNextPage from './AuthTransitionNextPage'
import AuthSuccessNextPage from './AuthSuccessNextPage'
import RequireAuth from '../../app/RequireAuth'
import { TranslationProvider } from '../../i18n'
import type { Locale } from '../../i18n'
import { getToken, setToken, clearToken } from '../token'
import { beginGoogleSignIn, peekGoogleHandshake } from '../googleOAuth'
import { tokenFor } from '../../test/jwtFixture'

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
 * Mounts the six redesigned auth routes for real rather than stubbing `useNavigate`. What
 * these pages get right or wrong is *where they send the reader*, so the routing has to be
 * the thing under test.
 */
function renderAuthRoutes(initialEntry: string, locale: Locale = 'en') {
  return render(
    <TranslationProvider initialLocale={locale}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/login" element={<LoginNextPage />} />
          <Route path="/register" element={<RegisterNextPage />} />
          <Route path="/auth/error" element={<AuthErrorNextPage />} />
          <Route path="/auth/inactive" element={<AccountInactiveNextPage />} />
          <Route path="/auth/loading" element={<AuthTransitionNextPage />} />
          <Route path="/auth/success" element={<AuthSuccessNextPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<p>dashboard</p>} />
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
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  clearToken()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('LoginNextPage', () => {
  it('draws the artboard: the eyebrow, the serif heading, both fields, the assurance line', () => {
    renderAuthRoutes('/login')

    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy()
    expect(screen.getByLabelText(/Email address/)).toBeTruthy()
    expect(screen.getByLabelText(/^Password/)).toBeTruthy()
    // The line the board puts UNDER the card, which is the question an employee about to
    // answer an anonymous survey is actually asking.
    expect(screen.getByText(/signing in only checks that you were invited/i)).toBeTruthy()
  })

  /**
   * The artboard's own annotation: the refusal appears above the first field, says that it
   * is deliberately vague, and the typed email is kept.
   */
  it('answers a 401 above the first field, saying why it will not name the wrong one', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid email or password' }), { status: 401 }),
    )

    renderAuthRoutes('/login')
    await userEvent.type(screen.getByLabelText(/Email address/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('That email and password do not match')).toBeTruthy()
    expect(within(alert).getByText(/nobody can find out which addresses have an account/i)).toBeTruthy()
    // Never the server's own sentence, which would claim the two had been told apart.
    expect(alert.textContent).not.toContain('Invalid email or password')
    expect(path()).toBe('/login')
    expect(screen.getByLabelText(/Email address/)).toHaveProperty('value', 'ana@meridiano.test')
  })

  it('hands a 503 to the error page and carries the administrator message', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Volvemos a las 14:00.' }), { status: 503 }),
    )

    renderAuthRoutes('/login')
    await userEvent.type(screen.getByLabelText(/Email address/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(path()).toBe('/auth/error?reason=maintenance'))
    expect(screen.getByTestId('state-message').textContent).toBe('Volvemos a las 14:00.')
    // And it is on the page, in the administrator's own words: for maintenance the message
    // is authored, per-locale content (#195) and the catalogue can only paraphrase it. The
    // board puts it between the phrase and the button.
    expect((await screen.findByRole('alert')).textContent).toBe('Volvemos a las 14:00.')
  })

  it('offers no Google button when the deployment has no client id', () => {
    // A "Continue with Google" that can only come back `invalid_client` is worse than no
    // button, which is what the board's second annotation says.
    renderAuthRoutes('/login')

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
  })

  it('draws the Google button and the divider when one is configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123.apps.googleusercontent.com')

    renderAuthRoutes('/login')

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(screen.getByText('or')).toBeTruthy()
  })

  it('shows the transition card, not the form, while the request is outstanding', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)

    renderAuthRoutes('/login')
    await userEvent.type(screen.getByLabelText(/Email address/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'pw')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'One moment…' })).toBeTruthy()
    // The form is gone, so it cannot be submitted a second time behind the wait.
    expect(screen.queryByLabelText(/Email address/)).toBeNull()
  })

  it('renders in Spanish, which is the language this screen is drawn in', () => {
    renderAuthRoutes('/login', 'es')

    expect(screen.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeTruthy()
    expect(screen.getByText('Use el correo corporativo al que le llegó la invitación.')).toBeTruthy()
    expect(screen.getByLabelText(/Correo electrónico/)).toBeTruthy()
  })
})

describe('RegisterNextPage', () => {
  it('states the two things signup decides silently, before anything is submitted', () => {
    renderAuthRoutes('/register')

    expect(screen.getByText('Your organization is assigned by your email domain; it is not chosen here.')).toBeTruthy()
    expect(screen.getByText(/You come in as an Employee/)).toBeTruthy()
    expect(
      screen.getByText('At least 8 characters, with an uppercase letter, a lowercase letter and a number.'),
    ).toBeTruthy()
  })

  it('will not submit a password the shipped policy would refuse', async () => {
    renderAuthRoutes('/register')
    const submit = screen.getByRole('button', { name: 'Create account' })
    expect(submit).toHaveProperty('disabled', false)

    await userEvent.type(screen.getByLabelText(/^Password/), 'sinmayuscula1')

    expect(screen.getByRole('button', { name: 'Create account' })).toHaveProperty('disabled', true)
    expect(fetch).not.toHaveBeenCalled()
  })

  /**
   * The board's annotation names the defect precisely: "Hoy aquí se imprime la frase del
   * servidor en inglés; la propuesta es esta frase del catálogo."
   */
  it('renders the 404 as the invitation route, in the catalogue words, naming the domain', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'No company found for this email domain. Please contact your administrator for an invitation.',
        }),
        { status: 404 },
      ),
    )

    renderAuthRoutes('/register', 'es')
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Ana')
    await userEvent.type(screen.getByLabelText(/Correo electrónico/), 'ana@gmail.com')
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'Contrasena1')
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }))

    const notice = await screen.findByRole('status')
    expect(within(notice).getByText('Este correo necesita una invitación')).toBeTruthy()
    expect(notice.textContent).toContain('gmail.com')
    // Not the server's English, and not a red failure: this is the onboarding rule.
    expect(notice.textContent).not.toContain('No company found')
    expect(screen.queryByRole('alert')).toBeNull()
    // And the form keeps everything typed, so nothing has to be redone.
    expect(screen.getByLabelText(/Correo electrónico/)).toHaveProperty('value', 'ana@gmail.com')
  })

  it('shows a 409 beside the form, in the server own words, rather than taking the page', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'User with this email already exists' }), { status: 409 }),
    )

    renderAuthRoutes('/register')
    await userEvent.type(screen.getByLabelText(/^Name/), 'Ana')
    await userEvent.type(screen.getByLabelText(/Email address/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Contrasena1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('User with this email already exists')).toBeTruthy()
    expect(path()).toBe('/register')
  })

  it('signs up and lands on the page that names the domain that decided the organisation', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ token: tokenFor({ role: 'employee', companyId: 'c1', name: 'Ana Rojas', email: 'ana@meridiano.test' }) }),
        { status: 201 },
      ),
    )

    renderAuthRoutes('/register')
    await userEvent.type(screen.getByLabelText(/^Name/), 'Ana Rojas')
    await userEvent.type(screen.getByLabelText(/Email address/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Contrasena1')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(path()).toBe('/auth/success'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Your account is ready' })).toBeTruthy()
    expect(screen.getByText('meridiano.test')).toBeTruthy()
    expect(getToken()).toBeTruthy()
  })

  it('links back to sign in, which is the one link this pair of pages keeps', () => {
    renderAuthRoutes('/register')

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })
})

describe('AuthErrorNextPage', () => {
  it('gives each reason its own sentence inside the one frame', async () => {
    renderAuthRoutes('/auth/error?reason=maintenance', 'es')

    expect(await screen.findByRole('heading', { level: 1, name: 'La plataforma está en mantenimiento' })).toBeTruthy()
    expect(screen.getByText(/No es un problema de su cuenta ni de su contraseña/)).toBeTruthy()
  })

  it('does not render an unrecognised reason as a key path', async () => {
    renderAuthRoutes('/auth/error?reason=auth.password')

    expect(await screen.findByRole('heading', { level: 1, name: 'We could not start your session' })).toBeTruthy()
    expect(screen.queryByText('auth.password')).toBeNull()
  })

  it('offers exactly one way out, and it is a fresh request to the server', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    renderAuthRoutes('/auth/error?reason=login-disabled')

    // One button, not "Retry" beside "Back to sign in" both going to the same place.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))

    expect(assign).toHaveBeenCalledWith('/login')
    assign.mockRestore()
  })
})

describe('AccountInactiveNextPage', () => {
  it('answers the two questions the board asks, and names the button for what it does', () => {
    renderAuthRoutes('/auth/inactive', 'es')

    expect(screen.getByRole('heading', { level: 1, name: 'Esta cuenta fue desactivada' })).toBeTruthy()
    expect(screen.getByText('A quién pedírselo')).toBeTruthy()
    expect(screen.getByText('Qué se conserva')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Cerrar sesión y volver al inicio/ })).toBeTruthy()
  })

  it('clears the token only when the reader leaves, never on mount', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1', isActive: 'false' }))
    renderAuthRoutes('/auth/inactive')

    // Still held while the explanation is on screen — clearing on mount would race
    // RequireAuth's redirect and bounce them before they read it.
    expect(getToken()).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /Sign out and go back to the start/ }))

    await waitFor(() => expect(path()).toBe('/login'))
    expect(getToken()).toBeNull()
  })

  it('is where RequireAuth sends a session whose account was switched off', async () => {
    // The claim is a STRING — `JwtTokenService` emits "true"/"false" — so `!claims.isActive`
    // is false for the string "false" and would let a deactivated session straight through.
    setToken(tokenFor({ role: 'employee', companyId: 'c1', isActive: 'false' }))

    renderAuthRoutes('/surveys/my')

    await waitFor(() => expect(path()).toBe('/auth/inactive'))
    expect(screen.queryByText('guarded page')).toBeNull()
  })
})

describe('AuthSuccessNextPage', () => {
  it('refuses to congratulate a visitor with no token', async () => {
    renderAuthRoutes('/auth/success')

    await waitFor(() => expect(path()).toBe('/login'))
  })

  it('names the domain off the minted token, not the company, which it cannot resolve', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1', name: 'Ana', email: 'ana@meridiano.test', isActive: 'true' }))
    renderAuthRoutes('/auth/success', 'es')

    expect(await screen.findByText('ana@meridiano.test')).toBeTruthy()
    expect(screen.getByText('meridiano.test')).toBeTruthy()
    expect(screen.getByText('Empleado')).toBeTruthy()
  })

  it('continues to a page the new employee can actually load', async () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1', email: 'ana@meridiano.test', isActive: 'true' }))
    renderAuthRoutes('/auth/success')

    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(path()).toBe('/dashboard'))
    expect(await screen.findByText('dashboard')).toBeTruthy()
  })
})

/**
 * `/auth/loading` — the Google round trip (#81 AC1/AC4). The exits are the whole component,
 * so they are the whole test.
 */
describe('AuthTransitionNextPage', () => {
  const CLIENT_ID = '123.apps.googleusercontent.com'

  /** Starts a handshake the way the sign-in button does and builds the matching callback. */
  function callbackUrl(claims: Record<string, unknown> = {}): string {
    const authUrl = new URL(beginGoogleSignIn(CLIENT_ID, 'https://app.example'))
    const state = authUrl.searchParams.get('state') as string
    const nonce = authUrl.searchParams.get('nonce') as string
    return `/auth/loading#id_token=${tokenFor({ nonce, ...claims })}&state=${state}`
  }

  it('states the wait rather than showing a blank page while the exchange runs', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>)

    renderAuthRoutes(callbackUrl(), 'es')

    expect(await screen.findByRole('heading', { level: 1, name: 'Un momento…' })).toBeTruthy()
    expect(screen.getByText('Estamos terminando de iniciar su sesión con Google.')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('exchanges the callback token and lands the employee on a page they can load', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFor({ role: 'employee', companyId: 'c1', isActive: 'true' }) }), {
        status: 200,
      }),
    )

    renderAuthRoutes(callbackUrl({ email: 'ana@meridiano.test' }))

    await waitFor(() => expect(path()).toBe('/dashboard'))
    expect(getToken()).toBeTruthy()
    const [url] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/auth\/google$/)
  })

  it('sends a bare visit back to sign-in rather than inventing a failure', async () => {
    renderAuthRoutes('/auth/loading')

    await waitFor(() => expect(path()).toBe('/login'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves a pending handshake intact when nobody came back from Google', async () => {
    beginGoogleSignIn(CLIENT_ID, 'https://app.example')
    const before = peekGoogleHandshake()

    renderAuthRoutes('/auth/loading')

    await waitFor(() => expect(path()).toBe('/login'))
    expect(peekGoogleHandshake()).toEqual(before)
    expect(before).not.toBeNull()
  })

  /**
   * Login CSRF. A URL fragment is attacker-writable, so without the state check
   * `/auth/loading#id_token=<attacker's token>` silently signs the victim into the
   * ATTACKER's account. The assertion that matters most is that the token is never sent.
   */
  it('never exchanges a token whose state this browser did not issue', async () => {
    beginGoogleSignIn(CLIENT_ID, 'https://app.example')
    const handshake = peekGoogleHandshake()
    // The genuine nonce, so the forged `state` is the only thing left that can reject it.
    const planted = tokenFor({ nonce: handshake!.nonce, email: 'attacker@evil.test' })

    renderAuthRoutes(`/auth/loading#id_token=${planted}&state=forged`)

    await waitFor(() => expect(path()).toBe('/auth/error?reason=google-signin'))
    expect(fetch).not.toHaveBeenCalled()
    expect(getToken()).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: 'Signing in with Google did not finish' })).toBeTruthy()
  })

  it('routes maintenance from the exchange exactly as the sign-in form does', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Volvemos a las 14:00.' }), { status: 503 }),
    )

    renderAuthRoutes(callbackUrl())

    await waitFor(() => expect(path()).toBe('/auth/error?reason=maintenance'))
  })

  it('keeps the server sentence on a 404 from the exchange, which is the only thing saying why', async () => {
    // Since #280 `/auth/google` refuses an address whose domain no company has registered.
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'No company found for this email domain.' }), { status: 404 }),
    )

    renderAuthRoutes(callbackUrl())

    await waitFor(() => expect(path()).toBe('/auth/error?reason=google-signin'))
    expect(screen.getByTestId('state-message').textContent).toBe('No company found for this email domain.')
  })
})

/**
 * Where a successful sign-in LANDS, when something sent this visitor here with a destination.
 *
 * ## Why this block exists here and not on `auth/LoginPage.test.tsx`
 *
 * The invitations lane wrote this guarantee against `auth/LoginPage.tsx`, which was the
 * routed component when that lane was cut. This lane re-pointed `/login` at
 * `LoginNextPage`, and the two lanes touched **different files** — so the merge produced no
 * conflict, every gate stayed green, and the promise silently stopped being kept.
 *
 * A test left on the unrouted page is worse than no test at all: it reports a guarantee as
 * held on a component nothing mounts. So it moved here, onto the model the router actually
 * runs (`useSignInModel`). `returnPath.test.ts` still unit-tests the guard itself; this is
 * the seam where the promise is kept or broken.
 *
 * The label that makes it a promise is `microclimates.next.invitation.signInAction` —
 * «Iniciar sesión y volver aquí» — on the MicroclimateInvitationStates artboard.
 */
describe('LoginNextPage — the return destination', () => {
  function renderLoginWithState(state: unknown) {
    return render(
      <TranslationProvider initialLocale="en">
        <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
          <LocationProbe />
          <Routes>
            <Route path="/login" element={<LoginNextPage />} />
            <Route path="/dashboard" element={<p>dashboard</p>} />
            <Route path="/microclimate-invitations/:token" element={<p>the invitation</p>} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  async function signIn() {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFor({ role: 'employee', companyId: 'c1' }) }), { status: 200 }),
    )
    await userEvent.type(screen.getByLabelText(/Email address/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Contrasena1')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('returns to the page that sent them, rather than to the dashboard', async () => {
    renderLoginWithState({ from: '/microclimate-invitations/tok-42' })
    await signIn()

    await waitFor(() => expect(path()).toBe('/microclimate-invitations/tok-42'))
    expect(screen.getByText('the invitation')).toBeTruthy()
    expect(screen.queryByText('dashboard')).toBeNull()
  })

  it('lands on the dashboard when nothing named a destination', async () => {
    renderLoginWithState(undefined)
    await signIn()

    await waitFor(() => expect(path()).toBe('/dashboard'))
  })

  /**
   * `location.state` is not in the URL, but `history.pushState` can put any JSON there, so
   * it is validated as untrusted input rather than trusted for its provenance. A
   * protocol-relative `//evil.test` is another ORIGIN, and a sign-in that honoured it would
   * hand a freshly authenticated visitor to whoever wrote the state.
   */
  it('refuses a destination on another origin and falls back to the dashboard', async () => {
    renderLoginWithState({ from: '//evil.test/steal' })
    await signIn()

    await waitFor(() => expect(path()).toBe('/dashboard'))
  })
})
