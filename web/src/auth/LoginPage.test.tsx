import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import LoginPage from './LoginPage'
import { TranslationProvider } from '../i18n'
import { LOCALE_STORAGE_KEY } from '../i18n/locale'

/**
 * What the sign-in page *offers*, as opposed to what it does with a response.
 *
 * The failure triage — 401 beside the fields, 403/503 to `/auth/error` — is pinned
 * in `authPages.test.tsx`, which mounts the whole auth route table to assert where
 * a login lands. Nothing here needs a router beyond a `MemoryRouter` for the links
 * `AuthShell` renders, because every assertion is about what is on the page before
 * anybody types.
 *
 * Two of them are absence assertions, and both are absences the product decided on
 * rather than omissions:
 *
 * - **No "Create an account".** `POST /auth/signup` derives the company from the
 *   email domain and 400s when nothing is registered for it. Employees arrive by
 *   bulk import or `/accept-invitation/:token`, so for almost everyone who reaches
 *   this page that link was a round trip to a refusal.
 * - **No password-reset link.** The `/auth` surface is login, signup, google,
 *   refresh and the admin-only reset-credentials — there is no reset endpoint to
 *   point at. The page says so in plain text instead, and the orphaned
 *   `auth.forgotPassword` key stays orphaned.
 */
function renderLogin() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('LoginPage', () => {
  it('offers no way to create an account, because self-signup refuses almost everyone here', () => {
    renderLogin()

    expect(screen.queryByRole('link', { name: /create an account/i })).toBeNull()
    // Not just the link: nothing on the page should be inviting them to try.
    expect(screen.queryByText(/don't have an account/i)).toBeNull()
  })

  /**
   * The copy has to be copy. A link would need an `href`, and every candidate is a
   * route this API cannot serve — which is how the prototype's "Forgot your
   * password?" would have shipped as a 404 with a helpful-sounding label on it.
   */
  it('says how to get a password reset without linking anywhere', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    renderLogin()

    const help = screen.getByText('Forgotten your password? Ask your administrator to reset it.')
    expect(help.closest('a')).toBeNull()
    expect(screen.queryByRole('link', { name: /forgot/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /forgot/i })).toBeNull()
  })

  it('translates that help rather than hardcoding it', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderLogin()

    expect(screen.queryByText(/Forgotten your password/)).toBeNull()
    expect(
      screen.getByText('¿Olvidó su contraseña? Pida a su administrador que la restablezca.'),
    ).toBeTruthy()
  })

  /**
   * The one screen every role shares, and the first one an invited employee opens.
   * It wore no mark at all — the card began at the words "Sign In".
   */
  it('wears the brand lockup', () => {
    const { container } = renderLogin()

    const lockup = container.querySelector('[data-slot="brand-lockup"]')
    expect(lockup).toBeTruthy()
    expect(lockup?.textContent).toBe('CLIMATE')
  })

  /**
   * Under the card rather than inside it, and it is the whole reason this page is
   * on an employee's path at all: signing in is a check that you were invited, and
   * an employee about to answer an anonymous survey is entitled to be told it has
   * nothing to do with their answers.
   */
  it('carries the assurance about what signing in is and is not', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    renderLogin()

    expect(
      screen.getByText(
        'Signing in only checks that you were invited. It is never attached to the answers you give.',
      ),
    ).toBeTruthy()
  })

  it('still asks for the two things it needs, and nothing else', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    renderLogin()

    expect(screen.getByLabelText(/Email/)).toBeTruthy()
    expect(screen.getByLabelText(/Password/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
  })
})

/**
 * Where a successful sign-in LANDS, when something sent this visitor here with a
 * destination.
 *
 * Added by the invitations lane. The MicroclimateInvitationStates artboard (10 Sep) draws
 * one card whose whole action is "Iniciar sesión y volver aquí", and that label is a
 * promise the product could not keep: this page navigated to `resolveInitialRoute()`
 * unconditionally, so the respondent landed on `/dashboard` and had to go back to their
 * email for the link. The guard itself is unit-tested in `returnPath.test.ts`; this is the
 * seam where the promise is kept or broken, and it is the one place a test of the guard
 * alone would not have noticed.
 */
describe('LoginPage — the return destination', () => {
  function renderWithState(state: unknown) {
    return render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<p>dashboard page</p>} />
            <Route path="/microclimate-invitations/:token" element={<p>the invitation</p>} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  async function signIn() {
    await userEvent.type(screen.getByLabelText(/Email/), 'ana@meridiano.test')
    await userEvent.type(screen.getByLabelText(/Password/), 'Correct-Horse-9')
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }))
  }

  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ token: 'a.b.c' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns to the page that sent them, rather than to the dashboard', async () => {
    renderWithState({ from: '/microclimate-invitations/tok-42' })
    await signIn()

    expect(await screen.findByText('the invitation')).toBeTruthy()
    expect(screen.queryByText('dashboard page')).toBeNull()
  })

  it('lands on the dashboard when nothing named a destination', async () => {
    renderWithState(undefined)
    await signIn()

    expect(await screen.findByText('dashboard page')).toBeTruthy()
  })

  /**
   * `location.state` is not in the URL, but `history.pushState` can put any JSON there, so
   * it is validated as untrusted input rather than trusted for its provenance. A
   * protocol-relative `//evil.test` is another ORIGIN, and a sign-in that honoured it would
   * hand a freshly authenticated visitor to whoever wrote the state.
   */
  it('refuses a destination on another origin and falls back to the dashboard', async () => {
    renderWithState({ from: '//evil.test/steal' })
    await signIn()

    expect(await screen.findByText('dashboard page')).toBeTruthy()
  })
})
