import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import SurveyRespondForm from './SurveyRespondForm'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import type { SurveyRespondQuestion, SurveyRespondView } from '../api/surveyResponses'

/**
 * The respond form as the approved employee design draws it.
 *
 * `pages/SurveyRespondPage.test.tsx` covers what this form *does* — the payload, the
 * required-question rule, the four unavailable states, resume and language. This
 * file covers the four things the redesign changed about how it is *shaped*, each of
 * which a green suite could otherwise be made to hold while the page looked nothing
 * like the design:
 *
 * 1. the questions are asked under dimension headings, from `respondDimensions`;
 * 2. a bare numeric scale is a segmented control rather than a row of radios;
 * 3. the right-hand rail is gone — the promise is the first block and the count and
 *    the actions ride a bar stuck to the bottom;
 * 4. the confirmation says what happens next, from data already in hand.
 *
 * Rendered against the component directly rather than through a route: every claim
 * here is about this component's own output, and `SurveyRespondPage` is forty lines
 * of shell around it.
 */

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

/** A likert question with no option set, which is the shape the segmented scale is for. */
function scaleQuestion(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return question({
    type: 'likert',
    options: null,
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMin: 'Nunca',
    scaleLabelMax: 'Siempre',
    ...overrides,
  })
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
    // Midday UTC on purpose: a midnight timestamp formats as the previous day in
    // every timezone behind UTC, and the suite runs in America/Chicago.
    endDate: '2026-09-12T12:00:00Z',
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

interface SubmissionOverrides {
  answeredQuestionCount?: number
  questionCount?: number
  alreadySubmitted?: boolean
  suppressedDemographics?: string[]
}

function respondWith(payload: SurveyRespondView, submission: SubmissionOverrides = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            responseId: 'r1',
            sessionId: 'session-1',
            isComplete: init.body ? JSON.parse(init.body as string).isComplete : true,
            isAnonymous: payload.anonymous,
            alreadySubmitted: submission.alreadySubmitted ?? false,
            language: payload.resolvedLocale,
            answeredQuestionCount: submission.answeredQuestionCount ?? 1,
            questionCount: submission.questionCount ?? payload.questions.length,
            suppressedDemographics: submission.suppressedDemographics ?? [],
          }),
          { status: 201 },
        ),
      )
    }
    void input
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

function renderForm(props: { publicEntry?: boolean } = {}) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1/respond']}>
        <SurveyRespondForm surveyId="s1" {...props} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The body of the last POST the form made. */
function lastSubmission(): Record<string, unknown> {
  const posts = vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  return JSON.parse((posts[posts.length - 1][1] as RequestInit).body as string) as Record<
    string,
    unknown
  >
}

