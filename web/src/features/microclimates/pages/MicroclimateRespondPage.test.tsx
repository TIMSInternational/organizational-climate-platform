import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MicroclimateRespondPage from './MicroclimateRespondPage'
import { clearToken } from '../../../auth/token'

const baseUrl = 'http://api.test'

const publicDetail = {
  id: 'm1',
  title: 'Weekly pulse',
  description: null,
  status: 'active',
  questions: [{ id: 'q1', text: 'How are you?', type: 'open_text', options: null, required: true, order: 1 }],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/microclimates/m1/respond']}>
      <Routes>
        <Route path="/microclimates/:id/respond" element={<MicroclimateRespondPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MicroclimateRespondPage (anonymous access)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', baseUrl)
    // No token at all -- this is the genuinely anonymous visitor this page must serve.
    // If any code path here used authFetch against an authenticated route, the mocked
    // fetch below would still 401 (real backend behavior for that route) and, per
    // authFetch's own 401 handler, would hard-redirect via window.location.href.
    clearToken()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' } as unknown as Location,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('loads and renders the form for an anonymous visitor without ever redirecting to /login', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(publicDetail), { status: 200 }))

    renderPage()

    expect(await screen.findByText('Weekly pulse')).toBeInTheDocument()
    expect(screen.getByText('How are you?')).toBeInTheDocument()

    // Fetched the AllowAnonymous /respond route, not the authenticated /microclimates/{id} route.
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1/respond`)
    // No Authorization header was ever sent -- this is a plain fetch, not authFetch.
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers((init as RequestInit | undefined)?.headers).has('Authorization')).toBe(false)
    // authFetch's 401 handler (the historical bug: 401 on the authenticated route redirects
    // to /login before the form renders) never fired.
    expect(window.location.href).toBe('')
  })

  it('submits an answer anonymously once the form has loaded', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(publicDetail), { status: 200 }))
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 201 }))

    renderPage()
    await screen.findByText('Weekly pulse')

    await user.type(screen.getByLabelText('How are you?'), 'Doing great')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByText('Thank you for your response.')).toBeInTheDocument()
    expect(fetch).toHaveBeenLastCalledWith(
      `${baseUrl}/microclimates/m1/responses`,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces a 404 error from the backend without treating it as an auth failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Microclimate not found' }), { status: 404 }))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Microclimate not found')
    expect(window.location.href).toBe('')
  })
})
