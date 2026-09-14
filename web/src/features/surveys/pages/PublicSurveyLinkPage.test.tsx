import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function respondView(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 'survey-77',
    title: 'Clima laboral 2026',
    description: null,
    type: 'general_climate',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-10-10T00:00:00Z',
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
    ...overrides,
  }
}

/**
 * Answers the resolve and the respond read separately, so a test can make one fail
 * without the other — which is the whole shape of this page: two requests, and the
 * second only happens because the first succeeded.
 */
function serve(options: { resolve?: () => Response; respond?: () => Response }): void {
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

/** The entry card, then the button that hands over to the questions. */
async function begin(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: /Empezar/ }))
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
   * The entry, as PublicRespondEntry draws it: what this is, when it closes, how many
   * questions, what is and is not stored, and the one action.
   */
  it('draws the entry card before the first question', async () => {
    serve({})
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Clima laboral 2026' })).toBeTruthy()
    // "6 preguntas..." is derived from the payload; this fixture carries one.
    expect(screen.getByText('Una pregunta. Menos de un minuto.')).toBeTruthy()
    expect(screen.getByText('Cierra')).toBeTruthy()
    expect(screen.getByText('10 oct')).toBeTruthy()
    expect(screen.getByText('Preguntas')).toBeTruthy()
    expect(screen.getByText('Esta encuesta es anónima')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Empezar/ })).toBeTruthy()
    // Not the questions, yet.
    expect(screen.queryByRole('radio', { name: 'Bien' })).toBeNull()
  })

  /**
   * The trap this page is one line away from at all times.
   *
   * `SurveyPublicLinkDetail.allowAnonymous` is
   * `SurveyDistribution.AccessRules.AllowAnonymous` — who may OPEN the link — while the
   * promise is about `Survey.Settings.Anonymous`, which is whether the response is
   * written with a user id on it. They are different columns and they disagree here: the
   * link allows anonymous visitors, the survey records who answers. Reading the promise
   * off the link payload would tell this respondent their answers cannot be traced to
   * them, on a survey that traces them.
   */
  it('makes the anonymity promise from the survey, never from the link rule', async () => {
    serve({
      resolve: () =>
        new Response(JSON.stringify(link({ allowAnonymous: true })), { status: 200 }),
      respond: () =>
        new Response(JSON.stringify(respondView({ anonymous: false })), { status: 200 }),
    })
    renderPage()

    expect(await screen.findByText('Esta encuesta no es anónima')).toBeTruthy()
    expect(screen.queryByText('Esta encuesta es anónima')).toBeNull()
  })

  /**
   * One request, not one per language switch. The resolve is what increments
   * `survey_distributions.total_accesses`, and it is the only access figure an
   * administrator gets.
   *
   * The entry card is where this now bites hardest: it renders the survey's own title,
   * which has to come back translated, and the obvious way to get that is to put
   * `locale` on the effect that resolves the token. That is one word, it typechecks, and
   * it reports one respondent switching language as two visitors. The title comes from
   * the respond read instead, which is free.
   */
  it('resolves the token once even when the visitor switches language on the entry', async () => {
    serve({})
    renderPage()

    await screen.findByRole('button', { name: /Empezar/ })

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Cambiar Idioma' }),
      'en',
    )
    await screen.findByRole('combobox', { name: 'Switch Language' })

    const resolves = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/survey-links/'))
    expect(resolves).toHaveLength(1)
    // And with no `?lang=`: the localized title it returns is never rendered here.
    expect(String(resolves[0][0])).not.toContain('lang=')

    // The survey itself IS re-read, because its title and questions have to come back
    // in the language that was just chosen.
    expect(
      vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes('/respond')).length,
    ).toBeGreaterThan(1)
  })

  /**
   * The loss that shipped on `/survey-invitations/:token`, pinned on the sibling route
   * that would suffer it worse — this visitor may hold nothing but the link, with no
   * account and no saved draft to fall back on.
   *
   * Adding `locale` to either load's deps without the guard is a one-word edit that
   * typechecks, lints and passes every other test in this tree. The comment above those
   * deps was the only thing standing against it, and a comment is not a test.
   */
  it('keeps the answers already given when the visitor switches language mid-survey', async () => {
    serve({})
    renderPage()

    await begin()

    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    expect((screen.getByRole('radio', { name: 'Bien' }) as HTMLInputElement).checked).toBe(true)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cambiar Idioma' }), 'en')
    // The switch really landed: the shell's own control is renamed by it.
    await screen.findByRole('combobox', { name: 'Switch Language' })

    await waitFor(() =>
      expect((screen.getByRole('radio', { name: 'Bien' }) as HTMLInputElement).checked).toBe(true),
    )

    // And one visit is still one visit — the resolve is what increments total_accesses.
    const after = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/survey-links/'))
    expect(after).toHaveLength(1)
  })

  it('says one honest thing about a dead link, since the server says one thing', async () => {
    serve({ resolve: () => new Response(JSON.stringify({ message: 'nope' }), { status: 404 }) })
    renderPage()

    expect(await screen.findByText('Este enlace no abre ninguna encuesta')).toBeTruthy()
    // Never a claim the server refused to make. It answers the same 404 for unknown,
    // revoked and out-of-window precisely so a dead URL confirms nothing.
    expect(screen.queryByText(/anulada|caducado/)).toBeNull()
  })

  /**
   * Fail closed. A token that did not resolve has earned this client nothing to render,
   * and the fixture would happily have served a survey's name to anybody who asked.
   */
  it('puts none of the survey on screen when the link is dead', async () => {
    serve({ resolve: () => new Response(JSON.stringify({ message: 'nope' }), { status: 404 }) })
    renderPage()

    await screen.findByText('Este enlace no abre ninguna encuesta')
    expect(screen.queryByText('Clima laboral 2026')).toBeNull()
    expect(screen.queryByText('Esta encuesta es anónima')).toBeNull()
    expect(screen.queryByText('Cierra')).toBeNull()
    expect(screen.queryByRole('button', { name: /Empezar/ })).toBeNull()
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
   * The state PublicRespondEntryStates draws last, and the one this route could not
   * reach before: a live share link to a survey that records who answers, opened by
   * somebody with no session. The respond endpoint refuses it, and the resolve has
   * already ruled out "the survey is closed", so the respondent can be told the one
   * thing they can act on.
   */
  it('asks a visitor with no session to sign in, when the survey records who answers', async () => {
    serve({
      respond: () =>
        new Response(JSON.stringify({ message: 'This survey is not currently available' }), {
          status: 401,
        }),
    })
    renderPage()

    expect(await screen.findByText('Esta encuesta registra quién responde')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toBeTruthy()
    // And nothing about the survey itself: the payload never arrived.
    expect(screen.queryByText('Clima laboral 2026')).toBeNull()
    expect(screen.queryByRole('button', { name: /Empezar/ })).toBeNull()
  })

  /**
   * A survey that closed between the resolve and the respond read is closed, not
   * broken. Reporting it as a dead link sends the respondent hunting for a new one.
   */
  it('reports a survey that stopped accepting answers as closed', async () => {
    serve({
      respond: () =>
        new Response(
          JSON.stringify({ message: 'This survey is not currently accepting responses' }),
          { status: 400 },
        ),
    })
    renderPage()

    expect(await screen.findByText('Esta encuesta está cerrada')).toBeTruthy()
    expect(screen.queryByText('Este enlace no abre ninguna encuesta')).toBeNull()
  })

  /**
   * Somebody who already answered is not offered "Empezar". The form would tell them
   * one screen later; the page they land on should be the page they needed.
   */
  it('tells a respondent who already answered, instead of offering to start', async () => {
    serve({
      respond: () =>
        new Response(
          JSON.stringify(
            respondView({
              inProgress: {
                responseId: 'r1',
                sessionId: 's1',
                isComplete: true,
                language: 'es',
                startTime: '2026-09-02T00:00:00Z',
                completionTime: '2026-09-02T00:10:00Z',
                answers: [],
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    expect(await screen.findByText('Ya respondió esta encuesta')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Empezar/ })).toBeNull()
    // A confirmation waits its turn; it does not interrupt.
    expect(screen.getByRole('status')).toBeTruthy()
  })

  /**
   * The share link and the anonymous respond route are one surface. A third respond
   * implementation would be a third place for the anonymity promise to be forgotten.
   */
  it('hands over to the existing respond form rather than a third one', async () => {
    serve({})
    renderPage()

    await begin()

    expect(await screen.findByText('Esta encuesta es anónima')).toBeTruthy()
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
