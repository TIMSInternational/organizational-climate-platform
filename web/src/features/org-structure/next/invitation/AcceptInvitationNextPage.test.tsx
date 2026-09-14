import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import AcceptInvitationNextPage from './AcceptInvitationNextPage'
import { TranslationProvider } from '../../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../../i18n/locale'
import { clearToken, getToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'

const INVITE = 'inv-token-123'

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/accept-invitation/${INVITE}`]}>
        <Routes>
          <Route path="/accept-invitation/:token" element={<AcceptInvitationNextPage />} />
          <Route path="/admin/companies/:companyId/users" element={<p>users page</p>} />
          <Route path="/dashboard" element={<p>dashboard page</p>} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function fillAndSubmit(name = 'Ana Rojas', password = 'Correct-Horse-9') {
  await userEvent.type(screen.getByLabelText(/^Nombre/), name)
  await userEvent.type(screen.getByLabelText(/^Contraseña/), password)
  await userEvent.click(screen.getByRole('button', { name: 'Unirme' }))
}

/** A refusal exactly as `InvitationAcceptEndpoints.AcceptAsync` sends it. */
function refusal(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), { status })
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
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

describe('AcceptInvitationNextPage — the form', () => {
  it('draws the invitation card the artboard does, in Spanish, with the password rule under the field', () => {
    renderPage()
    expect(screen.getByText('Invitación')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Únase a su organización' })).toBeTruthy()
    expect(screen.getByLabelText(/^Nombre/)).toBeTruthy()
    expect(screen.getByLabelText(/^Contraseña/)).toBeTruthy()
    expect(
      screen.getByText('Al menos 8 caracteres, con una mayúscula, una minúscula y un número.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toBeTruthy()
    expect(
      screen.getByText(
        'En las encuestas anónimas, su cuenta solo comprueba que usted pertenece a su organización; no se vincula con sus respuestas.',
      ),
    ).toBeTruthy()
  })

  /**
   * The artboard proposes a block naming the company, the inviter and the role and marks it
   * "dato nuevo". There is no public read for an invitation token — the only route is the
   * POST that submits the form — so the page must not appear to know any of it.
   */
  it('claims nothing about the invitation it cannot read', () => {
    renderPage()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Rol')
    expect(text).not.toContain('Invitó')
    expect(screen.queryByText('Empleado')).toBeNull()
  })

  it('disables the submit while a typed password is shorter than the minimum', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'short')
    expect((screen.getByRole('button', { name: 'Unirme' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'er-and-longer')
    expect((screen.getByRole('button', { name: 'Unirme' }) as HTMLButtonElement).disabled).toBe(false)
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
    expect(await screen.findByRole('heading', { name: 'Cuenta Creada' })).toBeTruthy()
    expect(screen.queryByText('users page')).toBeNull()
  })
})

describe('AcceptInvitationNextPage — a refusal that ends the invitation', () => {
  /**
   * The artboard's own words: these three arrive today as the server's English sentence —
   * «Invitation has expired» — above a form that will refuse every further submission. They
   * are now the catalogue's sentence, in the reader's language, IN PLACE OF the form.
   */
  it.each([
    [400, 'Invitation has expired', 'Esta invitación caducó', false],
    [409, 'Invitation has already been accepted', 'Esta invitación ya se usó', true],
    [404, 'Invitation not found', 'No encontramos esta invitación', false],
    [409, 'A user with this email already exists', 'Ya existe una cuenta con este correo', true],
  ])('replaces the form for %i %s', async (status, message, title, offersSignIn) => {
    vi.mocked(fetch).mockResolvedValue(refusal(status, message))
    renderPage()
    await fillAndSubmit()

    expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unirme' })).toBeNull()
    expect(screen.queryByLabelText(/^Contraseña/)).toBeNull()
    // The server's English is gone from the screen, not merely translated beside it.
    expect(document.body.textContent).not.toContain(message)
    expect(Boolean(screen.queryByRole('link', { name: 'Iniciar sesión' }))).toBe(offersSignIn)
    await waitFor(() => expect(getToken()).toBeNull())
  })

  it('reuses the deactivated-account sentence when the mint refuses the new user', async () => {
    vi.mocked(fetch).mockResolvedValue(refusal(401, 'Account is not active'))
    renderPage()
    await fillAndSubmit()
    expect(await screen.findByRole('heading', { name: 'Esta cuenta fue desactivada' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unirme' })).toBeNull()
  })
})

describe('AcceptInvitationNextPage — a refusal the invitee can fix', () => {
  /**
   * The failure that would cost somebody their account: a correctable refusal replaced by a
   * dead end. `400` is the status of an expired invitation AND of a password that misses
   * the policy, and the password message is the only statement of WHICH requirement was
   * missed — the policy is configurable and this page cannot read it.
   */
  it.each([
    [400, 'Password must be at least 12 characters long, contain a special character'],
    [400, 'Email domain does not match this company'],
    [400, 'Email is required for a shareable-link invitation'],
    [400, 'Invalid email format'],
  ])('keeps the form and shows the server’s own words for %i %s', async (status, message) => {
    vi.mocked(fetch).mockResolvedValue(refusal(status, message))
    renderPage()
    await fillAndSubmit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(message)
    expect(screen.getByRole('button', { name: 'Unirme' })).toBeTruthy()
    expect(getToken()).toBeNull()
  })

  it('shows the status when the refusal carries no message, never a blank alert', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 500 }))
    renderPage()
    await fillAndSubmit()
    const alert = await screen.findByRole('alert')
    // `acceptInvitation` turns a bodiless failure into `Request failed: 500`; the page shows
    // what it was given. Pinned so a future change to either side is a deliberate one.
    expect(alert.textContent).toBe('Request failed: 500')
    expect(screen.getByRole('button', { name: 'Unirme' })).toBeTruthy()
  })

  /** A reworded server message must degrade to the old screen, never to a wrong one. */
  it('keeps the form when the server rewords a sentence this build knows', async () => {
    vi.mocked(fetch).mockResolvedValue(refusal(400, 'This invitation has expired'))
    renderPage()
    await fillAndSubmit()
    expect((await screen.findByRole('alert')).textContent).toBe('This invitation has expired')
    expect(screen.getByRole('button', { name: 'Unirme' })).toBeTruthy()
  })
})
