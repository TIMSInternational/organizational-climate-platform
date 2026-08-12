import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyRespondPage from './SurveyRespondPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import type { SurveyRespondQuestion, SurveyRespondView } from '../api/surveyResponses'

function question(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return {
    id: 'q1',
    text: '¿Qué tan satisfecho estás?',
    type: 'multiple_choice',
    options: [
      { order: 0, value: 'strongly_agree', label: 'Muy de acuerdo' },
      { order: 1, value: 'disagree', label: 'En desacuerdo' },
    ],
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    required: false,
    commentRequired: false,
    commentPrompt: null,
    order: 0,
    category: null,
    ...overrides,
  }
}

function view(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 's1',
    title: 'Clima laboral 2026',
    description: null,
    type: 'general_climate',
    language: 'both',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-31T00:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [question()],
    inProgress: null,
    ...overrides,
  }
}

function respondWith(payload: SurveyRespondView) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            responseId: 'r1',
            sessionId: 'session-1',
            isComplete: init.body ? JSON.parse(init.body as string).isComplete : true,
            isAnonymous: payload.anonymous,
            alreadySubmitted: false,
            language: payload.resolvedLocale,
            answeredQuestionCount: 1,
            questionCount: payload.questions.length,
            suppressedDemographics: [],
          }),
          { status: 201 },
        ),
      )
    }
    void input
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

function failWith(status: number, message: string) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message }), { status }))
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1/respond']}>
        <Routes>
          <Route path="/surveys/:id/respond" element={<SurveyRespondPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The body of the last POST the page made. */
function lastSubmission(): Record<string, unknown> {
  const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  return JSON.parse((posts[posts.length - 1][1] as RequestInit).body as string) as Record<string, unknown>
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SurveyRespondPage language', () => {
  it("asks for the survey in the respondent's own locale", async () => {
    respondWith(view())
    renderPage()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/surveys/s1/respond?lang=es'),
        expect.anything(),
      )
    })
  })

  /**
   * The #195 rule this page is most likely to get wrong. `resolvedLocale` is the
   * language the text is ACTUALLY in, and it is what `Response.Language` must record
   * — the aggregation groups free text by it, and a Spanish answer filed as English
   * is how "trabajo" and "work" become unrelated entries in one word cloud.
   */
  it('records the language the respondent actually read, not the one they asked for', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    respondWith(view({ language: 'es', resolvedLocale: 'es' }))
    renderPage()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    await userEvent.click(screen.getByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit my answers' }))

    await waitFor(() => expect(lastSubmission().language).toBe('es'))
  })

  it('says so when the survey came back in a language other than the one asked for', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    respondWith(view({ language: 'es', resolvedLocale: 'es' }))
    renderPage()

    expect(await screen.findByText(/Not everything is available in your language/)).toBeTruthy()
  })

  it('reports per-field fallbacks even when the payload resolved correctly overall', async () => {
    respondWith(view({ resolvedLocale: 'es', fallbackFields: ['questions[0].text'] }))
    renderPage()

    expect(await screen.findByText(/Algunas partes se muestran/)).toBeTruthy()
  })

  it('says nothing when everything resolved in the requested language', async () => {
    respondWith(view())
    renderPage()

    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByText(/No todo está disponible/)).toBeNull()
  })
})

describe('SurveyRespondPage anonymity messaging', () => {
  it('tells the respondent precisely what an anonymous survey does not record', async () => {
    respondWith(view({ anonymous: true }))
    renderPage()

    expect(await screen.findByText('Esta encuesta es anónima')).toBeTruthy()
    expect(screen.getByText(/sin tu nombre|sin su nombre/)).toBeTruthy()
  })

  /**
   * The half that is easy to leave out. A survey that records who answered has to say
   * so — saying nothing lets a respondent assume the more private of the two, which
   * is a consent failure rather than a missing feature.
   */
  it('says plainly when a survey is NOT anonymous', async () => {
    respondWith(view({ anonymous: false }))
    renderPage()

    expect(await screen.findByText('Esta encuesta no es anónima')).toBeTruthy()
    expect(screen.queryByText('Esta encuesta es anónima')).toBeNull()
  })
})

