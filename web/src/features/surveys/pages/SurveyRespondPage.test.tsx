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
    autoSave: true,
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

/**
 * Keeping progress without being asked, and putting a returning respondent back where
 * they stopped (#369).
 *
 * The product is committed in writing to letting somebody stop part-way and come back.
 * Until this, `send(false)` had exactly one caller — the save button — so closing the
 * tab, losing the connection or letting the phone lock discarded everything, and
 * nothing on the page said so.
 *
 * ## Why these run on real timers
 *
 * The debounce is 1500ms and every assertion below waits it out. Fake timers would be
 * faster and would also let the tests pass while the page saved on a `setInterval`, on
 * every keystroke, or never — because the thing under test IS the timing, and a suite
 * that controls the clock proves only that a callback fires when it is told to. The
 * cost is about six seconds across the file.
 */
describe('SurveyRespondPage autosave', () => {
  /** A survey configured the way the server ships one: partials allowed, autosave on. */
  const autosaving = (overrides: Partial<SurveyRespondView> = {}) =>
    view({ allowPartialResponses: true, autoSave: true, ...overrides })

  /** Every POST body the page has sent, oldest first. */
  function submissions(): Record<string, unknown>[] {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(
        ([, init]) =>
          JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
      )
  }

  /** The `init` of every POST, for the claims about how the request is made. */
  function postInits(): RequestInit[] {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([, init]) => init as RequestInit)
  }

  /**
   * Longer than the debounce with room for the request. Every negative claim below
   * waits this long before asserting nothing happened, so "no autosave" means "none
   * after the window in which one was due", not "none yet".
   */
  const PAST_THE_DEBOUNCE = 2600

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DEBOUNCE))
  }

  it('keeps an answer without the respondent pressing anything', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))

    await waitFor(() => expect(submissions()).toHaveLength(1), { timeout: 4000 })
    expect(submissions()[0]).toMatchObject({
      isComplete: false,
      answers: [{ questionId: 'q1', value: 'strongly_agree' }],
    })
  })

  /**
   * The acceptance criterion, and the one the debounce alone does not meet: a
   * respondent who closes the tab a second after answering is inside the window.
   *
   * `pagehide` is dispatched rather than `beforeunload` because it is the event that
   * fires on every way out INCLUDING the back/forward cache, and because blocking the
   * exit with a confirmation dialog is the opposite of what saving is for.
   */
  it('writes what is on screen when the page goes away, so a closed tab loses nothing', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    // Immediately — well inside the debounce window, which is the whole point.
    window.dispatchEvent(new Event('pagehide'))

    await waitFor(() => expect(submissions()).toHaveLength(1))
    expect(submissions()[0]).toMatchObject({
      isComplete: false,
      answers: [{ questionId: 'q1', value: 'strongly_agree' }],
    })
    // `keepalive` is what lets the request outlive the document that started it. An
    // ordinary fetch is cancelled with the page, which would make this save look like
    // it happened and land nowhere.
    expect(postInits()[0].keepalive).toBe(true)
  })

  /**
   * The interruption the issue is actually about — a phone locking, or the respondent
   * switching apps. `beforeunload` has never fired reliably there; `visibilitychange`
   * to `hidden` does.
   */
  it('writes when the phone locks, which is the interruption that loses work', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))

    const restore = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      await waitFor(() => expect(submissions()).toHaveLength(1))
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState
      if (restore) Object.defineProperty(Document.prototype, 'visibilityState', restore)
    }
  })

  /**
   * Guard on the test above: a `visibilitychange` fired while the page is still
   * visible is what a tab switch back looks like, and it must write nothing. Without
   * this, a handler that ignored `visibilityState` entirely would pass that test.
   */
  it('writes nothing when a visibility change leaves the page visible', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    document.dispatchEvent(new Event('visibilitychange'))

    expect(submissions()).toEqual([])
  })

  /**
   * An empty partial save is accepted by the endpoint and creates a real `responses`
   * row (asserted server-side). That row is a write per visitor who merely opened the
   * link and, on an identified survey, a record that a named employee opened a survey
   * they never answered — so the restraint has to live here.
   */
  it('creates no response at all before the respondent has answered something', async () => {
    respondWith(autosaving())
    renderPage()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    // Both paths: the timer, and the one that fires when the page goes away.
    window.dispatchEvent(new Event('pagehide'))
    await settle()

    expect(submissions()).toEqual([])
  })

  it('does not save in the background when the survey forbids partial responses', async () => {
    respondWith(autosaving({ allowPartialResponses: false }))
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    window.dispatchEvent(new Event('pagehide'))
    await settle()

    expect(submissions()).toEqual([])
  })

  /**
   * The setting this page could not see until #369 served it on `SurveyRespondView`.
   * A survey whose author turned autosave off keeps the button and nothing else.
   */
  it('does not save in the background when the survey turned autosave off', async () => {
    respondWith(autosaving({ autoSave: false }))
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    window.dispatchEvent(new Event('pagehide'))
    await settle()

    expect(submissions()).toEqual([])
    // The button is still there: `AllowPartialResponses` is what offers it, and it is on.
    expect(screen.getByRole('button', { name: 'Guardar y terminar después' })).toBeTruthy()
  })

  /** The completed view is terminal; a background write against it is refused anyway. */
  it('does not save in the background once the response is complete', async () => {
    respondWith(
      autosaving({
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: true,
          language: 'es',
          startTime: '2026-06-01T10:00:00Z',
          completionTime: '2026-06-01T10:20:00Z',
          answers: [
            { questionId: 'q1', value: 'disagree', values: null, text: null, timeSpentSeconds: null },
          ],
        },
      }),
    )
    renderPage()

    await screen.findByText('Ya respondió esta encuesta')
    window.dispatchEvent(new Event('pagehide'))
    await settle()

    expect(submissions()).toEqual([])
  })

  /**
   * The other end of the same rule: a response completed during this visit. The page
   * stays mounted showing its confirmation, and the listeners are still attached.
   */
  it('sends nothing more after the respondent has submitted', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))
    await screen.findByText('Gracias, sus respuestas fueron recibidas')

    const afterSubmit = submissions().length
    window.dispatchEvent(new Event('pagehide'))
    await settle()

    expect(submissions()).toHaveLength(afterSubmit)
    expect(submissions()[afterSubmit - 1].isComplete).toBe(true)
  })

  /**
   * Anonymity (#116) is a property of this payload: an anonymous response is written
   * with no user id, no IP and no user agent, and demographics are captured only on
   * completion. A background save must therefore send what the BUTTON sends and not a
   * field more — a timestamp, a "session started" marker or a partial demographic
   * would each make a half-finished response more attributable than a finished one.
   */
  it('sends exactly what the save button sends, and not one field more', async () => {
    respondWith(autosaving())
    const auto = renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await waitFor(() => expect(submissions()).toHaveLength(1), { timeout: 4000 })
    const background = submissions()[0]
    auto.unmount()

    vi.mocked(fetch).mockClear()
    respondWith(autosaving({ autoSave: false }))
    renderPage()
    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y terminar después' }))
    await waitFor(() => expect(submissions()).toHaveLength(1))
    const pressed = submissions()[0]

    expect(Object.keys(background).sort()).toEqual(Object.keys(pressed).sort())
    expect(background).toEqual(pressed)
  })

  /**
   * A save nobody asked for must not take the keyboard away. `busy` disables every
   * control on the page, which is right for a pressed save and would, on a timer, pull
   * focus out of a half-typed comment.
   */
  it('leaves the form usable while it saves in the background', async () => {
    respondWith(autosaving())
    renderPage()

    const chosen = await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    await userEvent.click(chosen)
    await waitFor(() => expect(submissions()).toHaveLength(1), { timeout: 4000 })

    expect((screen.getByRole('radio', { name: 'En desacuerdo' }) as HTMLInputElement).disabled).toBe(
      false,
    )
    expect(
      (screen.getByRole('button', { name: 'Enviar mis respuestas' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  /**
   * The debounce has to COALESCE, which is the only reason to make a respondent wait
   * 1500ms for a save at all. A timer per change that is never cancelled costs the delay
   * and buys nothing: every edit still becomes its own POST, just a second and a half
   * late.
   *
   * Asserted as timing rather than as a count, because a count alone passes either way
   * once the signature check has deduplicated the extra writes. Answering a second
   * question 1300ms in must push the save out; a save that lands at 1900ms is one that
   * was armed by the FIRST answer and never re-armed by the second.
   */
  it('re-arms the delay on each answer instead of letting every change keep its own timer', async () => {
    respondWith(autosaving({ questions: [question(), question({ id: 'q2', order: 1 })] }))
    renderPage()

    const [first, second] = await screen.findAllByRole('radio', { name: 'Muy de acuerdo' })
    await userEvent.click(first)
    await new Promise((resolve) => setTimeout(resolve, 1300))
    await userEvent.click(second)
    await new Promise((resolve) => setTimeout(resolve, 600))

    // 1900ms after the first answer, 600ms after the second. A timer left armed by the
    // first fired 400ms ago.
    expect(
      submissions(),
      'the second answer must restart the delay, not race a timer the first one left running',
    ).toHaveLength(0)

    // And when it does land it is ONE write carrying both answers, not two.
    await waitFor(() => expect(submissions()).toHaveLength(1), { timeout: 4000 })
    expect(submissions()[0].answers).toHaveLength(2)
  })

  /**
   * Why the POSTs are queued rather than fired at will.
   *
   * `FindExistingResponseAsync` is a check-then-insert: two submissions on the same key
   * that overlap can both find nothing and both insert, and a respondent ends up with
   * two response rows. Before autosave this page could not produce overlapping posts,
   * because the only two buttons that made one were disabled while it was in flight. A
   * timer plus a page-hide flush can, so nothing may go on the wire while a save is
   * still open.
   */
  it('never has two saves in flight at once, so one tab cannot race itself', async () => {
    let releaseFirst: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let posts = 0
    const payload = autosaving()
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }
      posts += 1
      const body = new Response(
        JSON.stringify({
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: false,
          isAnonymous: true,
          alreadySubmitted: false,
          language: 'es',
          answeredQuestionCount: 1,
          questionCount: 1,
          suppressedDemographics: [],
        }),
        { status: 201 },
      )
      // The first save never resolves until this test lets it, which is what makes the
      // second one an overlap rather than a sequel.
      return posts === 1 ? held.then(() => body) : Promise.resolve(body)
    })
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await waitFor(() => expect(posts).toBe(1), { timeout: 4000 })

    // A second save asked for while the first is still open: the respondent changes
    // their answer and leaves the page.
    await userEvent.click(screen.getByRole('radio', { name: 'En desacuerdo' }))
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(
      posts,
      'the second save must wait for the first to finish, not open a second write against the same check-then-insert window',
    ).toBe(1)

    // Queued, not dropped: it goes out as soon as the wire is free.
    releaseFirst?.()
    await waitFor(() => expect(posts).toBe(2), { timeout: 4000 })
  })

  /**
   * An answer the respondent takes back has to be taken back on the server too.
   *
   * `toAnswerInputs` omits an unanswered question, so erasing one simply removed it from
   * the payload — and the server's writer only ever touched what it was sent. The stored
   * answer survived the erasure indefinitely. On an instrument whose promise to the
   * respondent is confidentiality, a free-text comment somebody deliberately deleted
   * still sitting in `question_responses` is the worst shape the bug can take, so the
   * withdrawal is NAMED on the wire rather than left to be inferred from an absence.
   */
  it('tells the server about an answer the respondent erased, instead of just omitting it', async () => {
    respondWith(
      autosaving({
        questions: [question({ id: 'q1', type: 'open_ended', text: '¿Qué cambiarías?', options: null })],
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: false,
          language: 'es',
          startTime: '2026-06-01T10:00:00Z',
          completionTime: null,
          answers: [
            { questionId: 'q1', value: 'Menos reuniones.', values: null, text: null, timeSpentSeconds: null },
          ],
        },
      }),
    )
    renderPage()

    const box = await screen.findByRole('textbox')
    expect((box as HTMLTextAreaElement).value).toBe('Menos reuniones.')
    await userEvent.clear(box)

    await waitFor(() => expect(submissions()).toHaveLength(1), { timeout: 4000 })
    expect(
      submissions()[0],
      'the erased comment must be named for deletion; omitting it leaves it on the server for good',
    ).toMatchObject({ answers: [], clearedQuestionIds: ['q1'] })
  })

  /**
   * The guard on the test above. "Everything the payload does not mention is deleted"
   * would also make that test pass, and would be far worse than the bug it fixes: a
   * partial save is allowed to be a delta, so it would turn every tick into a wipe of
   * whatever it did not happen to mention.
   */
  /**
   * The erasure that happens while the first save is still on the wire.
   *
   * `serverAnswered` only learns what the server holds when a save LANDS, so an erasure
   * made before that moment is computed against an empty set and names nothing. If the
   * page does not reconsider once the save resolves, the deletion is never sent at all —
   * the same answer-outliving-its-erasure bug, reached by timing instead of by omission.
   */
  it('sends the erasure even when the answer was taken back mid-save', async () => {
    let releaseFirst: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let posts = 0
    const bodies: Record<string, unknown>[] = []
    const payload = autosaving({
      questions: [question({ id: 'q1', type: 'open_ended', text: '¿Qué cambiarías?', options: null })],
    })
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
      }
      posts += 1
      bodies.push(JSON.parse(init.body as string) as Record<string, unknown>)
      const body = new Response(
        JSON.stringify({
          responseId: 'r1', sessionId: 'session-1', isComplete: false, isAnonymous: true,
          alreadySubmitted: false, language: 'es', answeredQuestionCount: 1,
          questionCount: 1, suppressedDemographics: [],
        }),
        { status: 201 },
      )
      return posts === 1 ? held.then(() => body) : Promise.resolve(body)
    })
    renderPage()

    const box = await screen.findByRole('textbox')
    await userEvent.type(box, 'Menos')
    await waitFor(() => expect(posts).toBe(1), { timeout: 5000 })

    // Taken back while that first save is still open.
    await userEvent.clear(box)
    releaseFirst?.()

    await waitFor(() => expect(posts).toBe(2), { timeout: 5000 })
    expect(
      bodies[1],
      'the erasure must still reach the server once the save it raced has landed',
    ).toMatchObject({ answers: [], clearedQuestionIds: ['q1'] })
  }, 20000)

  it('names nothing for deletion when the respondent has only ever added answers', async () => {
    respondWith(autosaving({ questions: [question(), question({ id: 'q2', order: 1 })] }))
    renderPage()

    const [first] = await screen.findAllByRole('radio', { name: 'Muy de acuerdo' })
    await userEvent.click(first)

    await waitFor(() => expect(submissions()).toHaveLength(1), { timeout: 4000 })
    expect(submissions()[0].clearedQuestionIds).toBeUndefined()
  })
})

