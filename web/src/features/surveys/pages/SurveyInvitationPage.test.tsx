import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyInvitationPage from './SurveyInvitationPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { SurveyRespondView } from '../api/surveyResponses'
import type { SurveyInvitationTokenDetail } from '../api/surveyLinks'

const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function invitation(
  overrides: Partial<SurveyInvitationTokenDetail> = {},
): SurveyInvitationTokenDetail {
  return {
    invitationId: 'inv-1',
    surveyId: 'survey-77',
    surveyTitle: 'Clima laboral 2026',
    surveyDescription: 'Tu opinión es confidencial',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    status: 'sent',
    surveyStartDate: '2026-01-01T00:00:00Z',
    surveyEndDate: '2026-12-31T00:00:00Z',
    expiresAt: '2026-11-30T00:00:00Z',
    anonymity: {
      anonymous: true,
      highestRecordableState: 'opened',
      suppressedStates: ['started', 'completed'],
      guarantee: 'Tracking stops at opened.',
    },
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
    allowPartialResponses: true,
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

const SUBMISSION = {
  responseId: 'r1',
  sessionId: 'session-1',
  isComplete: true,
  isAnonymous: true,
  alreadySubmitted: false,
  language: 'es',
  answeredQuestionCount: 1,
  questionCount: 1,
  suppressedDemographics: [],
}

/**
 * One handler for the four endpoints this page touches, so the tests below can fail one
 * of them without the rest.
 */
function serve(options: { resolve?: () => Response; steps?: () => Response } = {}): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/survey-invitations/') && init?.method === 'POST') {
      return Promise.resolve(options.steps?.() ?? new Response('{}', { status: 200 }))
    }
    if (url.includes('/survey-invitations/')) {
      return Promise.resolve(
        options.resolve?.() ?? new Response(JSON.stringify(invitation()), { status: 200 }),
      )
    }
    if (url.includes('/responses')) {
      return Promise.resolve(new Response(JSON.stringify(SUBMISSION), { status: 201 }))
    }
    return Promise.resolve(new Response(JSON.stringify(respondView()), { status: 200 }))
  })
}

/**
 * The invitation state routes that were posted, in order: `['opened']`,
 * `['opened','started']`…
 *
 * Filtered on the *path*, not on the method: `POST /surveys/{id}/responses` is a POST
 * too, and a filter that only checked the verb reported submitting the survey as a
 * fourth rung on the ladder.
 */