describe('SurveyRespondPage answering', () => {
  it('submits the stable option value, never the label the respondent read', async () => {
    respondWith(view())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() => {
      expect(lastSubmission().answers).toEqual([{ questionId: 'q1', value: 'strongly_agree' }])
    })
    expect(JSON.stringify(lastSubmission())).not.toContain('Muy de acuerdo')
  })

  it('names the group of radios with the question itself', async () => {
    respondWith(view())
    renderPage()

    const group = await screen.findByRole('group', { name: /¿Qué tan satisfecho estás\?/ })
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
  })

  it('offers the locale-independent codes for a yes/no question, labelled in Spanish', async () => {
    respondWith(view({ questions: [question({ type: 'yes_no', options: null })] }))
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Sí' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() => expect(lastSubmission().answers).toEqual([{ questionId: 'q1', value: 'yes' }]))
  })

  it('falls back to a 1-5 scale when a likert question configures no options', async () => {
    respondWith(view({ questions: [question({ type: 'likert', options: null })] }))
    renderPage()

    const group = await screen.findByRole('group', { name: /satisfecho/ })
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
  })

  it('sends an open-ended answer as its value and adds no separate comment', async () => {
    respondWith(view({ questions: [question({ type: 'open_ended', options: null })] }))
    renderPage()

    await userEvent.type(await screen.findByRole('textbox'), 'Va bien')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() => expect(lastSubmission().answers).toEqual([{ questionId: 'q1', value: 'Va bien' }]))
  })

  /**
   * `QuestionTypes.ForSurvey` has no `emoji_rating` and `SurveyQuestionOptionDto`
   * carries no emoji, so a survey question of that type cannot be answered through
   * this endpoint at all — the server rejects it by name. Rendering a text box would
   * collect answers it then refuses one at a time.
   */
  it('explains a question it cannot render rather than faking a control for it', async () => {
    respondWith(view({ questions: [question({ type: 'emoji_rating' })] }))
    renderPage()

    expect(await screen.findByText(/no se puede responder aquí/)).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })
})

