import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import PublicSurveyLinkPage from './PublicSurveyLinkPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { SurveyRespondView } from '../api/surveyResponses'
import type { SurveyPublicLinkDetail } from '../api/surveyLinks'

const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function link(overrides: Partial<SurveyPublicLinkDetail> = {}): SurveyPublicLinkDetail {
  return {
    surveyId: 'survey-77',
    surveyTitle: 'Clima laboral 2026',
    surveyDescription: 'Tu opinión es confidencial',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    surveyStartDate: '2026-01-01T00:00:00Z',
    surveyEndDate: '2026-12-31T00:00:00Z',
    requireLogin: false,
    allowAnonymous: true,
    singleResponse: true,
    ...overrides,
  }
}

function respondView(): SurveyRespondView {
  return {
    id: 'survey-77',
    title: 'Clima laboral 2026',
    description: null,
    type: 'general_climate',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-31T00:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1',
        text: '¿Cómo te sientes?',
        type: 'multiple_choice',
        options: [{ order: 0, value: 'good', label: 'Bien' }],
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
  }
}

/**
 * Answers the resolve and the respond read separately, so a test can make one fail
 * without the other — which is the whole shape of this page: two requests, and the
 * second only happens because the first succeeded.
 */
function serve(options: {
  resolve?: () => Response
  respond?: () => Response
}): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/survey-links/')) {
      return Promise.resolve(
        options.resolve?.() ?? new Response(JSON.stringify(link()), { status: 200 }),
      )
    }
    return Promise.resolve(
      options.respond?.() ?? new Response(JSON.stringify(respondView()), { status: 200 }),
    )
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
        <Routes>
          <Route path="/s/:token" element={<PublicSurveyLinkPage />} />
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

describe('PublicSurveyLinkPage', () => {
  /**
   * The defect this page exists for: `survey_distributions.public_url` holds
   * `/s/{token}`, an administrator copies it out of `ShareLinkPanel`, and the router
   * had no such path — so the link the product hands out reached the error boundary.
   */
  it('turns an opaque share token into the survey it opens', async () => {
    serve({})
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Clima laboral 2026' })).toBeTruthy()

    const resolved = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(resolved[0]).toContain(`/survey-links/${TOKEN}`)
    // The survey id came from the resolve, not from the URL — nothing in the token
    // names it.
    expect(resolved.some((url) => url.includes('/surveys/survey-77/respond'))).toBe(true)
  })

  /**
   * One request, not one per language switch. The resolve is what increments
   * `survey_distributions.total_accesses`, and it is the only access figure an
   * administrator gets.
   */
  it('resolves the token once, because resolving it counts as a visit', async () => {
    serve({})
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })

    const resolves = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/survey-links/'))
    expect(resolves).toHaveLength(1)
    // And with no `?lang=`: the localized title it returns is never rendered here.
    expect(String(resolves[0][0])).not.toContain('lang=')
  })

  it('says one honest thing about a dead link, since the server says one thing', async () => {
    serve({ resolve: () => new Response(JSON.stringify({ message: 'nope' }), { status: 404 }) })
    renderPage()

    expect(await screen.findByText('Este enlace no abre ninguna encuesta')).toBeTruthy()
    // Never a claim the server refused to make. It answers the same 404 for unknown,
    // revoked and out-of-window precisely so a dead URL confirms nothing.
    expect(screen.queryByText(/anulada|caducado/)).toBeNull()
  })

  it('does not ask the respond endpoint for a survey the link never resolved', async () => {
    serve({ resolve: () => new Response(JSON.stringify({ message: 'nope' }), { status: 404 }) })
    renderPage()

    await screen.findByText('Este enlace no abre ninguna encuesta')
    expect(
      vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes('/respond')),
    ).toHaveLength(0)
  })

  /**
   * `authFetch` clears the token and hard-redirects to `/login` on a 401. A respondent
   * holding nothing but a link would be thrown off the page before an error rendered.
   */
  it('renders the failure instead of throwing the visitor at a sign-in form', async () => {
    setToken('stale')
    serve({ resolve: () => new Response(JSON.stringify({ message: 'nope' }), { status: 401 }) })
    renderPage()

    expect(await screen.findByText('No se pudo cargar esta encuesta')).toBeTruthy()
    expect(window.localStorage.getItem('climate_platform_token')).toBe('stale')
  })

  /**
   * The share link and the anonymous respond route are one surface. A third respond
   * implementation would be a third place for the anonymity promise to be forgotten.
   */
  it('hands over to the existing respond form rather than a third one', async () => {
    serve({})
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.getByText('Esta encuesta es anónima')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar mis respuestas' })).toBeTruthy()
  })

  it('renders none of the authenticated shell, even with a token in storage', async () => {
    setToken('an-admin-jwt')
    serve({})
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: /sign out|cerrar sesión/i })).toBeNull()
  })

  /** A visitor stuck in the wrong language on this page cannot answer at all. */
  it('offers the language picker while the token is still resolving', () => {
    serve({ resolve: () => new Response(JSON.stringify(link()), { status: 200 }) })
    renderPage()

    expect(screen.getByRole('combobox', { name: 'Cambiar Idioma' })).toBeTruthy()
  })
})
