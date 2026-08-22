import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import PublicSurveyRespondPage from './PublicSurveyRespondPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { SurveyRespondView } from '../api/surveyResponses'

function view(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 's1',
    title: 'Clima laboral 2026',
    description: 'Tu opinión es confidencial',
    type: 'general_climate',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-31T00:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    autoSave: true,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1',
        text: '¿Cómo te sientes?',
        type: 'multiple_choice',
        options: [
          { order: 0, value: 'good', label: 'Bien' },
          { order: 1, value: 'bad', label: 'Mal' },
        ],
        scaleMin: null,
        scaleMax: null,
        scaleLabelMin: null,
        scaleLabelMax: null,
        required: true,
        commentRequired: false,
        commentPrompt: null,
        order: 0,
        category: null,
      },
    ],
    inProgress: null,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/survey/s1']}>
        <Routes>
          <Route path="/survey/:id" element={<PublicSurveyRespondPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  clearToken()
})

describe('PublicSurveyRespondPage', () => {
  it('lets a visitor with no account answer and submit', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(
              JSON.stringify({
                responseId: 'r1',
                sessionId: 'session-1',
                isComplete: true,
                isAnonymous: true,
                alreadySubmitted: false,
                language: 'es',
                answeredQuestionCount: 1,
                questionCount: 1,
                suppressedDemographics: [],
              }),
              { status: 201 },
            )
          : new Response(JSON.stringify(view()), { status: 200 }),
      ),
    )

    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    expect(await screen.findByText('Gracias, sus respuestas fueron recibidas')).toBeTruthy()
    // No token anywhere near the request. `authFetch` is deliberately not used here:
    // its 401 handling would clear storage and hard-redirect to /login, throwing a
    // genuinely anonymous respondent off the form before anything could render.
    const headers = new Headers((vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBeNull()
  })

  /**
   * The whole reason this page does not use `AdminLayout`. The shell reads the JWT
   * claims to build a role-aware nav, mounts the company-context switcher and a
   * sign-out control — every one of which is a way for a tenant's structure to appear
   * on a page anyone holding a link can open.
   */
  it('renders none of the authenticated shell', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }))
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })

    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: /sign out|cerrar sesión/i })).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('still renders no shell when a token happens to be present', async () => {
    // An administrator previewing the public link is a real case. The route must not
    // quietly become the admin shell because a token exists in this browser.
    setToken('some-admin-jwt')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }))
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  /**
   * A respondent arriving from an email has no stored preference and no authenticated
   * locale. This is the one page where being unable to change the language means
   * being unable to answer at all.
   */
  it('offers a language picker', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }))
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.getByRole('combobox', { name: 'Cambiar Idioma' })).toBeTruthy()
  })

  it('offers a skip link, so the survey is the first thing a keyboard reaches', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }))
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    const skip = screen.getByRole('link', { name: 'Ir a la encuesta' })
    expect(skip.getAttribute('href')).toBe('#survey')
    expect(container.querySelector('#survey')).toBeTruthy()
    // First in the DOM, so it is also first in the tab order.
    expect(container.firstElementChild?.firstElementChild).toBe(skip)
  })

  it('names the survey the respondent is answering, and nothing about the company', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Clima laboral 2026' })).toBeTruthy()
    expect(screen.getByText('Esta encuesta es anónima')).toBeTruthy()
  })

  /**
   * The server answers 401 for an anonymous visitor whenever the survey is closed OR
   * not configured anonymous, and deliberately does not say which — "this exists but
   * is not anonymous" is a disclosure about a tenant's survey. The copy has to be
   * honest about that ambiguity rather than guessing one of the two.
   */
  it('does not guess which of the two reasons a 401 means', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This survey is not currently available' }), {
        status: 401,
      }),
    )
    renderPage()

    expect(await screen.findByText('Esta encuesta no está disponible')).toBeTruthy()
    expect(screen.getByText(/Puede que haya cerrado o que solo esté abierta/)).toBeTruthy()
    // And it offers the one action that might help.
    expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe('/login')
  })

  it('does not send the visitor to /login on a 401, it renders the page', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This survey is not currently available' }), {
        status: 401,
      }),
    )
    setToken('stale')
    renderPage()

    await waitFor(() => expect(screen.getByText('Esta encuesta no está disponible')).toBeTruthy())
    // `authFetch` would have cleared the token and navigated away by now.
    expect(window.localStorage.getItem('climate_platform_token')).toBe('stale')
  })

  it('reports a closed survey distinctly from a missing one', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'This survey is not currently accepting responses' }), {
        status: 400,
      }),
    )
    renderPage()

    expect(await screen.findByText('Esta encuesta está cerrada')).toBeTruthy()
  })
})