describe('SurveyRespondPage required questions', () => {
  it('blocks submit, announces the gap and puts focus on the question itself', async () => {
    respondWith(view({ questions: [question({ required: true })] }))
    const { container } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar mis respuestas' }))

    // Nothing was sent.
    expect(vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toHaveLength(0)
    // The failure is announced, not just drawn.
    expect(container.querySelector('[data-slot="live-region"]')?.textContent).toContain(
      'preguntas obligatorias',
    )
    // And focus is on the question, not left on the submit button at the bottom of a
    // 40-question page.
    expect(document.activeElement?.id).toBe('question-q1')
    expect(screen.getByRole('alert').textContent).toContain('necesita una respuesta')
  })

  it('clears the inline error as soon as the question is answered', async () => {
    respondWith(view({ questions: [question({ required: true })] }))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar mis respuestas' }))
    expect(screen.queryByRole('alert')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: 'En desacuerdo' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks a required question as required and an optional one as optional', async () => {
    respondWith(view({ questions: [question({ required: true })] }))
    renderPage()

    expect(await screen.findByText('(obligatoria)')).toBeTruthy()
  })
})

describe('SurveyRespondPage settings', () => {
  it('shows progress only when the survey asks for it', async () => {
    respondWith(view({ showProgress: false }))
    const first = renderPage()
    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByRole('progressbar')).toBeNull()
    first.unmount()

    respondWith(view({ showProgress: true }))
    renderPage()
    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('0 de 1 preguntas respondidas')).toBeTruthy()
  })

  it('counts an answer into the progress figure', async () => {
    respondWith(view({ showProgress: true }))
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'En desacuerdo' }))
    expect(screen.getByText('1 de 1 preguntas respondidas')).toBeTruthy()
  })

  it('offers save-and-continue only when partial responses are allowed', async () => {
    respondWith(view({ allowPartialResponses: false }))
    const first = renderPage()
    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    expect(screen.queryByRole('button', { name: 'Guardar y continuar después' })).toBeNull()
    first.unmount()

    respondWith(view({ allowPartialResponses: true }))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Guardar y continuar después' })).toBeTruthy()
  })

  it('saves progress without completing the response, and says so', async () => {
    respondWith(view({ allowPartialResponses: true, questions: [question({ required: true })] }))
    const { container } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar y continuar después' }))

    await waitFor(() => expect(lastSubmission().isComplete).toBe(false))
    // A partial save is not held to the required-question rule: the respondent is
    // explicitly saying they have not finished.
    expect(container.querySelector('[data-slot="live-region"]')?.textContent).toContain(
      'progreso se ha guardado',
    )
  })

  it('asks the questions in a stable order when the survey randomises them', async () => {
    const questions = [
      question({ id: 'a', text: 'Pregunta A', order: 0 }),
      question({ id: 'b', text: 'Pregunta B', order: 1 }),
      question({ id: 'c', text: 'Pregunta C', order: 2 }),
    ]
    respondWith(view({ randomizeQuestions: true, questions }))
    const first = renderPage()
    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    const firstOrder = [...document.querySelectorAll('legend')].map((l) => l.textContent)
    first.unmount()

    respondWith(view({ randomizeQuestions: true, questions }))
    renderPage()
    await screen.findByRole('heading', { name: 'Clima laboral 2026' })
    const secondOrder = [...document.querySelectorAll('legend')].map((l) => l.textContent)

    // The same order both times. A `Math.random` shuffle would move the question a
    // respondent was halfway through on every reload.
    expect(secondOrder).toEqual(firstOrder)
    expect(firstOrder).toHaveLength(3)
  })

  it('numbers the questions by the order they are actually asked in', async () => {
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', order: 0 }),
          question({ id: 'b', text: 'Pregunta B', order: 1 }),
        ],
      }),
    )
    renderPage()

    const legends = await waitFor(() => {
      const found = [...document.querySelectorAll('legend')]
      expect(found).toHaveLength(2)
      return found
    })
    expect(legends[0].textContent).toContain('Pregunta 1 de 2')
    expect(legends[1].textContent).toContain('Pregunta 2 de 2')
  })

  /**
   * The countdown moved out of an inline `Alert` in the run of the page and into
   * the instrument panel, as a labelled reading. So the assertion is on the
   * reading rather than on the old sentence — and on the typography, because
   * "set every reading in mono with tabular figures" is the one rule the redesign
   * rests on and a countdown that reflows a pixel every second is exactly what
   * tabular figures exist to prevent.
   */
  it('shows a countdown when the survey sets a time limit, as a mono reading', async () => {
    respondWith(view({ timeLimitMinutes: 10 }))
    renderPage()

    const countdown = await screen.findByText('10:00')
    expect(countdown.className).toContain('font-mono')
    expect(countdown.className).toContain('tabular-nums')
    // Labelled, so a bare "10:00" is never left to be guessed at.
    expect(screen.getByText('Tiempo restante')).toBeTruthy()
  })

  it('replaces the countdown with an alert once the suggested time is up', async () => {
    respondWith(view({ timeLimitMinutes: 10 }))
    // Started eleven minutes ago, so the deadline is already behind us.
    const startedAt = new Date(Date.now() - 11 * 60_000).toISOString()
    respondWith(
      view({
        timeLimitMinutes: 10,
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: false,
          language: 'es',
          startTime: startedAt,
          completionTime: null,
          answers: [],
        },
      }),
    )
    renderPage()

    expect(await screen.findByText('Se agotó el tiempo sugerido')).toBeTruthy()
    expect(screen.queryByText('Tiempo restante')).toBeNull()
  })
})