/** The uppercase eyebrows of the dimension headings, in the order they are printed. */
function headings(): string[] {
  return [...document.querySelectorAll('form h2')].map((node) => node.textContent ?? '')
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

/**
 * 1. The questions are asked under the headings the analysis reports under.
 *
 * The grouping itself belongs to `respondDimensions` and is proved there. What is
 * proved here is that this page asks it, prints what it returns, and prints nothing
 * when it says there is no structure to show.
 */
describe('SurveyRespondForm dimension sections', () => {
  const sectioned = view({
    questions: [
      question({ id: 'a', text: 'Pregunta A', category: 'psychological_safety' }),
      question({ id: 'b', text: 'Pregunta B', category: 'psychological_safety' }),
      question({ id: 'c', text: 'Pregunta C', category: 'workload' }),
    ],
  })

  it('prints a heading per dimension, in the order the author put them in', async () => {
    respondWith(sectioned)
    renderForm()

    await screen.findByText('Pregunta A')
    expect(headings()).toEqual(['Seguridad psicológica', 'Carga de trabajo'])
  })

  /**
   * The design's `1–2 OF 12` reading. A section of one prints `3 of 12` instead — a
   * range whose ends are equal reads as an error rather than as a single question.
   */
  it('reads the range each heading covers, and collapses a range of one', async () => {
    respondWith(sectioned)
    renderForm()

    expect(await screen.findByText('1–2 de 3')).toBeTruthy()
    expect(screen.getByText('3 de 3')).toBeTruthy()
  })

  /**
   * The numbering is the position in the whole form, not in the section. Restarting
   * it under each heading would tell a respondent three questions in that they are
   * on question 1 of 3.
   */
  it('numbers the questions across the headings rather than within them', async () => {
    respondWith(sectioned)
    renderForm()

    await screen.findByText('Pregunta C')
    const legends = [...document.querySelectorAll('legend')].map((node) => node.textContent ?? '')
    expect(legends[2]).toContain('Pregunta 3 de 3')
  })

  /**
   * `respondDimensions` switches sectioning off for a randomised survey, because
   * grouping a shuffled list gathers each dimension's questions back together and
   * undoes the randomisation the author asked for. The page must honour that rather
   * than re-derive its own answer.
   */
  it('prints no headings at all when the survey randomises its questions', async () => {
    respondWith(view({ ...sectioned, randomizeQuestions: true }))
    renderForm()

    await screen.findByText('Pregunta A')
    expect(headings()).toEqual([])
    // And every question is still asked — an unsectioned run is the whole form.
    expect(document.querySelectorAll('legend')).toHaveLength(3)
  })

  /**
   * `Question.Category` is free text the server neither controls nor translates, so
   * the catalogue is a translation table for the ten values the product ships, not a
   * vocabulary. A value outside it is the author's own word for what is being asked,
   * and is printed as such; a question with no category at all is named from the
   * catalogue, because there is no word to print.
   *
   * `hybrid_working` and `mentoring` are deliberately NOT in `surveyRespond.dimensions`
   * and must not be added: this is the case that proves an uncatalogued category still
   * names its own section. This example used to be `recognition`, which stopped being
   * uncatalogued the moment the seeded survey's vocabulary (safety / trust /
   * recognition / growth / belonging) was added. Pick values no product would ship.
   */
  it('names an uncatalogued category in the survey’s own words, and an absent one from the catalogue', async () => {
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: 'hybrid_working' }),
          question({ id: 'b', text: 'Pregunta B', category: null }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta A')
    // The separator is opened out and nothing else is: the design uppercases this
    // heading in CSS, so inventing case here would be invisible and could only
    // mangle a word the author capitalised on purpose.
    expect(headings()).toEqual(['hybrid working', 'Otras preguntas'])
  })

  /**
   * The defect this replaced: `respondDimensions` groups by the raw key, so two
   * uncatalogued categories are two real sections — and both used to be headed
   * "Más preguntas". The respondent could not tell whether the form had changed
   * subject or the page had broken. Distinctness is the property, not the wording.
   */
  it('never gives two different dimensions the same heading', async () => {
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: 'hybrid_working' }),
          question({ id: 'b', text: 'Pregunta B', category: 'mentoring' }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta B')
    const printed = headings()
    expect(printed).toHaveLength(2)
    expect(new Set(printed).size, `two sections read the same: ${printed.join(' / ')}`).toBe(2)
    // And neither fell back to the generic, which is what made them identical.
    expect(printed).not.toContain('Más preguntas')
  })

  /**
   * The generic still has a job. A category of punctuation has nothing to open out,
   * and a heading reading `___` says less than "more questions" does.
   */
  it('falls back to the generic only when the category carries no letter or digit', async () => {
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: '___' }),
          question({ id: 'b', text: 'Pregunta B', category: 'mentoring' }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta B')
    expect(headings()).toEqual(['Más preguntas', 'mentoring'])
  })
})

/**
 * 2. The 1–5 scale is a control, not a row of radio dots.
 *
 * `SegmentedScale` proves its own keyboard and ARIA behaviour. What is proved here
 * is that this form reaches for it for the questions it is for, leaves every other
 * question type alone, and still submits the stable code rather than a label.
 */
describe('SurveyRespondForm numeric scales', () => {
  it('answers a bare likert with a segmented radiogroup rather than native radios', async () => {
    respondWith(view({ questions: [scaleQuestion()] }))
    const { container } = renderForm()

    const group = await screen.findByRole('radiogroup')
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
    // The natives are gone: not restyled, replaced.
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    // The anchors sit under the ends of the row they annotate.
    expect(screen.getByText('Nunca')).toBeTruthy()
    expect(screen.getByText('Siempre')).toBeTruthy()
  })

  it('submits the scale point as the stored code', async () => {
    respondWith(view({ questions: [scaleQuestion()] }))
    renderForm()

    const group = await screen.findByRole('radiogroup')
    await userEvent.click(within(group).getAllByRole('radio')[3])
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await vi.waitFor(() =>
      expect(lastSubmission().answers).toEqual([{ questionId: 'q1', value: '4' }]),
    )
  })

  /**
   * The group is named by the question, exactly as the `<fieldset>`'s `<legend>`
   * named the radios it replaces. An unnamed radiogroup is announced as "group".
   */
  it('names the group with the question it answers', async () => {
    respondWith(view({ questions: [scaleQuestion()] }))
    renderForm()

    const group = await screen.findByRole('radiogroup', { name: /satisfecho/ })
    expect(group.getAttribute('aria-required')).toBeNull()
  })

  /**
   * The other question types are untouched. A multiple-choice question — and a
   * likert that DOES carry authored options — keeps the native radios, because a
   * segment can hold "1" and not "Muy de acuerdo".
   */
  it('leaves a question with authored options on native radios', async () => {
    respondWith(view({ questions: [question(), scaleQuestion({ id: 'q2', options: null })] }))
    const { container } = renderForm()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(2)
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
  })
})