/**
 * Telling the respondent whether their work is anywhere but this screen (#369).
 *
 * The failure being designed against is not "a save failed" — it is "the save has been
 * failing for ten minutes and the page looks fine", which buys trust it is no longer
 * earning and stops the respondent taking care not to lose their answers.
 */
describe('SurveyRespondPage save state', () => {
  const autosaving = (overrides: Partial<SurveyRespondView> = {}) =>
    view({ allowPartialResponses: true, autoSave: true, ...overrides })

  function saveState(): string {
    return document.querySelector('[data-slot="respond-save-state"]')?.textContent ?? ''
  }

  it('says nothing at all on a form nobody has touched', async () => {
    respondWith(autosaving())
    renderPage()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    expect(document.querySelector('[data-slot="respond-save-state"]')).toBeNull()
  })

  it('says the answer is not saved yet, and then that it is, with the time', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    expect(saveState()).toContain('Sin guardar todavía')

    await waitFor(() => expect(saveState()).toContain('Guardado a las'), { timeout: 4000 })
  })

  /**
   * The bar must not go on claiming a save that no longer describes anything.
   *
   * A respondent who erases their only answer leaves a form with nothing on it. "Guardado
   * a las 09:14" underneath it is the same claim about work that does not exist that
   * `idle` exists to avoid — and until the erasure was actually sent it was worse than
   * odd, because the server really did still hold the answer they had just taken back.
   */
  it('stops claiming a save once the respondent has erased everything', async () => {
    respondWith(
      autosaving({
        questions: [question({ id: 'q1', type: 'open_ended', text: '¿Qué cambiarías?', options: null })],
      }),
    )
    renderPage()

    const box = await screen.findByRole('textbox')
    await userEvent.type(box, 'Menos')
    await waitFor(() => expect(saveState()).toContain('Guardado a las'), { timeout: 5000 })

    await userEvent.clear(box)

    await waitFor(
      () =>
        expect(
          document.querySelector('[data-slot="respond-save-state"]'),
          'an emptied form has nothing saved to report',
        ).toBeNull(),
      { timeout: 5000 },
    )
    // The whole point: no lingering "Guardado a las 09:14" over a form with nothing on it.
    expect(saveState()).not.toContain('Guardado a las')
  }, 20000)

  it('reports the save state in the bar the respondent finishes from', async () => {
    respondWith(autosaving())
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    expect(
      document
        .querySelector('[data-slot="respond-save-state"]')
        ?.closest('[data-slot="respond-submit-bar"]'),
      'the save state belongs beside the progress reading and the two actions, not at the top of a page that scrolls away',
    ).toBeTruthy()
  })

  /**
   * The one state a respondent has to act on, so it is a `role="alert"` panel rather
   * than a muted line — and it carries the server's own message beside our sentence,
   * because "the survey has reached its response limit" names something they can do
   * something about and "not saved" does not.
   */
  it('raises an alert when a background save fails, carrying the server’s reason', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ message: 'Se ha alcanzado el límite' }), { status: 400 })
          : new Response(JSON.stringify(autosaving()), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 })
    expect(alert.textContent).toContain('Sus respuestas no se están guardando')
    expect(alert.textContent).toContain('Se ha alcanzado el límite')
  })

  /**
   * Found by rendering it, not by the suite.
   *
   * The first build put this alert under the last question, beside `submitError`. That
   * is the right place for a failed SUBMIT — a submit is pressed from the bottom, and
   * the respondent is already there. It is the wrong place for a failed save, which
   * happens while somebody is on question 3 of 50: the screenshot showed the alert two
   * thousand pixels below the reader, where it stayed unread for the rest of the
   * survey. Every assertion above still passed, because the alert existed and said the
   * right thing.
   */
  it('keeps the failure inside the bar that follows the respondent down the form', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ message: 'Se ha alcanzado el límite' }), { status: 400 })
          : new Response(JSON.stringify(autosaving()), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 })

    expect(
      alert.closest('[data-slot="respond-submit-bar"]'),
      'the only box on this page that stays in view is the submit bar; an alert outside it is an alert nobody on question 3 of 50 will ever read',
    ).toBeTruthy()
  })

  /**
   * Sticky. Answering again re-arms the save, and until one actually lands the warning
   * must stay: a page that goes quiet the moment you type is a page that says your
   * work is safe because you touched it.
   */
  it('keeps the failure on screen while the respondent carries on answering', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ message: 'Se ha alcanzado el límite' }), { status: 400 })
          : new Response(JSON.stringify(autosaving()), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await screen.findByRole('alert', {}, { timeout: 4000 })

    await userEvent.click(screen.getByRole('radio', { name: 'En desacuerdo' }))
    expect(screen.getByRole('alert').textContent).toContain('Sus respuestas no se están guardando')
    expect(saveState()).not.toContain('Guardado')
  })

  /** A pressed save that failed is the same fact, and belongs in the same place. */
  it('reports a failed save-and-finish-later the same way', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ message: 'Se ha alcanzado el límite' }), { status: 400 })
          : new Response(JSON.stringify(autosaving({ autoSave: false })), { status: 200 }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y terminar después' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Sus respuestas no se están guardando')
    // Not "your answers could not be SUBMITTED": that is a different action, and two
    // alerts saying one thing is how a respondent comes to think they lost more.
    expect(alert.textContent).not.toContain('No se pudieron enviar sus respuestas')
  })

  /**
   * Announced ONCE. A screen-reader user has to learn that the page keeps their work
   * by itself; hearing it every fifteen seconds for fifty questions would talk over
   * the questions it exists to protect.
   */
  it('tells a screen reader once that the page is keeping their answers', async () => {
    respondWith(autosaving())
    const { container } = renderPage()
    const region = () => container.querySelector('[data-slot="live-region"]')?.textContent ?? ''

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await waitFor(() => expect(region()).toContain('se van guardando solas'), { timeout: 4000 })

    // Something else is announced, so the region no longer holds the autosave
    // sentence. Without this the region would simply still be showing the FIRST
    // announcement and "announced once" could not be told from "announced again".
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y terminar después' }))
    await waitFor(() => expect(region()).toContain('Su progreso se ha guardado'))

    // A second background save lands, and says nothing.
    await userEvent.click(screen.getByRole('radio', { name: 'En desacuerdo' }))
    await waitFor(() => expect(saveState()).toContain('Guardado a las'), { timeout: 4000 })
    expect(region()).not.toContain('se van guardando solas')
  })
})

