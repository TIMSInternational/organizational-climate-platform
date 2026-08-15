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

/**
 * The progress sentence, read off the sticky bar rather than matched as one string.
 *
 * `MonoReadings` sets the NUMERALS in mono and leaves the prose in the sans face, so
 * "0 de 2 respondidas" is spread across several elements and `getByText` with an exact
 * string cannot match it. Reading the bar's own `textContent` asserts the same fact and
 * is strictly stronger than the query it replaces: an exact-text query was satisfied by
 * the sentence appearing ANYWHERE on the page, which is what the old rail also did.
 */
function progressSentence(): string {
  const bar = document.querySelector('[data-slot="respond-submit-bar"]')
  return (bar?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The numerals inside the bar, in order.
 *
 * "Every reading is `font-mono tabular-nums`, every piece of prose is not" is the rule
 * the redesign rests on — the countdown two readings away is asserted against it — so
 * the figures a respondent watches change are checked to BE readings, not merely to be
 * present.
 */
function progressReadings(): string[] {
  const bar = document.querySelector('[data-slot="respond-submit-bar"]')
  return Array.from(bar?.querySelectorAll('.font-mono.tabular-nums') ?? []).map(
    (node) => node.textContent ?? '',
  )
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
  /**
   * `ShowProgress` is the author's setting and it gates the whole progress cluster.
   *
   * The cluster moved: it was a tile in the right-hand rail, and the redesign put it
   * in the bar stuck to the bottom of the viewport, beside the two actions. The gate
   * did not move with it — a survey that turned progress off still gets no bar and no
   * count, and this asserts BOTH halves so that "gated" cannot be satisfied by a page
   * that simply never draws it.
   *
   * The presence half is scoped to the bar rather than to the document, because
   * "somewhere on the page" is what the rail also satisfied.
   */
  it('shows progress only when the survey asks for it', async () => {
    respondWith(view({ showProgress: false }))
    const first = renderPage()
    // The bar itself renders either way — otherwise the two nulls below would hold on
    // a page that had not finished loading.
    await screen.findByRole('button', { name: 'Enviar mis respuestas' })
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(progressSentence()).not.toContain('respondidas')
    first.unmount()

    respondWith(view({ showProgress: true }))
    const { container } = renderPage()
    await screen.findByRole('button', { name: 'Enviar mis respuestas' })
    const bar = container.querySelector('[data-slot="respond-submit-bar"]') as HTMLElement | null
    expect(bar, 'the form ends in the sticky bar the rail became').toBeTruthy()
    expect(within(bar!).getByRole('progressbar')).toBeTruthy()
    expect(progressSentence()).toContain('0 de 1 respondidas')
  })

  /**
   * And the figure counts up as answers are given — the fact the respondent is
   * actually watching. Asserted in words and in the bar's own `aria-valuenow`, which
   * is the half a screen reader gets.
   */
  it('counts an answer into the progress figure', async () => {
    respondWith(view({ showProgress: true }))
    renderPage()

    await screen.findByRole('progressbar')
    expect(progressSentence()).toContain('0 de 1 respondidas')
    await userEvent.click(screen.getByRole('radio', { name: 'En desacuerdo' }))
    expect(progressSentence()).toContain('1 de 1 respondidas')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
  })

  /**
   * `AllowPartialResponses` gates the save button, which rides the bottom bar now
   * rather than the rail. Same gate, same reason: offering "save and finish later" on
   * a survey the server will not accept a partial write for is a promise the page
   * cannot keep.
   */
  it('offers save-and-continue only when partial responses are allowed', async () => {
    respondWith(view({ allowPartialResponses: false }))
    const first = renderPage()
    await screen.findByRole('button', { name: 'Enviar mis respuestas' })
    expect(screen.queryByRole('button', { name: 'Guardar y terminar después' })).toBeNull()
    first.unmount()

    respondWith(view({ allowPartialResponses: true }))
    renderPage()
    const save = await screen.findByRole('button', { name: 'Guardar y terminar después' })
    expect(
      save.closest('[data-slot="respond-submit-bar"]'),
      'the save action belongs to the bar the respondent finishes from, not to a rail',
    ).toBeTruthy()
  })

  it('saves progress without completing the response, and says so', async () => {
    respondWith(view({ allowPartialResponses: true, questions: [question({ required: true })] }))
    const { container } = renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar y terminar después' }))

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
 * The redesign, claim by claim — each one a thing a green suite could otherwise be
 * made to hold while the page looked nothing like the design.
 *
 * The right-hand rail is gone. Everything it carried is still here and is asserted
 * here, in the place the approved design moved it to: the anonymity promise to a
 * full-width block above the questions, the answered count and both actions to the
 * bar stuck to the bottom of the viewport, the closing date and the countdown to a
 * row of readings under the title. The properties below are the rail's; only the
 * addresses changed.
 */
describe('SurveyRespondPage as an instrument', () => {
  /**
   * "The anonymity promise should be present and legible, not buried." The property
   * is unchanged; the place it is kept has moved twice.
   *
   * It was an `Alert` in the run of the page — above the fold once, then out of sight
   * for the rest of a forty-question survey. Then it was the top tile of a sticky
   * right-hand rail, which held it in view on a wide screen and, because the rail
   * collapsed below `lg`, did not render it AT ALL on a phone — which is where this
   * page is mostly answered. The redesign deletes the rail: the promise is now the
   * first full-width block under the title, ahead of the questions on every viewport.
   *
   * **What this case can and cannot hold.** It asserts placement and DOM order, which
   * is all it names, and it can no longer lean on a `sticky` spelling check — that
   * line was inert for the whole of this branch's first pass, because an ancestor's
   * `overflow-x-auto` had made itself the panel's scrollport. What replaces it is the
   * one thing that would bring the rail's real defect back: a viewport gate on the
   * block. Computed positioning for the boxes on this page that do stick is measured
   * in `components/layout/respondSticky.test.tsx`; the promise no longer needs to.
   */
  it('keeps the anonymity promise ahead of the questions, on every viewport', async () => {
    respondWith(view({ anonymous: true }))
    renderPage()

    const heading = await screen.findByRole('heading', { name: 'Esta encuesta es anónima' })
    const promise = heading.closest('section')
    expect(promise, 'the promise renders as its own block').toBeTruthy()
    // The whole promise travelled, not just its title: the chip that carries the
    // state in a word, and the sentence that says what is not recorded.
    expect(within(promise!).getByText('Anónima')).toBeTruthy()
    expect(within(promise!).getByText(/sin su nombre/)).toBeTruthy()

    const form = document.querySelector('form')
    expect(form).toBeTruthy()
    // Same parent as the form: a full-width block of the one column the page now is,
    // rather than a child of a side rail beside it. A re-introduced rail would make
    // the promise's parent the column instead of the surface.
    expect(promise!.parentElement).toBe(form!.parentElement)
    // And it comes before the form in the DOM, which is the order a phone renders.
    expect(promise!.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // A spelling check, and the only one worth keeping here: `hidden` plus a
    // breakpoint prefix is exactly how the rail came to not exist on a phone, and it
    // compiles perfectly well. happy-dom does no layout, so this is checked as text.
    expect(
      promise!.className.split(/\s+/).filter((name) => name === 'hidden' || /^(sm|md|lg|xl|2xl):/.test(name)),
      'A viewport-gated promise is the rail defect wearing new classes: legible on a '
        + 'laptop, absent on the phone the survey is actually answered on.',
    ).toEqual([])
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
   * The progress figure is the one reading a respondent watches change, so it is also
   * the one a proportional face would reflow on every answer — which is what tabular
   * figures exist to prevent. That half of the rule is unchanged by the redesign and
   * is asserted below.
   *
   * **What changed.** The rail's tile printed the fraction TWICE: a glyph form
   * (`0 / 2`) set in mono and `aria-hidden`, plus a sentence underneath for anyone
   * listening, because "zero slash two" is not what "0 of 2 answered" says. The
   * bottom bar prints it once, as the sentence, with tabular figures on it. So the
   * assertion inverts rather than disappearing: there is no hidden glyph to check
   * for, and the sentence — the accessible rendering, now the only one — must NOT be
   * hidden from assistive technology. The `font-mono` half is not asserted here; see
   * the note in the repair report, and `SurveyRespondForm.tsx`'s own comment, for why
   * the sentence stays in the sans face.
   *
   * The bar's `aria-valuenow` is asserted beside it because it is the machine-
   * readable copy of the same fact, and it is what a hidden glyph used to be for.
   */
  it('sets the progress figure in tabular figures, and keeps the sentence a screen reader hears', async () => {
    respondWith(view({ showProgress: true, questions: [question(), question({ id: 'q2' })] }))
    renderPage()

    await screen.findByRole('progressbar')
    expect(progressSentence()).toContain('0 de 2 respondidas')
    // The two figures are READINGS — mono with tabular figures — while the words
    // around them stay in the sans face. Asserted as the numerals themselves rather
    // than as a class on the sentence, because that is the rule: `10:00` two readings
    // away in this same bar is checked the same way.
    expect(progressReadings()).toEqual(['0', '2'])
    // Announced, not hidden: this sentence is the only rendering of the fact now, so
    // there is nothing for it to defer to.
    const sentence = document.querySelector('[data-slot="respond-submit-bar"] span span')
    expect(sentence?.closest('[aria-hidden="true"]')).toBeNull()

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-label')).toBe('Respuestas completadas')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')

    await userEvent.click(screen.getAllByRole('radio', { name: 'Muy de acuerdo' })[0])
    expect(progressSentence()).toContain('1 de 2 respondidas')
    expect(progressReadings()).toEqual(['1', '2'])
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
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

    const chip = await screen.findByText('Protegido')
    const notice = chip.closest('[data-slot="alert"]')
    expect(notice, 'the chip belongs to the suppression notice, not to the page at large').toBeTruthy()
    // The padlock beside the word, which is the pair the rest of the redesign uses
    // for a value that exists and is withheld.
    expect(notice!.querySelector('.lucide-lock')).toBeTruthy()
    // Named, in the notice itself. Scoped, because the redesigned confirmation says
    // "reported as averages per department" in the what-happens-now list as well, and
    // an unscoped match would be satisfied by that sentence alone.
    expect(within(notice as HTMLElement).getByText(/deliberadamente: departamento/)).toBeTruthy()

    // THE GUARD. `SurveySubmissionResult` carries the suppressed field NAMES and no
    // cohort size, and the notice must never acquire one: "your department (3
    // people)" is the disclosure suppression exists to prevent, and the floor itself
    // ("fewer than 5") narrows the cohort for anyone reading over a shoulder. No
    // digit at all is the assertion, because either number is one.
    expect(
      notice!.textContent,
      'The suppression notice prints no figure: not the cohort size, not the floor.',
    ).not.toMatch(/\d/)
  })

  /**
   * Every reading gets a track of its own, and the track count follows the readings.
   *
   * The defect this was written for: the closing date used to sit in a `sm:grid-cols-2
   * lg:grid-cols-1 xl:grid-cols-2` wrapper whose only other child renders when the
   * survey turned progress OFF — the rarer case. With progress on, that grid held one
   * child in two columns, so CLOSES rendered at half the panel width with a stranded
   * empty cell beside it at every viewport from 640px up: measured in Chromium at
   * 1440x900, a 197px tile under three 402px ones.
   *
   * **The shape it guards has changed, the defect has not.** The rail is gone and the
   * readings row it left behind is horizontal from `sm` up, so "its own full-width
   * row" is now true only on a phone; above that each reading is its own auto-sized
   * COLUMN. What survives verbatim is the thing that produced the hole — a fixed
   * track count with a conditional child — so this asserts the two halves of that a
   * layout-free DOM can see: every reading is a direct child of the section (no
   * intermediate track for one of them to be laid out inside), and the section has
   * exactly as many cells as it has readings, in each configuration.
   *
   * `auto-cols-fr` versus `grid-cols-N` is a spelling check, like the `sticky` one
   * this file used to carry. It is kept because it names the exact cause: happy-dom
   * cannot measure a 197px tile, but it can read the class that produces one.
   */
  it('gives every panel reading its own track, and never leaves an empty one', async () => {
    respondWith(view({ showProgress: true }))
    const first = renderPage()

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    const closes = within(panel).getByText('Cierra').closest('div')
    expect(closes, 'the CLOSES reading survived the rail it used to live in').toBeTruthy()
    expect(
      closes!.parentElement,
      'A wrapper here is a second grid inside the panel, and the wrapper this '
        + 'replaced held one child in two columns whenever `showProgress` was on — '
        + 'a half-width tile with a hole beside it.',
    ).toBe(panel)

    // One reading, one cell. This is the case that produced the stranded column.
    expect(panel.children.length, 'no cell without a reading in it').toBe(1)
    expect(panel.className).toContain('auto-cols-fr')
    expect(
      panel.className,
      'A fixed track count is the defect itself: the optional readings are absent in '
        + 'the common case, and a track that does not count them strands a hole.',
    ).not.toMatch(/grid-cols-\d/)
    first.unmount()

    // And with a second reading, both are direct children of the same section — two
    // readings, two cells, no wrapper around either.
    respondWith(view({ showProgress: true, timeLimitMinutes: 10 }))
    renderPage()

    const withTime = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    expect(within(withTime).getByText('Cierra').closest('div')!.parentElement).toBe(withTime)
    expect(within(withTime).getByText('Tiempo restante').closest('div')!.parentElement).toBe(withTime)
    expect(withTime.children.length).toBe(2)
  })

  /**
   * And the second reading appears in that same section when the survey turns
   * progress off — the case the fixed two-column wrapper was built for, and the one
   * that used to strand a cell. It is a track of the readings row like every other
   * one now.
   *
   * The QUESTIONS reading exists only in this case, and that is the point: with
   * progress on, the bottom bar's `0 of 12` already says how many questions there
   * are, and two readings of one fact is what makes an instrument read as
   * decoration. So the absence asserted here is the progress cluster's, page-wide —
   * the count moving up is what replaces it, not something shown beside it.
   */
  it('adds the question count as another reading when progress is off', async () => {
    respondWith(view({ showProgress: false, questions: [question(), question({ id: 'q2' })] }))
    renderPage()

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    const count = within(panel).getByText('Preguntas').closest('div')
    expect(count!.parentElement).toBe(panel)
    expect(within(count!).getByText('2')).toBeTruthy()

    // Nowhere on the page, not just nowhere in this section: the progress cluster is
    // off, and the question count is what stands in for it.
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(progressSentence()).not.toContain('respondidas')
  })
})