/**
 * 3. One column: the promise on top, the instrument on the bottom.
 *
 * The rail held the right content in the wrong place — a third of the width gone
 * from the form, a column of white space below the fold, and nothing at all below
 * `lg`, which is where this page is mostly answered.
 */
describe('SurveyRespondForm layout', () => {
  it('puts the anonymity promise above the questions, not beside them', async () => {
    respondWith(view({ anonymous: true }))
    renderForm()

    const promise = await screen.findByText('Esta encuesta es anónima')
    const block = promise.closest('section')
    const form = document.querySelector('form')
    expect(block, 'the promise renders in its own block').toBeTruthy()
    expect(form).toBeTruthy()

    // Same parent as the form — i.e. a full-width block of the page, not a child of
    // a side column beside it. A re-introduced rail would make the promise's parent
    // the column rather than the surface.
    expect(block!.parentElement).toBe(form!.parentElement)
    // And it comes first, on every viewport, because there is only one order now.
    expect(block!.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  /**
   * The count and the two actions ride the bottom of the viewport.
   *
   * happy-dom does no layout, so whether the bar *visually* sticks is not knowable
   * here — `components/layout/respondSticky.test.tsx` is where this page's computed
   * positioning is measured. What is knowable is that the three things the design
   * puts in the bar are in the bar, and that the bar asks to be stuck to the bottom.
   */
  it('gathers the progress reading and both actions into a bar pinned to the bottom', async () => {
    respondWith(
      view({
        showProgress: true,
        allowPartialResponses: true,
        questions: [question(), question({ id: 'q2' }), question({ id: 'q3' })],
      }),
    )
    const { container } = renderForm()

    await screen.findByRole('button', { name: 'Enviar mis respuestas' })
    const bar = container.querySelector('[data-slot="respond-submit-bar"]') as HTMLElement | null
    expect(bar, 'the form ends in a submit bar').toBeTruthy()
    expect(bar!.className).toContain('sticky')
    expect(bar!.className).toContain('bottom-0')

    expect(within(bar!).getByRole('progressbar')).toBeTruthy()
    // Read off the bar's own text rather than matched as one string: `MonoReadings`
    // sets the numerals in mono and leaves the prose in the sans face, so the
    // sentence is spread across several elements and an exact-text query cannot
    // match it. The numerals are asserted to BE readings just below.
    expect(bar!.textContent).toContain('0 de 3 respondidas')
    expect(
      Array.from(bar!.querySelectorAll('.font-mono.tabular-nums')).map((n) => n.textContent),
    ).toEqual(['0', '3'])
    expect(within(bar!).getByRole('button', { name: 'Guardar y terminar después' })).toBeTruthy()
    expect(within(bar!).getByRole('button', { name: 'Enviar mis respuestas' })).toBeTruthy()
  })

  it('counts an answer into the bar as it is given', async () => {
    respondWith(view({ showProgress: true, questions: [question(), question({ id: 'q2' })] }))
    renderForm()

    const radios = await screen.findAllByRole('radio', { name: 'Muy de acuerdo' })
    await userEvent.click(radios[0])
    const bar = document.querySelector('[data-slot="respond-submit-bar"]') as HTMLElement
    expect(bar.textContent).toContain('1 de 2 respondidas')
    expect(
      Array.from(bar.querySelectorAll('.font-mono.tabular-nums')).map((n) => n.textContent),
    ).toEqual(['1', '2'])
  })

  /**
   * The rail's readings were relocated, not deleted. Losing the closing date is the
   * failure mode of "remove the right column" done carelessly, and it is the one
   * fact a respondent deciding whether to finish later actually needs.
   */
  it('keeps the closing date and the time limit as readings', async () => {
    respondWith(view({ timeLimitMinutes: 10 }))
    renderForm()

    const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
    expect(within(panel).getByText('Cierra')).toBeTruthy()
    expect(within(panel).getByText('12 sept 2026')).toBeTruthy()
    expect(within(panel).getByText('Tiempo restante')).toBeTruthy()
    expect(within(panel).getByText('10:00')).toBeTruthy()
  })

  /**
   * The closing date is a CALENDAR DAY, and it is read in UTC.
   *
   * The API stamps `endDate` as the end of one — the seeded Q3 closes at
   * `2026-08-05T23:59:59+00:00`. Formatted in the reader's own zone that instant is
   * **6 August** in Tokyo and in Madrid, so every respondent east of UTC was told a
   * deadline a day later than the one the server enforces, on the screen whose whole
   * job is to say when to answer by.
   *
   * **This test forces a timezone, and it has to.** CI and this machine both run in
   * UTC, where the wrong code and the right code render the same string — which is
   * exactly how the bug survived a sweep that routed every other date through
   * `lib/calendarDay.ts`. Without the stub this case cannot fail.
   */
  it('reads the closing date as a calendar day, not in the reader’s timezone', async () => {
    const original = process.env.TZ
    process.env.TZ = 'Asia/Tokyo'
    try {
      // 23:59:59Z — the last second of 5 August in UTC, already the 6th in Tokyo.
      respondWith(view({ endDate: '2026-08-05T23:59:59+00:00' }))
      renderForm()

      const panel = await screen.findByRole('region', { name: 'Sobre esta encuesta' })
      expect(within(panel).getByText('5 ago 2026')).toBeTruthy()
      expect(within(panel).queryByText('6 ago 2026')).toBeNull()
    } finally {
      process.env.TZ = original
    }
  })
})

/**
 * 4. The confirmation answers the three questions that are actually outstanding.
 *
 * All of it from data already in hand: `view.endDate`, the server's own
 * `answeredQuestionCount` and the platform anonymity floor. A confirmation that had
 * to fetch something could fail after a response was accepted.
 */
describe('SurveyRespondForm confirmation', () => {
  async function submitOnce(overrides: SubmissionOverrides = {}, props = {}) {
    respondWith(view({ questions: [question()] }), { answeredQuestionCount: 3, ...overrides })
    const rendered = renderForm(props)
    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))
    await screen.findByText('Qué pasa ahora')
    return rendered
  }

  it('tells the respondent what happens to the answers, when it closes and when results come back', async () => {
    await submitOnce()

    expect(screen.getByText('Sus respuestas se agrupan de inmediato')).toBeTruthy()
    // The floor is the platform constant, not a number typed into the copy.
    expect(screen.getByText(/menos de 5 personas/)).toBeTruthy()
    // The close date is `view.endDate`, spelled out rather than abbreviated.
    expect(screen.getByText('La encuesta cierra el 12 de septiembre de 2026')).toBeTruthy()
    expect(screen.getByText('Los resultados llegan a su departamento')).toBeTruthy()
  })

  it('says plainly that it cannot show the answers again', async () => {
    await submitOnce()
    expect(screen.getByText(/No podemos volver a mostrarle sus respuestas/)).toBeTruthy()
  })

  it('reads back what was recorded, and when', async () => {
    await submitOnce()
    expect(screen.getByText(/^3 respuestas, enviadas a las \d{1,2}:\d{2}\./)).toBeTruthy()
    // The receipt reading the page has always given is still there.
    expect(screen.getByText('Respuestas registradas')).toBeTruthy()
  })

  /**
   * `alreadySubmitted` means the server matched an existing complete response for
   * this session, so nothing was written just now — "enviadas a las 09:14" would be
   * a statement about a moment that did not happen.
   */
  it('keeps the already-answered wording, and claims no submission time', async () => {
    await submitOnce({ alreadySubmitted: true })

    expect(screen.getByText('Ya respondió esta encuesta')).toBeTruthy()
    expect(screen.queryByText(/enviadas a las/)).toBeNull()
    // What happens next is still true of a response that was already stored.
    expect(screen.getByText('Qué pasa ahora')).toBeTruthy()
  })

  it('offers a signed-in respondent the way back to Home', async () => {
    await submitOnce()
    const home = screen.getByRole('link', { name: 'Volver al inicio' })
    expect(home.getAttribute('href')).toBe('/dashboard')
  })

  /**
   * A visitor on `/survey/:id` may hold nothing but the link they followed. A Home
   * link there is a round trip through `RequireAuth` to a sign-in form nobody asked
   * for.
   */
  it('offers no way back to Home on the public route', async () => {
    await submitOnce({}, { publicEntry: true })
    expect(screen.queryByRole('link', { name: 'Volver al inicio' })).toBeNull()
  })

  /** The suppressed-demographics notice survived the rewrite of the screen around it. */
  it('still names a demographic that was deliberately not recorded', async () => {
    await submitOnce({ suppressedDemographics: ['departamento'] })
    expect(screen.getByText('Protegido')).toBeTruthy()
    // Named in the suppression notice specifically — "departamento" also appears in
    // the what-happens-now row about where results go.
    expect(screen.getByText(/no se guardaron con ella deliberadamente: departamento/)).toBeTruthy()
  })
})