/**
 * Where a returning respondent is put (#369).
 *
 * The form is deliberately one page rather than a wizard, so "where they stopped" can
 * only mean focus. `hydrateAnswers` brought the answers back and left the viewport at
 * the top, so on a fifty-question instrument the person most likely to have been
 * interrupted was the one who then had to scroll past their own answers to find the
 * first blank one.
 */
describe('SurveyRespondPage resume position', () => {
  const resumed = (answers: { questionId: string; value: string }[]) =>
    view({
      allowPartialResponses: true,
      autoSave: true,
      questions: [
        question({ id: 'q1', text: 'Pregunta uno', order: 0 }),
        question({ id: 'q2', text: 'Pregunta dos', order: 1 }),
        question({ id: 'q3', text: 'Pregunta tres', order: 2 }),
      ],
      inProgress: {
        responseId: 'r1',
        sessionId: 'session-1',
        isComplete: false,
        language: 'es',
        startTime: '2026-06-01T10:00:00Z',
        completionTime: null,
        answers: answers.map((answer) => ({
          questionId: answer.questionId,
          value: answer.value,
          values: null,
          text: null,
          timeSpentSeconds: null,
        })),
      },
    })

  it('puts focus on the first question without an answer', async () => {
    respondWith(resumed([{ questionId: 'q1', value: 'strongly_agree' }]))
    renderPage()

    await screen.findByText('Pregunta dos')
    await waitFor(() => expect(document.activeElement?.id).toBe('question-q2'))
  })

  /**
   * Not merely "some unanswered question". A respondent who answered the first and the
   * third belongs on the second, and a check that walked the answered list rather than
   * the question list would land them on the last one.
   */
  it('skips over answers given out of order to reach the earliest gap', async () => {
    respondWith(
      resumed([
        { questionId: 'q1', value: 'strongly_agree' },
        { questionId: 'q3', value: 'disagree' },
      ]),
    )
    renderPage()

    await screen.findByText('Pregunta dos')
    await waitFor(() => expect(document.activeElement?.id).toBe('question-q2'))
  })

  it('says where it put them, for a respondent who cannot see the cursor move', async () => {
    respondWith(resumed([{ questionId: 'q1', value: 'strongly_agree' }]))
    const { container } = renderPage()

    await screen.findByText('Pregunta dos')
    await waitFor(() =>
      expect(container.querySelector('[data-slot="live-region"]')?.textContent).toContain(
        'Está en la pregunta 2 de 3',
      ),
    )
  })

  /**
   * A finished form has nothing to be put on. Dropping the cursor at the bottom of it
   * would push the submit button — the one thing they came back for — out of view on a
   * phone.
   */
  it('moves nothing when every question already has an answer, and says so', async () => {
    respondWith(
      resumed([
        { questionId: 'q1', value: 'strongly_agree' },
        { questionId: 'q2', value: 'strongly_agree' },
        { questionId: 'q3', value: 'strongly_agree' },
      ]),
    )
    const { container } = renderPage()

    await screen.findByText('Pregunta tres')
    await waitFor(() =>
      expect(container.querySelector('[data-slot="live-region"]')?.textContent).toContain(
        'todas las preguntas tienen respuesta',
      ),
    )
    expect(document.activeElement?.id).not.toMatch(/^question-/)
  })

  /** A fresh visit has no position to restore, and must not have focus stolen. */
  it('leaves focus alone when there is nothing to resume', async () => {
    respondWith(view({ allowPartialResponses: true, autoSave: true }))
    renderPage()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    expect(document.activeElement?.id).not.toMatch(/^question-/)
  })

  /**
   * Arriving is not a change. The server already holds exactly what came back, so
   * re-posting it would be a write per resume that says nothing — and on a survey
   * answered from a flaky phone, a write per reload.
   */
  it('posts nothing on arrival, because the server already holds what came back', async () => {
    respondWith(resumed([{ questionId: 'q1', value: 'strongly_agree' }]))
    renderPage()

    await screen.findByText('Pregunta dos')
    await new Promise((resolve) => setTimeout(resolve, 2600))

    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toEqual([])
  })

  /**
   * Found by rendering the page, not by the suite.
   *
   * The first build printed "Sin guardar todavía" across the bottom bar of a survey the
   * respondent had only just reopened and never touched — because the debounce effect
   * ran before the one that seeds the signature, compared the hydrated answers against
   * nothing and concluded there was unsaved work. Every assertion about resume still
   * passed: it is correct copy in the wrong state, and it says the opposite of the
   * truth on the one screen whose whole job is telling somebody their work is kept.
   */
  it('does not claim there is unsaved work on a form nobody has touched yet', async () => {
    respondWith(resumed([{ questionId: 'q1', value: 'strongly_agree' }]))
    renderPage()

    await screen.findByText('Pregunta dos')
    await new Promise((resolve) => setTimeout(resolve, 2600))

    expect(document.querySelector('[data-slot="respond-save-state"]')?.textContent ?? '').not.toContain(
      'Sin guardar todavía',
    )
  })

  /** But answering after a resume is, and it saves the whole set rather than the delta. */
  it('saves the restored answers together with the new one', async () => {
    respondWith(resumed([{ questionId: 'q1', value: 'strongly_agree' }]))
    renderPage()

    await screen.findByText('Pregunta dos')
    const second = within(
      screen.getByText('Pregunta dos').closest('fieldset') as HTMLElement,
    ).getByRole('radio', { name: 'En desacuerdo' })
    await userEvent.click(second)

    await waitFor(() => expect(lastSubmission().isComplete).toBe(false), { timeout: 4000 })
    expect(lastSubmission().answers).toEqual([
      { questionId: 'q1', value: 'strongly_agree' },
      { questionId: 'q2', value: 'disagree' },
    ])
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
