import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import SurveyInvitationPage from './SurveyInvitationPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { SurveyRespondView } from '../api/surveyResponses'
import type { SurveyInvitationTokenDetail } from '../api/surveyLinks'

const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_TOKEN = 'fixture-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

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
function serve(
  options: {
    resolve?: () => Response
    steps?: () => Response
    submission?: Partial<typeof SUBMISSION>
  } = {},
): void {
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
      return Promise.resolve(
        new Response(JSON.stringify({ ...SUBMISSION, ...options.submission }), { status: 201 }),
      )
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
   * The one surface on this route a non-employee touches, and the one control on it that
   * can destroy their work: `RespondShell` renders `LanguageSwitcher` in its header, so
   * the switcher is on screen with a half-answered form under it.
   *
   * This page resolved the invitation on every `locale` change so the landing card's
   * title would come back translated. Doing that while the respondent was answering
   * replaced the `answering` state with `loading`, which unmounts `SurveyRespondForm` --
   * and a remounted form starts with an empty `answers` map. The respondent was returned
   * to the landing card with every answer gone and nothing said about it.
   *
   * `SurveyRespondForm` handles its own language switch correctly (it re-reads the
   * question text and guards re-hydration behind a ref), so the loss was entirely this
   * page tearing the form down around it.
   */
  it('keeps the answers already given when the respondent switches language mid-survey', async () => {
    serve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    expect((screen.getByRole('radio', { name: 'Bien' }) as HTMLInputElement).checked).toBe(true)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cambiar Idioma' }), 'en')

    // The switch really landed: the shell's own control is renamed by it.
    await screen.findByRole('combobox', { name: 'Switch Language' })

    // Still answering, and still holding the answer.
    await waitFor(() =>
      expect((screen.getByRole('radio', { name: 'Bien' }) as HTMLInputElement).checked).toBe(true),
    )
    expect(screen.queryByRole('button', { name: 'Start the survey' })).toBeNull()
    expect(screen.queryByText('Your invitation')).toBeNull()
  })

  /**
   * `started` is recorded once, when the respondent presses the button. A page that
   * re-resolved on a language switch posted `opened` again, and one that returned the
   * respondent to the card let them press "start" a second time. The server would ignore
   * both -- but a client that has to be saved by the server's idempotency is a client
   * that is getting the ladder wrong.
   */
  it('does not re-post a rung of the ladder because the language changed', async () => {
    serve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))
    await waitFor(() => expect(steps()).toEqual(['opened', 'started']))

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cambiar Idioma' }), 'en')
    await screen.findByRole('combobox', { name: 'Switch Language' })

    expect(steps()).toEqual(['opened', 'started'])
  })

  /**
   * `alreadySubmitted` means the server matched an existing complete response for this
   * session and wrote nothing just now. Firing `completed` here would report a rung that
   * whichever visit did write the response already reported, and would make
   * `onSubmitted` mean "the form was submitted" rather than "a response was accepted".
   * The exclusion is one `if` in `SurveyRespondForm`; this is the test that notices when
   * it goes.
   */
  it('does not re-report completed when the server matched an existing response', async () => {
    serve({ submission: { alreadySubmitted: true } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    // The submission landed -- the confirmation says so -- and the ladder did not move.
    expect(await screen.findByText('Ya respondió esta encuesta')).toBeTruthy()
    expect(steps()).toEqual(['opened', 'started'])
  })

  /**
   * The guard that keeps the form mounted is keyed on the token, not a bare "has begun"
   * flag, and this is the case that tells those two apart: a second invitation is a
   * second survey, and a boolean would leave it showing the first one's questions
   * forever. Reached in-app rather than by a fresh page load, which is the only way the
   * component instance survives to be confused.
   */
  it('resolves a different invitation even after the first one was begun', async () => {
    serve()
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/survey-invitations/${TOKEN}`]}>
          <Link to={`/survey-invitations/${OTHER_TOKEN}`}>Otra invitación</Link>
          <Routes>
            <Route path="/survey-invitations/:token" element={<SurveyInvitationPage />} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Comenzar la encuesta' }))
    await screen.findByRole('radio', { name: 'Bien' })

    await userEvent.click(screen.getByRole('link', { name: 'Otra invitación' }))

    // Its own landing card, not the previous invitation's half-answered form.
    expect(await screen.findByRole('button', { name: 'Comenzar la encuesta' })).toBeTruthy()
  })

  /**
   * The return leg, which the case above never reaches. `begunToken` is compared to the
   * CURRENT token, so coming back to an invitation that was begun earlier makes the
   * effect early-return on state that by then belongs to a different invitation --
   * invitation B's card rendered at invitation A's URL, with A's ladder advancing. That
   * is worse than the loss the guard prevents: the respondent answers the wrong survey
   * under somebody else's invitation.
   *
   * The detour must NOT begin the second invitation. Beginning it would move the ref to
   * B and the guard would let A resolve on the way back, which is why A -> B -> A is the
   * only ordering that shows the bug.
   */
  it('resolves the first invitation again after a detour through a second one', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/survey-invitations/') && init?.method === 'POST') {
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      if (url.includes(OTHER_TOKEN)) {
        return Promise.resolve(
          new Response(
            JSON.stringify(invitation({ surveyId: 'survey-bbb', surveyTitle: 'Encuesta B' })),
            { status: 200 },
          ),
        )
      }
      if (url.includes(TOKEN)) {
        return Promise.resolve(
          new Response(
            JSON.stringify(invitation({ surveyId: 'survey-aaa', surveyTitle: 'Encuesta A' })),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(respondView()), { status: 200 }))
    })

    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/survey-invitations/${TOKEN}`]}>
          <Link to={`/survey-invitations/${TOKEN}`}>Volver a la primera</Link>
          <Link to={`/survey-invitations/${OTHER_TOKEN}`}>Otra invitación</Link>
          <Routes>
            <Route path="/survey-invitations/:token" element={<SurveyInvitationPage />} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )

    await screen.findByRole('heading', { name: 'Encuesta A' })
    await userEvent.click(screen.getByRole('button', { name: 'Comenzar la encuesta' }))
    await screen.findByRole('radio', { name: 'Bien' })

    await userEvent.click(screen.getByRole('link', { name: 'Otra invitación' }))
    await screen.findByRole('heading', { name: 'Encuesta B' })

    // The invitation named in the URL is the one that must be on screen.
    await userEvent.click(screen.getByRole('link', { name: 'Volver a la primera' }))
    expect(await screen.findByRole('heading', { name: 'Encuesta A' })).toBeTruthy()
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
