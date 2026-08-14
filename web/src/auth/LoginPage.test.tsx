import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
