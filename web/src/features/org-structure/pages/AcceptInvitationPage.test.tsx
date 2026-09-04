import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import AcceptInvitationPage from './AcceptInvitationPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { clearToken, getToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'

/**
 * `/accept-invitation/:token` is the only way most users of this product are created, and
 * it had no test at all (measured 2026-09-03; `docs/verification/138-non-admin-roles.md`
 * separately records that no invitation was accepted in a browser during that run).
 *
 * Four things are pinned: the request the form sends, where each role lands afterwards
 * (`resolvePostAcceptRoute`), the branch for a token with no company, and that a refusal
 * is shown in words on the same page rather than as a dead form.
 */
const INVITE = 'inv-token-123'

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/accept-invitation/${INVITE}`]}>
        <Routes>
          <Route path="/accept-invitation/:token" element={<AcceptInvitationPage />} />
          <Route path="/admin/companies/:companyId/users" element={<p>users page</p>} />
          <Route path="/dashboard" element={<p>dashboard page</p>} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function fillAndSubmit(name = 'Ana Rojas', password = 'Correct-Horse-9') {
  await userEvent.type(screen.getByLabelText(/^Name/), name)
  await userEvent.type(screen.getByLabelText(/^Password/), password)
  await userEvent.click(screen.getByRole('button', { name: 'Create an account' }))
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  clearToken()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AcceptInvitationPage', () => {
  it('renders the invitation form with the password rule the server enforces', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Accept invitation' })).toBeTruthy()
    expect(screen.getByLabelText(/^Name/)).toBeTruthy()
    expect(screen.getByLabelText(/^Password/)).toBeTruthy()
    expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy()
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy()
  })

  it('disables the submit while a typed password is shorter than the minimum', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^Password/), 'short')
    expect((screen.getByRole('button', { name: 'Create an account' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/^Password/), 'er-and-longer')
    expect((screen.getByRole('button', { name: 'Create an account' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('POSTs the token’s accept route, stores the session, and sends a company admin to their users page', async () => {
    const jwt = tokenFor({ sub: 'u1', role: 'company_admin', companyId: 'c9' })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ token: jwt }), { status: 200 }))
    renderPage()
    await fillAndSubmit()

    expect(await screen.findByText('users page')).toBeTruthy()
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(new RegExp(`/invitations/${INVITE}/accept$`))
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Ana Rojas', password: 'Correct-Horse-9' })
    expect(getToken()).toBe(jwt)
  })

  it('sends an employee to the dashboard', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFor({ sub: 'u2', role: 'employee', companyId: 'c9' }) }), { status: 200 }),
    )
    renderPage()
    await fillAndSubmit()
    expect(await screen.findByText('dashboard page')).toBeTruthy()
  })

  it('confirms success in place for a token that carries no company, rather than navigating into a 403', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ token: tokenFor({ sub: 'u3', role: 'super_admin' }) }), { status: 200 }),
    )
    renderPage()
    await fillAndSubmit()
    expect(await screen.findByRole('heading', { name: 'Account created' })).toBeTruthy()
    expect(screen.queryByText('users page')).toBeNull()
    expect(screen.queryByText('dashboard page')).toBeNull()
  })

  it('shows a refused invitation on the same page, in words, with the form still usable', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This invitation has expired' }), { status: 400 }),
    )
    renderPage()
    await fillAndSubmit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This invitation has expired')
    expect(getToken()).toBeNull()
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeTruthy()
  })

  it('shows the status when the refusal carries no message, never a blank alert', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }))
    renderPage()
    await fillAndSubmit()
    const alert = await screen.findByRole('alert')
    // `acceptInvitation` turns a bodiless failure into `Request failed: 500`; the page shows
    // what it was given. Pinned so a future change to either side is a deliberate one.
    expect(alert.textContent).toBe('Request failed: 500')
    await waitFor(() => expect(getToken()).toBeNull())
  })
})