function steps(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => /\/survey-invitations\/[^/?]+\/(\w+)/.exec(String(call[0]))?.[1])
    .filter((step): step is string => step !== undefined)
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/survey-invitations/${TOKEN}`]}>
        <Routes>
          <Route path="/survey-invitations/:token" element={<SurveyInvitationPage />} />
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

describe('SurveyInvitationPage', () => {
  it('names the survey the invitee was sent, and when their link stops working', async () => {
    serve()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Clima laboral 2026' })).toBeTruthy()
    expect(screen.getByText('Su invitación')).toBeTruthy()
    expect(screen.getByText('Su enlace funciona hasta')).toBeTruthy()
    expect(screen.getByText('Cierra')).toBeTruthy()
  })

  /**
   * The whole value of the ladder to an administrator is telling "they saw it" apart
   * from "they began". Recording both on page load would make the funnel a straight line
   * by construction — and it is the easiest possible thing to do by accident.
   */
  it('records opened on arrival and started only when the respondent begins', async () => {
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    await waitFor(() => expect(steps()).toEqual(['opened']))

    await userEvent.click(screen.getByRole('button', { name: 'Comenzar la encuesta' }))

    await waitFor(() => expect(steps()).toEqual(['opened', 'started']))
  })

  it('closes the ladder by recording completed when the answers are accepted', async () => {
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))

    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() => expect(steps()).toEqual(['opened', 'started', 'completed']))
  })

  /**
   * A partial save is not a completion. Firing `completed` here would make the
   * distribution screen report people as finished who pressed "save and finish later".
   */
  it('does not report completed when the respondent only saves their progress', async () => {
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar y terminar después' }))

    await waitFor(() => expect(steps()).toEqual(['opened', 'started']))
  })

  /**
   * Tracking is telemetry about a link, not a precondition for answering. A respondent
   * kept out of a survey because a counter would not increment is a product that has
   * confused whose page this is.
   */
  it('lets the respondent answer even when every tracking call fails', async () => {
    serve({ steps: () => new Response(JSON.stringify({ message: 'no' }), { status: 500 }) })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))

    expect(await screen.findByRole('radio', { name: 'Bien' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('records nothing at all for a token the server refused', async () => {
    serve({
      resolve: () =>
        new Response(JSON.stringify({ message: 'gone', reason: 'revoked' }), { status: 410 }),
    })
    renderPage()

    await screen.findByText('Esta invitación fue anulada')
    // An invitation the server has just refused has not been opened by anybody.
    expect(steps()).toEqual([])
  })

  /**
   * The four outcomes the API keeps apart, kept apart on screen. Revoked and expired are
   * both 410 and differ only by `reason`.
   */
  it.each([
    [410, 'revoked', 'Esta invitación fue anulada'],
    [410, 'expired', 'Esta invitación ha caducado'],
    [404, 'not_found', 'No se encontró esta invitación'],
    [409, 'already_completed', 'Ya respondió esta encuesta'],
  ])('reports %i/%s distinctly', async (status, reason, expected) => {
    serve({ resolve: () => new Response(JSON.stringify({ message: 'x', reason }), { status }) })
    renderPage()

    expect(await screen.findByText(expected)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Comenzar la encuesta' })).toBeNull()
  })

  /**
   * An already-answered invitation is not a failure and must not read as one — the
   * respondent's answers are in, and an amber warning would send them looking for
   * somebody to ask.
   */
  it('confirms rather than warns when the invitation was already used', async () => {
    serve({
      resolve: () =>
        new Response(JSON.stringify({ message: 'x', reason: 'already_completed' }), {
          status: 409,
        }),
    })
    renderPage()

    await screen.findByText('Ya respondió esta encuesta')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('shows the anonymity promise before the respondent decides to start', async () => {
    serve()
    renderPage()

    expect(await screen.findByText('Esta encuesta es anónima')).toBeTruthy()
  })

  /**
   * Checked against `ResolveRespondentAsync`, not guessed: an unauthenticated caller is
   * served only when the survey is anonymous AND open. An invitee to a named survey with
   * no session is about to meet a 401 they would read as the link being broken.
   */
  it('warns an invitee to a named survey that they will have to sign in', async () => {
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: {
                anonymous: false,
                highestRecordableState: 'completed',
                suppressedStates: [],
                guarantee: 'Everything is recorded.',
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    expect(await screen.findByText(/tendrá que|se le pedirá iniciar sesión/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe('/login')
  })

  it('says nothing about signing in when the visitor already holds a session', async () => {
    setToken('a-real-jwt')
    serve({
      resolve: () =>
        new Response(
          JSON.stringify(
            invitation({
              anonymity: {
                anonymous: false,
                highestRecordableState: 'completed',
                suppressedStates: [],
                guarantee: 'Everything is recorded.',
              },
            }),
          ),
          { status: 200 },
        ),
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).toBeNull()
  })

  it('renders none of the authenticated shell', async () => {
    setToken('an-admin-jwt')
    serve()
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: /sign out|cerrar sesión/i })).toBeNull()
  })

  /**
   * `authFetch` would have cleared storage and navigated away. Nothing on this route may
   * reach for it: the token in the path is the credential and the visitor has no session
   * to lose.
   */
  it('does not clear a session or navigate away when the token is refused', async () => {
    setToken('stale')
    serve({ resolve: () => new Response(JSON.stringify({ message: 'x' }), { status: 401 }) })
    renderPage()

    await screen.findByText('No se pudo cargar esta encuesta')
    expect(window.localStorage.getItem('climate_platform_token')).toBe('stale')
  })
})