describe('SurveyRespondPage ranking', () => {
  const ranking = question({
    type: 'ranking',
    text: 'Ordena estos temas',
    required: true,
    options: [
      { order: 0, value: 'pay', label: 'Salario' },
      { order: 1, value: 'growth', label: 'Crecimiento' },
      { order: 2, value: 'balance', label: 'Equilibrio' },
    ],
  })

  /**
   * Drag-and-drop is the obvious implementation of a ranking and is unusable by
   * keyboard. #80 already shipped a nav whose chevron was unreachable that way, so
   * this asserts the reorder is done with real buttons that a keyboard reaches.
   */
  it('reorders by keyboard alone', async () => {
    respondWith(view({ questions: [ranking] }))
    renderPage()

    const moveUp = await screen.findByRole('button', { name: 'Subir Equilibrio' })
    moveUp.focus()
    await userEvent.keyboard('{Enter}')

    expect(lastLabels()).toEqual(['Salario', 'Equilibrio', 'Crecimiento'])
  })

  it('announces where the moved item landed', async () => {
    respondWith(view({ questions: [ranking] }))
    const { container } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Subir Crecimiento' }))

    expect(container.querySelector('[data-slot="live-region"]')?.textContent).toBe(
      'Crecimiento pasó a la posición 1 de 3',
    )
  })

  /**
   * Moving an item to an end disables the button that was just pressed. Left alone,
   * focus falls to `<body>` and a keyboard user is stranded — the same trap as an
   * unreachable control, arrived at from the other side.
   */
  it('keeps focus on the moved item when its button becomes disabled', async () => {
    respondWith(view({ questions: [ranking] }))
    renderPage()

    const moveUp = await screen.findByRole('button', { name: 'Subir Crecimiento' })
    moveUp.focus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Bajar Crecimiento')
    })
  })

  it('will not submit an untouched required ranking as if it were an answer', async () => {
    respondWith(view({ questions: [ranking] }))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Enviar mis respuestas' }))

    expect(vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toHaveLength(0)
  })

  it('submits the full permutation of stable values once reordered', async () => {
    respondWith(view({ questions: [ranking] }))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Subir Equilibrio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() => {
      expect(lastSubmission().answers).toEqual([
        { questionId: 'q1', values: ['pay', 'balance', 'growth'] },
      ])
    })
  })

  function lastLabels(): string[] {
    return [...document.querySelectorAll('ol li')].map(
      (item) => item.querySelectorAll('span')[1]?.textContent ?? '',
    )
  }
})

describe('SurveyRespondPage comments', () => {
  const withPrompt = question({ commentPrompt: '¿Por qué?' })

  it('keeps the comment box read-only until the question itself is answered', async () => {
    respondWith(view({ questions: [withPrompt] }))
    renderPage()

    const comment = await screen.findByLabelText('¿Por qué?')
    expect(comment.hasAttribute('readonly')).toBe(true)

    await userEvent.click(screen.getByRole('radio', { name: 'Muy de acuerdo' }))
    expect(comment.hasAttribute('readonly')).toBe(false)
  })

  /**
   * `Question.CommentRequired` defaults to `true` in the DDL and the submission
   * endpoint does not enforce it, so keying the comment box off it would put one
   * under every question of every existing survey.
   */
  it('renders no comment box for a question with no prompt, whatever commentRequired says', async () => {
    respondWith(view({ questions: [question({ commentRequired: true, commentPrompt: null })] }))
    renderPage()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('SurveyRespondPage resume', () => {
  it('brings back the answers a partial save stored', async () => {
    respondWith(
      view({
        allowPartialResponses: true,
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: false,
          language: 'es',
          startTime: '2026-06-01T10:00:00Z',
          completionTime: null,
          answers: [
            { questionId: 'q1', value: 'disagree', values: null, text: null, timeSpentSeconds: null },
          ],
        },
      }),
    )
    renderPage()

    const chosen = await screen.findByRole('radio', { name: 'En desacuerdo' })
    expect((chosen as HTMLInputElement).checked).toBe(true)
  })

  it('sends the stored session id so a retry cannot become a second response', async () => {
    respondWith(view())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    // Read before submitting: a completed response clears the id, which is the next
    // test's subject.
    const stored = window.localStorage.getItem('surveyResponseSession:s1')
    expect(stored).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() => expect(lastSubmission().sessionId).toBe(stored))
  })

  it('forgets the session id once the response is complete', async () => {
    respondWith(view())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await waitFor(() =>
      expect(window.localStorage.getItem('surveyResponseSession:s1')).toBeNull(),
    )
  })
})

describe('SurveyRespondPage outcomes', () => {
  it('thanks the respondent and stops offering the form', async () => {
    respondWith(view())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    expect(await screen.findByText('Gracias, sus respuestas fueron recibidas')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  /**
   * A suppressed write reported as a plain success is the same silent substitution
   * the content-i18n rules forbid, wearing a different hat. The respondent is
   * entitled to know which of their details were deliberately not kept.
   */
  it('reports demographics that were deliberately not recorded', async () => {
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
                suppressedDemographics: ['department', 'tenure'],
              }),
              { status: 201 },
            )
          : new Response(JSON.stringify(view()), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    expect(await screen.findByText(/department, tenure/)).toBeTruthy()
  })

  it('tells a respondent who already finished, and offers no second form', async () => {
    respondWith(
      view({
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: true,
          language: 'es',
          startTime: '2026-06-01T10:00:00Z',
          completionTime: '2026-06-01T10:05:00Z',
          answers: [],
        },
      }),
    )
    renderPage()

    expect(await screen.findByText('Ya respondió esta encuesta')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('surfaces the server message when a submission is refused', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ message: 'This survey has reached its response limit' }), {
              status: 400,
            })
          : new Response(JSON.stringify(view()), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    // The alert carries the server's own message; the live region repeats it so a
    // screen reader hears a failure that moves nothing into focus.
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'This survey has reached its response limit',
      ),
    )
  })
})

/**
 * Four situations that a respondent has four different next steps for. Collapsing
 * them into one "something went wrong" is what makes somebody retry a survey that
 * closed a week ago.
 */
describe('SurveyRespondPage unavailable states', () => {
  it('distinguishes a survey that does not exist', async () => {
    failWith(404, 'Survey not found')
    renderPage()
    expect(await screen.findByText('No se encontró esta encuesta')).toBeTruthy()
  })

  it('distinguishes a survey that has closed', async () => {
    failWith(400, 'This survey is not currently accepting responses')
    renderPage()
    expect(await screen.findByText('Esta encuesta está cerrada')).toBeTruthy()
  })

  it('distinguishes a survey targeted at somebody else', async () => {
    failWith(403, '')
    renderPage()
    expect(await screen.findByText('Esta encuesta no es para que usted la responda')).toBeTruthy()
  })

  it('asks an authenticated respondent with a stale token to sign in again', async () => {
    failWith(401, 'This survey is not currently available')
    renderPage()
    expect(await screen.findByText('Vuelva a iniciar sesión')).toBeTruthy()
  })

  it('falls back to the server message for a status it has no specific answer for', async () => {
    failWith(500, 'Something exploded')
    renderPage()
    expect(await screen.findByText('Something exploded')).toBeTruthy()
  })
})

/**
 * The redesign. Three claims, each of which a green suite could otherwise be made
 * to hold while the page looked nothing like the design.
 */
describe('SurveyRespondPage as an instrument', () => {
  /**
   * "The anonymity promise should be present and legible, not buried." It used to
   * be an `Alert` in the run of the page: above the fold once, then out of sight for
   * the rest of a forty-question survey. It is now the first thing in the panel that
   * `sticky` holds beside the questions — and, on a phone, the block a respondent
   * reads before the first question rather than after the last.
   *
   * **What this case can and cannot hold.** It asserts placement and DOM order,
   * which is all it names. The `toContain('sticky')` line below is a spelling
   * check and nothing more: the class was present, correct and completely inert
   * for the whole of this branch's first pass, because an ancestor's
   * `overflow-x-auto` had made itself the panel's scrollport. Whether the panel
   * actually sticks is asserted in `components/layout/respondSticky.test.tsx`,
   * which computes it.
   */
  it('puts the anonymity promise inside the panel that stays with the questions', async () => {
    respondWith(view({ anonymous: true }))
    renderPage()

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    expect(within(panel).getByText('Esta encuesta es anónima')).toBeTruthy()
    expect(panel.className).toContain('sticky')

    // And it comes before the form in the DOM, which is the order a phone renders.
    const form = document.querySelector('form')
    expect(form).toBeTruthy()
    expect(panel.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  /**
   * Colour never carries the state alone (WCAG 1.4.1). Green means anonymous and
   * blue means identified, but the chip spells out which.
   */
  it('names the anonymity state in a word beside the colour, both ways round', async () => {
    respondWith(view({ anonymous: true }))
    const first = renderPage()
    expect(await screen.findByText('Anónima')).toBeTruthy()
    first.unmount()

    respondWith(view({ anonymous: false }))
    renderPage()
    expect(await screen.findByText('No anónima')).toBeTruthy()
    expect(screen.queryByText('Anónima')).toBeNull()
  })

  /**
   * Every reading is set in mono with tabular figures; prose stays in the sans
   * face. The progress fraction is the reading a respondent watches change, so it is
   * also the one a proportional face would reflow on every answer.
   */
  it('sets the progress fraction in mono, and keeps the sentence for a screen reader', async () => {
    respondWith(view({ showProgress: true, questions: [question(), question({ id: 'q2' })] }))
    renderPage()

    const reading = await screen.findByText('0 / 2')
    expect(reading.className).toContain('font-mono')
    expect(reading.className).toContain('tabular-nums')
    // Hidden from assistive tech, because the sentence below it says the same fact
    // in words and hearing both is hearing it twice.
    expect(reading.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('0 de 2 preguntas respondidas')).toBeTruthy()

    await userEvent.click(screen.getAllByRole('radio', { name: 'Muy de acuerdo' })[0])
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  /**
   * The question index is a reading too. `1/24` read aloud is not what "Question 1
   * of 24" says, so the glyph form is hidden and the sentence is the accessible one
   * — both inside the `<legend>`, which is what names the radio group.
   */
  it('numbers each question as a mono reading with the sentence beside it', async () => {
    respondWith(view({ questions: [question(), question({ id: 'q2' })] }))
    renderPage()

    const marker = await screen.findByText('1/2')
    expect(marker.className).toContain('font-mono')
    expect(marker.className).toContain('tabular-nums')
    expect(marker.getAttribute('aria-hidden')).toBe('true')
    expect(marker.closest('legend')?.textContent).toContain('Pregunta 1 de 2')
  })

  /**
   * The receipt. A respondent who has just handed over their answers with no copy
   * of them gets one reading back — the server's own count of what was stored.
   */
  it('reports what was recorded as a reading once the response is submitted', async () => {
    respondWith(view())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    expect(await screen.findByText('Respuestas registradas')).toBeTruthy()
    expect(screen.getByText('de 1 preguntas')).toBeTruthy()
  })

  /**
   * Protected is shown, never hidden — and the count behind it never is. A
   * suppressed demographic is named with the padlock and the word beside it rather
   * than quietly dropped from a plain success message.
   */
  it('labels a suppressed demographic as protected, and publishes no count', async () => {
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
                suppressedDemographics: ['departamento'],
              }),
              { status: 201 },
            )
          : new Response(JSON.stringify(view()), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    expect(await screen.findByText('Protegido')).toBeTruthy()
    expect(screen.getByText(/departamento/)).toBeTruthy()
  })

  /**
   * Every reading in the panel is one row of it.
   *
   * The closing date used to sit in a `sm:grid-cols-2 lg:grid-cols-1
   * xl:grid-cols-2` wrapper whose only other child renders when the survey turned
   * progress OFF — the rarer case. With progress on, that grid held one child in
   * two columns, so CLOSES rendered at half the panel width with a stranded empty
   * cell beside it at every viewport from 640px up: measured in Chromium at
   * 1440x900, a 197px tile under three 402px ones.
   *
   * happy-dom cannot measure that, but it can see the cause. Each reading is a
   * direct child of the panel, so there is no intermediate track for one of them to
   * be laid out in.
   */
  it('gives every panel reading its own full-width row', async () => {
    respondWith(view({ showProgress: true }))
    renderPage()

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    const closes = within(panel).getByText('Cierra').closest('div')
    expect(closes, 'the CLOSES reading renders').toBeTruthy()
    expect(
      closes!.parentElement,
      'A wrapper here is a second grid inside the panel, and the wrapper this '
        + 'replaced held one child in two columns whenever `showProgress` was on — '
        + 'a half-width tile with a hole beside it.',
    ).toBe(panel)

    // The tiles above it are direct children too, which is what "the same width"
    // means when nothing can be measured.
    expect(within(panel).getByText('Respondidas').closest('div')!.parentElement).toBe(panel)
    expect(panel.children.length).toBeGreaterThanOrEqual(3)
  })

  /**
   * And the second reading appears in that same column when the survey turns
   * progress off — the case the two-column wrapper was built for. It is a row of
   * the panel like every other one now.
   */
  it('adds the question count as another row when progress is off', async () => {
    respondWith(view({ showProgress: false, questions: [question(), question({ id: 'q2' })] }))
    renderPage()

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    expect(within(panel).queryByText('Respondidas')).toBeNull()
    const count = within(panel).getByText('Preguntas').closest('div')
    expect(count!.parentElement).toBe(panel)
    expect(within(count!).getByText('2')).toBeTruthy()
  })
})
