import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import SurveyRespondForm from './SurveyRespondForm'
import { TranslationProvider } from '../../../i18n'
import { CATALOGUES, LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { createTranslator } from '../../../i18n/translate'
import type {
  SurveyRespondDemographicField,
  SurveyRespondQuestion,
  SurveyRespondView,
} from '../api/surveyResponses'
import { RADIO_CEILING } from './RespondDemographicField'
import { hasAnswered, markAnswered } from '../respondReceipt'
import { readSessionId } from '../respondSession'
import { STALE_MS, heldElsewhere } from '../respondLock'

/**
 * The shipped wording, read from the catalogue the component reads.
 *
 * Every expectation about a *catalogued* heading goes through this rather than
 * repeating the Spanish or the English in the test. A literal here would be a second
 * copy of the catalogue that agrees with itself: reword `enps` in `en.json` and the
 * copy still says what it always said, so the test would pass while asserting about
 * a string the product no longer prints.
 */
const copy = { en: createTranslator(CATALOGUES.en), es: createTranslator(CATALOGUES.es) } as const

/**
 * The respond form as the canvas draws it (RespondSurveyPhone and
 * RespondConfirmationPhone, 10 Sep).
 *
 * `pages/SurveyRespondPage.test.tsx` covers what this form *does* — the payload, the
 * required-question rule, the four unavailable states, resume and language. This
 * file covers what the redesign changed about how it is *shaped*, each of which a
 * green suite could otherwise be made to hold while the page looked nothing like the
 * canvas:
 *
 * 1. each question is labelled with its dimension, from `respondDimensions`;
 * 2. a bare numeric scale is a segmented control rather than a row of radios;
 * 3. the promise is the first block, the position heads the question, and the two
 *    actions sit under the card — one question at a time;
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
    autoSave: true,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [question()],
    demographics: [],
    inProgress: null,
    ...overrides,
  }
}

interface SubmissionOverrides {
  answeredQuestionCount?: number
  questionCount?: number
  alreadySubmitted?: boolean
  suppressedDemographics?: string[]
  suppressedDemographicLabels?: string[]
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
            ...(submission.suppressedDemographicLabels && {
              suppressedDemographicLabels: submission.suppressedDemographicLabels,
            }),
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

/** The dimension label on the question card that is on screen, or `null`. */
function dimensionNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="question-dimension"]')
}

/**
 * A dimension label **as the respondent reads it**.
 *
 * Not `textContent`. The canvas sets the label in `uppercase`, so `textContent` is the
 * value *before* the transform, and asserting on it is how two labels that collide on
 * screen — `team_support` and `Team Support` both print TEAM SUPPORT — can be asserted
 * "distinct" and stay green. happy-dom loads no stylesheet, so the transform is applied
 * here from the class, and `prints its dimension label in uppercase` below asserts the
 * class is there — without it this helper would silently turn back into `textContent`.
 */
function readDimension(node: HTMLElement | null): string | null {
  if (node === null) return null
  const text = node.textContent ?? ''
  return node.classList.contains('uppercase') ? text.toUpperCase() : text
}

/**
 * Every question's dimension label, met the way a respondent meets them: one page at a
 * time, turned with "Siguiente" until the last page offers the submit instead. `null` for
 * a card that prints none. The fixtures' questions are optional, so nothing stops a turn.
 */
async function dimensionsAcrossPages(read: (node: HTMLElement | null) => string | null = readDimension) {
  const seen: (string | null)[] = []
  for (let guard = 0; guard < 50; guard += 1) {
    seen.push(read(dimensionNode()))
    const next = screen.queryByRole('button', { name: 'Siguiente' })
    if (next === null) return seen
    await userEvent.click(next)
  }
  throw new Error('more than 50 pages: the walk is not turning')
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
describe('SurveyRespondForm dimension labels', () => {
  const sectioned = view({
    questions: [
      question({ id: 'a', text: 'Pregunta A', category: 'psychological_safety' }),
      question({ id: 'b', text: 'Pregunta B', category: 'psychological_safety' }),
      question({ id: 'c', text: 'Pregunta C', category: 'workload' }),
    ],
  })

  /**
   * The canvas's "2/6 · CARGA DE TRABAJO": one question per page, and the dimension it is
   * asked under beside its position. The grouping is still `respondDimensions`', so the
   * respondent is asked under the names the analysis reports under.
   */
  it('labels each question with its dimension, in the order the author put them in', async () => {
    respondWith(sectioned)
    renderForm()

    await screen.findByText('Pregunta A')
    expect(await dimensionsAcrossPages()).toEqual([
      copy.es('surveyRespond.dimensions.psychological_safety').toUpperCase(),
      copy.es('surveyRespond.dimensions.psychological_safety').toUpperCase(),
      copy.es('surveyRespond.dimensions.workload').toUpperCase(),
    ])
  })

  /** The premise `readDimension` rests on, asserted rather than assumed. */
  it('prints its dimension label in uppercase, as the canvas sets it', async () => {
    respondWith(sectioned)
    renderForm()

    await screen.findByText('Pregunta A')
    const node = dimensionNode()
    expect(node).toBeTruthy()
    expect(
      node!.classList.contains('uppercase'),
      'readDimension() reads the text transform off this class; without it the ' +
        'assertions below compare the pre-transform text.',
    ).toBe(true)
  })

  /**
   * Where the respondent is, said twice and never disagreeing: the reading at the head
   * of the page ("2 de 6") and the chip on the card ("2/6"), both moving with the page.
   */
  it('reads where the respondent is, at the head and on the card, page by page', async () => {
    respondWith(view({ ...sectioned, showProgress: true }))
    renderForm()

    await screen.findByText('Pregunta A')
    const position = () => document.querySelector('[data-slot="respond-position"]')?.textContent
    const chip = () => document.querySelector('[data-slot="question-index"]')?.textContent
    expect([position(), chip()]).toEqual(['1 de 3', '1/3'])
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect([position(), chip()]).toEqual(['2 de 3', '2/3'])
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect([position(), chip()]).toEqual(['3 de 3', '3/3'])
  })

  /**
   * The numbering is the position in the whole form, not in the dimension. Restarting it
   * under each one would tell a respondent three questions in that they are on 1 of 3.
   */
  it('numbers the questions across the dimensions rather than within them', async () => {
    respondWith(sectioned)
    renderForm()

    await screen.findByText('Pregunta A')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Pregunta C')).toBeTruthy()
    expect(document.querySelector('legend')?.textContent).toContain('Pregunta 3 de 3')
  })

  /**
   * `respondDimensions` switches grouping off for a randomised survey, because naming a
   * shuffled list by dimension gathers each dimension back together in the reader's head
   * and undoes the randomisation the author asked for. The page honours that rather than
   * re-deriving its own answer — and every question is still asked.
   */
  it('prints no dimension at all when the survey randomises its questions', async () => {
    respondWith(view({ ...sectioned, randomizeQuestions: true }))
    renderForm()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    expect(await dimensionsAcrossPages()).toEqual([null, null, null])
  })

  /**
   * `Question.Category` is free text the server neither controls nor translates, so the
   * catalogue is a translation table for the values the product ships, not a vocabulary.
   * A value outside it is the author's own word and is printed as such; a question with
   * no category at all is named from the catalogue.
   *
   * `hybrid_working` and `mentoring` are deliberately NOT in `surveyRespond.dimensions`
   * and must not be added: they are what makes these uncatalogued. Pick values no product
   * would ship.
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
    // The separator is opened out and nothing else is: the canvas uppercases this label
    // in CSS, so inventing case here would be invisible and could only mangle a word the
    // author capitalised on purpose.
    expect(await dimensionsAcrossPages()).toEqual([
      'HYBRID WORKING',
      copy.es('surveyRespond.dimensionNone').toUpperCase(),
    ])
  })

  /**
   * Each uncatalogued dimension is named from its own category — not from the generic,
   * which is what made N uncatalogued sections read as N copies of one label before.
   * Checked against each category's own text, derived from the input rather than restated.
   */
  it('names each uncatalogued dimension from its own category, not from the generic', async () => {
    const categories = ['hybrid_working', 'mentoring']
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: categories[0] }),
          question({ id: 'b', text: 'Pregunta B', category: categories[1] }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta A')
    const printed = await dimensionsAcrossPages()
    expect(printed).toEqual(categories.map((category) => category.replace(/_/g, ' ').toUpperCase()))
    expect(printed).not.toContain(copy.es('surveyRespond.dimensionUnknown').toUpperCase())
  })

  /**
   * The first bound on the claim above, pinned so it is a fact rather than a paragraph.
   * `respondDimensions` groups by `dimensionKeyOf`'s trim, which is case-SENSITIVE, while
   * the label is set in `uppercase`, which is not. So two categories differing only in
   * case are two dimensions — two different label texts — that READ the same on screen.
   */
  it('still reads the same for two categories differing only in case — the known bound', async () => {
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: 'team support' }),
          question({ id: 'b', text: 'Pregunta B', category: 'Team Support' }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta A')
    // Two keys, because the grouping is case-sensitive...
    const raw = (node: HTMLElement | null) => node?.textContent ?? null
    expect(await dimensionsAcrossPages(raw)).toEqual(['team support', 'Team Support'])
    cleanup()

    // ...reading the same, because the rendering is not.
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: 'team support' }),
          question({ id: 'b', text: 'Pregunta B', category: 'Team Support' }),
        ],
      }),
    )
    renderForm()
    await screen.findByText('Pregunta A')
    expect(await dimensionsAcrossPages()).toEqual(['TEAM SUPPORT', 'TEAM SUPPORT'])
  })

  /**
   * The second bound. A catalogue *value* can equal another category's authored form:
   * `enps` is labelled "Recommending this place to work", and an author who types that
   * sentence as a category gets the same words. No normalisation of the KEYS can see it,
   * and grouping on the rendered label would re-section the form when the language
   * changes mid-answer — which is why `dimensionLabel` claims only what it can hold.
   */
  it('reads the same for a catalogued dimension and a category spelled like its label', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const enpsHeading = copy.en('surveyRespond.dimensions.enps')
    respondWith(
      view({
        resolvedLocale: 'en',
        questions: [
          question({ id: 'a', text: 'Question A', category: 'enps' }),
          question({ id: 'b', text: 'Question B', category: enpsHeading }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Question A')
    const walk = async () => {
      const seen: (string | null)[] = []
      for (let guard = 0; guard < 10; guard += 1) {
        seen.push(readDimension(dimensionNode()))
        const next = screen.queryByRole('button', { name: 'Next' })
        if (next === null) return seen
        await userEvent.click(next)
      }
      return seen
    }
    const printed = await walk()
    expect(printed).toHaveLength(2)
    expect(new Set(printed).size, `expected a collision, got ${printed.join(' / ')}`).toBe(1)
    expect(printed[0]).toBe(enpsHeading.toUpperCase())
  })

  /**
   * `_` is a separator standing in for a space in a machine-shaped slug and is opened out.
   * A hyphen is a character of running text in both shipped locales and is not: losing a
   * real hyphen changes a word the author chose.
   */
  it('opens out the underscore and leaves the author’s hyphens alone', async () => {
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: 'work-life balance' }),
          question({ id: 'b', text: 'Pregunta B', category: 'COVID-19' }),
          question({ id: 'c', text: 'Pregunta C', category: 'comunicación jefe-equipo' }),
          question({ id: 'd', text: 'Pregunta D', category: 'hybrid_working' }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta A')
    expect(await dimensionsAcrossPages()).toEqual([
      'WORK-LIFE BALANCE',
      'COVID-19',
      'COMUNICACIÓN JEFE-EQUIPO',
      'HYBRID WORKING',
    ])
  })

  /**
   * `Category` is `varchar(100)` and the label prints it in full. On a 390px card the
   * meta row is the `2/6` chip and then the label, so a hundred characters must be
   * clipped to the card rather than widen it.
   *
   * These are assertions about CLASS NAMES, and a class name is not a layout — happy-dom
   * has none. They can only fail when a class is deleted. Re-verify with a screenshot
   * whenever this row changes:
   *
   *   npm run shot -- /surveys/44444444-4444-4444-4444-444444440006/respond out.png \
   *     --fixtures scripts/shot-fixtures/employee-respond-long-category.json \
   *     --role employee --width 390
   *
   * A PNG wider than the requested viewport IS the bug.
   */
  it('bounds a long category so the label cannot widen the card', async () => {
    const long = 'satisfacción con la comunicación entre turnos de noche y coordinación de relevos'
    respondWith(
      view({
        questions: [
          question({ id: 'a', text: 'Pregunta A', category: long }),
          question({ id: 'b', text: 'Pregunta B', category: 'workload' }),
        ],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta A')
    const label = dimensionNode()!
    // Shrinkable and clipped to one line, rather than a nowrap run the card must fit.
    expect(label.className.split(/\s+/)).toContain('min-w-0')
    expect(label.className.split(/\s+/)).toContain('truncate')
    // Truncated on screen, so the whole category stays reachable — the author's text.
    expect(label.getAttribute('title')).toBe(long)
    // The row wraps, so the label can take a line of its own under the chip.
    expect(label.parentElement!.className.split(/\s+/)).toContain('flex-wrap')
    // And the card itself may shrink below its min-content width.
    expect(label.closest('fieldset')!.className.split(/\s+/)).toContain('min-w-0')
  })

  /**
   * The generic still has a job. A category of punctuation has nothing to open out, and a
   * label reading `___` says less than "more questions" does.
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

    await screen.findByText('Pregunta A')
    expect(await dimensionsAcrossPages()).toEqual([
      copy.es('surveyRespond.dimensionUnknown').toUpperCase(),
      'MENTORING',
    ])
  })
})

/**
 * 1b. One question at a time (the triage's "one question at a time on small screens").
 *
 * Only the presentation is paged: the answer map, the autosave and the one POST that
 * completes the response are the ones the long form had — `SurveyRespondPage.test.tsx`
 * pins the payload. What is pinned here is the paging itself.
 */
describe('SurveyRespondForm one question at a time', () => {
  const three = () =>
    view({
      questions: [
        question({ id: 'q1', text: 'Pregunta uno' }),
        question({ id: 'q2', text: 'Pregunta dos', order: 1 }),
        question({ id: 'q3', text: 'Pregunta tres', order: 2 }),
      ],
    })

  it('shows one question, and draws Anterior disabled on the first so the way on never moves', async () => {
    respondWith(three())
    renderForm()

    await screen.findByText('Pregunta uno')
    expect(document.querySelectorAll('fieldset[id^="question-"]')).toHaveLength(1)
    expect(screen.queryByText('Pregunta dos')).toBeNull()
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true)
    // Not the submit yet: a respondent on question 1 has not asked to finish.
    expect(screen.queryByRole('button', { name: 'Enviar mis respuestas' })).toBeNull()
  })

  it('stops Siguiente on a required question with no answer, on that question', async () => {
    respondWith(
      view({
        questions: [question({ id: 'q1', text: 'Pregunta uno', required: true }), question({ id: 'q2', text: 'Pregunta dos', order: 1 })],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta uno')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    // Still on it, told why, and put on it — not sent to question 2 to meet the error at
    // the end.
    expect(screen.getByText('Pregunta uno')).toBeTruthy()
    expect(screen.queryByText('Pregunta dos')).toBeNull()
    expect(screen.getByText(copy.es('surveyRespond.answerRequired'))).toBeTruthy()
    expect(document.activeElement?.id).toBe('question-q1')
  })

  it('turns back with Anterior and keeps the answer given', async () => {
    respondWith(three())
    renderForm()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText('Pregunta dos')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))

    expect(await screen.findByText('Pregunta uno')).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'Muy de acuerdo' }) as HTMLInputElement).checked).toBe(true)
  })

  it('moves focus onto the question it turns to', async () => {
    respondWith(three())
    renderForm()

    await screen.findByText('Pregunta uno')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await screen.findByText('Pregunta dos')
    // A page turn removes the fieldset focus was in; left alone, focus falls to <body>
    // and a keyboard respondent starts every page from the top of the document.
    expect(document.activeElement?.id).toBe('question-q2')
  })

  it('sends one complete response carrying every page’s answer, and only from the last page', async () => {
    respondWith(
      view({
        questions: [question({ id: 'q1', text: 'Pregunta uno' }), question({ id: 'q2', text: 'Pregunta dos', order: 1 })],
      }),
    )
    renderForm()

    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'En desacuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))

    await screen.findByText('Qué pasa ahora')
    const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(posts).toHaveLength(1)
    const body = lastSubmission()
    expect(body.isComplete).toBe(true)
    expect(body.answers).toEqual([
      { questionId: 'q1', value: 'strongly_agree' },
      { questionId: 'q2', value: 'disagree' },
    ])
  })

  /**
   * The TIMS dry run: 9 of 9 respondents lost the last question. "Siguiente" on the
   * second-to-last page and the submit on the last were ONE reused `<button>` whose
   * `type` React flipped to "submit" inside the click, and a real browser runs the
   * click's default action against the type it finds afterwards — so the click that
   * turned to the last page also sent the form. happy-dom does not run that default
   * action, so the guard is on the cause: the submit must be a different element from
   * the button that was clicked.
   */
  it('turns to the last page with a button that is not the submit it is replaced by', async () => {
    respondWith(
      view({
        questions: [question({ id: 'q1', text: 'Pregunta uno' }), question({ id: 'q2', text: 'Pregunta dos', order: 1 })],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta uno')
    const next = screen.getByRole('button', { name: 'Siguiente' })
    await userEvent.click(next)

    const submit = await screen.findByRole('button', { name: 'Enviar mis respuestas' })
    expect(submit).not.toBe(next)
    expect(next.isConnected).toBe(false)
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toHaveLength(0)
  })

  /**
   * Anything that submits the `<form>` from an early page — Enter on a control, a browser's
   * implicit submission — reaches `handleSubmit`. Before the last page that has to mean
   * "next": a respondent on question 1 has not asked to send. Fired as a raw `submit` so
   * the guard is tested whatever the control that triggered it.
   */
  it('reads a submit from an early page as Siguiente, never as send', async () => {
    respondWith(
      view({
        questions: [question({ id: 'q1', text: 'Pregunta uno' }), question({ id: 'q2', text: 'Pregunta dos', order: 1 })],
      }),
    )
    renderForm()

    await screen.findByText('Pregunta uno')
    fireEvent.submit(document.querySelector('form')!)

    expect(await screen.findByText('Pregunta dos')).toBeTruthy()
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toHaveLength(0)
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

  /**
   * The canvas sets the question at 17px with line-height 1.4 and its scale points at 17px
   * (RespondSurveyPhone.dc.html). The type scale had no 17px step, so both were drawn at
   * 16px; `text-question` is that step (`tokens.css`, pinned in `tokens.test.ts`).
   */
  it('sets the question and its scale points at the canvas’s 17px step', async () => {
    respondWith(view({ questions: [scaleQuestion()] }))
    const { container } = renderForm()

    const group = await screen.findByRole('radiogroup')
    const text = container.querySelector('[data-slot="question-text"]') as HTMLElement
    expect(text.className.split(/\s+/)).toContain('text-question')
    expect(text.className.split(/\s+/)).not.toContain('text-xl')
    // The step carries the canvas's 1.4; a `leading-*` beside it would override it.
    expect(text.className).not.toMatch(/\bleading-/)
    for (const point of within(group).getAllByRole('radio')) {
      expect(point.className.split(/\s+/)).toContain('text-question')
    }
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

    // One question per page: the authored options first, as native radios...
    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(2)
    expect(container.querySelector('[data-slot="segmented-scale"]')).toBeNull()

    // ...and the bare scale on the next page, as the segmented control and nothing else.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('radiogroup')).toBeTruthy()
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
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
   * The canvas's order under the promise: the survey's name with where the respondent is
   * and a 6px bar, the one question card, then the pair — Anterior and the way on — with
   * "Guardar y terminar después" under it. Nothing pinned to the viewport: every page is
   * one question, so the pair is always right under the card it acts on.
   */
  it('heads the question with the position and the bar, and puts the pair and the save under the card', async () => {
    respondWith(
      view({
        showProgress: true,
        allowPartialResponses: true,
        questions: [question(), question({ id: 'q2' }), question({ id: 'q3' })],
      }),
    )
    const { container } = renderForm()

    await screen.findByRole('button', { name: 'Siguiente' })
    const head = container.querySelector('[data-slot="respond-progress"]') as HTMLElement
    expect(within(head).getByRole('heading', { level: 1, name: 'Clima laboral 2026' })).toBeTruthy()
    expect(within(head).getByText('1 de 3')).toBeTruthy()
    expect(within(head).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33')

    const card = container.querySelector('fieldset[id^="question-"]') as HTMLElement
    const nav = container.querySelector('[data-slot="respond-nav"]') as HTMLElement
    const save = container.querySelector('[data-slot="respond-save"]') as HTMLElement
    expect(within(nav).getByRole('button', { name: 'Anterior' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Siguiente' })).toBeTruthy()
    expect(within(save).getByRole('button', { name: 'Guardar y terminar después' })).toBeTruthy()
    // In that order down the page. Read off `querySelectorAll`, which returns document
    // order — happy-dom's `compareDocumentPosition` answered 0 for the header against the
    // card inside the form, which is a question about happy-dom, not about this page.
    const order = [
      ...container.querySelectorAll('[data-slot="respond-progress"], fieldset[id^="question-"], [data-slot="respond-nav"], [data-slot="respond-save"]'),
    ]
    expect(order).toEqual([head, card, nav, save])
    // And nothing asks to be stuck to the viewport any more.
    expect(
      [...container.querySelectorAll('[class]')].filter((node) => /(^|\s)(\w+:)?sticky(\s|$)/.test(node.getAttribute('class') ?? '')),
    ).toEqual([])
  })

  /**
   * The canvas reads the POSITION ("2 de 6", the bar at a third), not an answered count:
   * one question per page makes where you are the thing worth watching.
   */
  it('moves the position and the bar as the respondent turns the page, not as they answer', async () => {
    respondWith(view({ showProgress: true, questions: [question(), question({ id: 'q2' })] }))
    renderForm()

    const position = () => document.querySelector('[data-slot="respond-position"]')?.textContent
    const valueNow = () => screen.getByRole('progressbar').getAttribute('aria-valuenow')
    await screen.findByRole('progressbar')
    expect([position(), valueNow()]).toEqual(['1 de 2', '50'])

    await userEvent.click(screen.getAllByRole('radio', { name: 'Muy de acuerdo' })[0])
    expect([position(), valueNow()]).toEqual(['1 de 2', '50'])

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect([position(), valueNow()]).toEqual(['2 de 2', '100'])

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect([position(), valueNow()]).toEqual(['1 de 2', '50'])
  })

  /**
   * The canvas inks the promise's label green (`#0f7f4e`), and that ink measures 4.31:1 on
   * the soft green over the respond page's ground — under AA for 10px text
   * (`respondContrast.test.ts` records it as rejected). The label keeps the green on the
   * chip's measured green ink instead.
   */
  it('inks the promise’s label with the measured green, not the canvas’s own', async () => {
    respondWith(view({ anonymous: true }))
    const { container } = renderForm()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    const label = container.querySelector('[data-slot="anonymity-label"]') as HTMLElement
    expect(label.className.split(/\s+/)).toContain('text-chip-good-ink')
    expect(label.className.split(/\s+/)).not.toContain('text-accent-green-ink')
  })

  /**
   * The rail's readings were relocated, not deleted. Losing the closing date is the
   * failure mode of "remove the right column" done carelessly, and it is the one
   * fact a respondent deciding whether to finish later actually needs.
   */
  it('keeps the closing date and the time limit at the foot of the page', async () => {
    respondWith(view({ timeLimitMinutes: 10 }))
    const { container } = renderForm()

    await screen.findByRole('radio', { name: 'Muy de acuerdo' })
    const foot = container.querySelector('[data-slot="respond-footer"]') as HTMLElement
    expect(within(foot).getByText('Cierra el 12 de septiembre')).toBeTruthy()
    const left = foot.querySelector('[data-slot="respond-time-left"]') as HTMLElement
    expect(left.textContent).toBe('Queda 10:00')
    expect(left.className).toContain('font-mono')
    expect(left.className).toContain('tabular-nums')
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
      const { container } = renderForm()
      await screen.findByRole('radio', { name: 'Muy de acuerdo' })

      const foot = container.querySelector('[data-slot="respond-footer"]') as HTMLElement
      expect(within(foot).getByText('Cierra el 5 de agosto')).toBeTruthy()
      expect(within(foot).queryByText('Cierra el 6 de agosto')).toBeNull()
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
    await submitOnce({ answeredQuestionCount: 3, questionCount: 3 })

    const receipt = document.querySelector('[data-slot="respond-receipt"]') as HTMLElement
    expect(within(receipt).getByText('Respuestas registradas')).toBeTruthy()
    // The server's own count as a reading, beside what it is out of.
    const reading = receipt.querySelector('.font-mono.tabular-nums')
    expect(reading?.textContent).toBe('3 de 3')
    expect(
      within(receipt).getByText(/^Enviadas a las \d{1,2}:\d{2}\. Se guardaron sin nada que lo identifique\.$/),
    ).toBeTruthy()
  })

  /**
   * "Se guardaron sin nada que lo identifique" describes how THIS response was stored, so
   * it is said only when the server says the response is anonymous. On a survey that
   * records who answered, the time is the whole of what is true.
   */
  it('says only when it was sent, on a survey that records who answered', async () => {
    respondWith(view({ anonymous: false, questions: [question()] }), { answeredQuestionCount: 1 })
    renderForm()
    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))
    await screen.findByText('Qué pasa ahora')

    const receipt = document.querySelector('[data-slot="respond-receipt"]') as HTMLElement
    expect(within(receipt).getByText(/^Enviadas a las \d{1,2}:\d{2}\.$/)).toBeTruthy()
    expect(receipt.textContent).not.toMatch(/sin nada que lo identifique/)
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

  /**
   * The TIMS dry run: every respondent read "edad, tiempo_de_laborar_en_tims_anos". The
   * labels the API now sends beside the keys are what is printed; the keys are only the
   * fallback for an API that does not send them yet.
   */
  it('names a suppressed demographic by its label, never its key, when the API sends one', async () => {
    await submitOnce({
      suppressedDemographics: ['edad', 'tiempo_de_laborar_en_tims_anos'],
      suppressedDemographicLabels: ['Edad', 'Tiempo de laborar en TIMS (años)'],
    })
    expect(screen.getByText(/deliberadamente: Edad, Tiempo de laborar en TIMS \(años\)/)).toBeTruthy()
    expect(screen.queryByText(/tiempo_de_laborar_en_tims_anos/)).toBeNull()
  })
})

/**
 * The browser-local answered flag (`respondReceipt.ts`), and why the form is where it is
 * written and first acted on.
 *
 * An anonymous survey can be answered repeatedly by construction — the ladder stops at
 * `opened`, the server's idempotency key is the session id, and this form **deletes** that
 * session id on completion so a shared browser cannot read the answers back. The flag is
 * what is left to stop the accident, and the emailed link lands here rather than on either
 * list, so this is the surface that has to act on it.
 */
describe('SurveyRespondForm answered-on-this-device flag', () => {
  async function completeOne() {
    respondWith(view({ questions: [question()] }), { answeredQuestionCount: 1 })
    renderForm()
    await userEvent.click(await screen.findByRole('radio', { name: 'Muy de acuerdo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mis respuestas' }))
    await screen.findByText('Qué pasa ahora')
  }

  /**
   * Both halves of completion, asserted together because the product depends on their
   * difference: the resume credential dies so the next person at a shared browser cannot
   * read these answers back, and the flag survives so the survey stops being offered.
   */
  it('records the flag on completion and still drops the resume credential', async () => {
    expect(hasAnswered('s1')).toBe(false)

    await completeOne()

    expect(hasAnswered('s1')).toBe(true)
    expect(readSessionId('s1')).toBeNull()
  })

  /** The respondent's own confirmation wins over the flag their submission just wrote. */
  it('shows the confirmation, not the flag, to the respondent who just answered', async () => {
    await completeOne()

    expect(screen.getByText(copy.es('surveyRespond.thankYouTitle'))).toBeTruthy()
    expect(screen.queryByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))).toBeNull()
  })

  it('offers the flag instead of the form when this browser already answered', async () => {
    markAnswered('s1')
    respondWith(view({ questions: [question()] }))
    renderForm()

    expect(await screen.findByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))).toBeTruthy()
    // The form itself is not rendered: the question is not on the page to be answered.
    expect(screen.queryByRole('radio', { name: 'Muy de acuerdo' })).toBeNull()
  })

  /**
   * The wording is its own, not `alreadyCompleted`'s. That one says "answering again would
   * not replace them", which is true when the SERVER matched a complete response — it
   * returns the same response id and writes nothing. Said here it would be false
   * reassurance twice over: the platform cannot confirm the answers arrived, and answering
   * again stores a second response.
   */
  it('does not claim the answers were received, or that answering again is harmless', async () => {
    markAnswered('s1')
    respondWith(view({ questions: [question()] }))
    renderForm()
    await screen.findByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))

    expect(screen.queryByText(copy.es('surveyRespond.alreadyCompletedBody'))).toBeNull()
    expect(screen.getByText(copy.es('surveyRespond.answeredOnThisDeviceBody'))).toBeTruthy()
  })

  /**
   * There is no way past it, and that is the ruling. A "that was not me, answer again"
   * control was offered here and removed: on a survey, somebody who has answered is done, and
   * a visible way to answer twice is an invitation to. Asserted as the ABSENCE of any control
   * on the screen, not as the absence of one label, so re-adding it under a different name
   * still fails.
   */
  it('offers no way to answer again', async () => {
    markAnswered('s1')
    respondWith(view({ questions: [question()] }))
    renderForm()
    await screen.findByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))

    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.queryByRole('radio', { name: 'Muy de acuerdo' })).toBeNull()
  })

  /**
   * The server's own verdict outranks the flag, and says a different thing: `inProgress`
   * being complete is the platform stating it holds the response, which it can only do on
   * a survey that records who answered.
   */
  it('prefers the server’s already-answered verdict over the flag', async () => {
    markAnswered('s1')
    respondWith(
      view({
        questions: [question()],
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: true,
          language: 'es',
          startTime: '2026-09-11T03:00:00Z',
          completionTime: '2026-09-11T03:20:00Z',
          answers: [],
        },
      }),
    )
    renderForm()

    expect(await screen.findByText(copy.es('surveyRespond.alreadyCompletedTitle'))).toBeTruthy()
    expect(screen.queryByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))).toBeNull()
  })
})

/**
 * One open assessment at a time.
 *
 * The lock's own arithmetic — who may claim, when a lock goes stale, who may release —
 * is proved in `respondLock.test.ts` against two tab ids. What is proved here is the
 * only thing that file cannot see: that this screen honours it, that a blocked tab
 * asks the server for nothing, and that leaving the screen frees the survey.
 *
 * The other tab is written straight into storage rather than rendered: two React trees
 * in one happy-dom share one `localStorage` and one `TAB_ID`, so a second `render` is
 * not a second tab and would claim the lock it was supposed to be refused.
 */
describe('SurveyRespondForm — one open assessment at a time', () => {
  const OTHER_TAB = 'another-tab'

  function otherTabHolds(at: number) {
    window.localStorage.setItem('surveyOpen:s1', JSON.stringify({ tab: OTHER_TAB, at }))
  }

  it('tells a second tab the survey is open elsewhere, and asks the server for nothing', async () => {
    otherTabHolds(Date.now())
    respondWith(view())
    renderForm()

    expect(
      await screen.findByText(copy.es('surveyRespond.openInAnotherTabTitle')),
    ).toBeTruthy()
    // The respond GET returns the in-progress answers, free text included. A tab that
    // must not write to the response has no business reading it back either.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    // No question, no way to answer: the block is the whole screen, not a banner over
    // a form that still works.
    expect(screen.queryByText('¿Qué tan satisfecho estás?')).toBeNull()
  })

  it('lets the survey be answered when the other tab went quiet past the stale window', async () => {
    otherTabHolds(Date.now() - STALE_MS - 1)
    respondWith(view())
    renderForm()

    expect(await screen.findByText('¿Qué tan satisfecho estás?')).toBeTruthy()
    expect(screen.queryByText(copy.es('surveyRespond.openInAnotherTabTitle'))).toBeNull()
  })

  /**
   * The steal path, which is the one the heartbeat creates and the only way a tab can
   * lose a lock it was using: this tab goes quiet past the stale window (backgrounded,
   * where timers are throttled to about one a minute), another tab takes the survey
   * and answers it, and this one comes back.
   *
   * What must NOT happen is this tab picking up where it left off. Its answer map is a
   * snapshot from before the other tab wrote, and the next autosave would put it
   * straight over that work — the overwrite the lock exists to prevent, arriving by the
   * one door the lock itself opens.
   *
   * Asserted on the ANSWER the respondent sees, not on a second GET going out. The
   * second GET happens either way, because the effect re-runs whenever the lock
   * changes; it is whether that read is allowed to REPLACE the map that is in
   * question, and a call count cannot tell the two apart.
   */
  it('shows the other tab\u2019s answer, not its own, after losing and regaining the lock', async () => {
    respondWith(view())
    renderForm()
    await screen.findByText('\u00bfQu\u00e9 tan satisfecho est\u00e1s?')

    await userEvent.click(screen.getByRole('radio', { name: 'Muy de acuerdo' }))
    expect((screen.getByRole('radio', { name: 'Muy de acuerdo' }) as HTMLInputElement).checked).toBe(true)

    // Another tab takes it while this one is quiet, and the screen gives way.
    otherTabHolds(Date.now())
    fireEvent(document, new Event('visibilitychange'))
    await screen.findByText(copy.es('surveyRespond.openInAnotherTabTitle'))

    // That tab answers differently and closes, handing the survey back.
    respondWith(
      view({
        inProgress: {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: false,
          language: 'es',
          startTime: '2026-10-06T08:05:00Z',
          completionTime: null,
          answers: [
            { questionId: 'q1', value: 'disagree', values: null, text: null, timeSpentSeconds: 9 },
          ],
        },
      }),
    )
    window.localStorage.removeItem('surveyOpen:s1')
    fireEvent(document, new Event('visibilitychange'))

    await screen.findByText('\u00bfQu\u00e9 tan satisfecho est\u00e1s?')
    // The server's copy won, which is the whole point: this tab's map predates the
    // other tab's work and must not survive the hand-back.
    expect((await screen.findByRole('radio', { name: 'En desacuerdo' })) as HTMLInputElement).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'En desacuerdo' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Muy de acuerdo' }) as HTMLInputElement).checked).toBe(false)
  })

  it('frees the survey when the screen goes away, so the next tab is not shut out', async () => {
    respondWith(view())
    const { unmount } = renderForm()
    await screen.findByText('¿Qué tan satisfecho estás?')

    // Held while it is on screen...
    expect(heldElsewhere('s1', OTHER_TAB)).toBe(true)

    unmount()

    // ...and handed straight back, rather than left for the stale window to clear.
    expect(heldElsewhere('s1', OTHER_TAB)).toBe(false)
  })
})

/**
 * The promise is collapsed from the second question, never shortened.
 *
 * Measured on the TIMS instrument at 390×844 — 40 likert statements, Spanish — the open
 * block is ~148px of the fold and the page comes to 938px, which puts "Siguiente" below
 * it on every question. The fix spends the vertical room and nothing else: the same
 * `anonymousBody` characters stay in the document on every page, one tap away.
 *
 * The two assertions that matter are therefore the shape AND the words. A collapse that
 * also trimmed the copy would be the second, shorter claim `AnonymityNotice`'s own rule
 * forbids, and a test that only asserted "it is a details element" would pass for it.
 */
describe('SurveyRespondForm — the anonymity promise under one question at a time', () => {
  function notice(): HTMLElement {
    const node = document.querySelector<HTMLElement>('[data-slot="anonymity-notice"]')
    expect(node, 'the promise is on every page').toBeTruthy()
    return node!
  }

  it('states it in full and open on the first question', async () => {
    respondWith(view({ questions: [question(), question({ id: 'q2' })] }))
    renderForm()
    await screen.findByText('¿Qué tan satisfecho estás?')

    expect(notice().tagName).toBe('SECTION')
    expect(screen.getByText(copy.es('surveyRespond.anonymousBody'))).toBeTruthy()
  })

  it('collapses it from the second question, with the words character for character', async () => {
    respondWith(view({ questions: [question(), question({ id: 'q2' })] }))
    renderForm()
    await screen.findByText('¿Qué tan satisfecho estás?')
    const openWords = screen.getByText(copy.es('surveyRespond.anonymousBody')).textContent

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    const collapsed = notice()
    expect(collapsed.tagName).toBe('DETAILS')
    expect(collapsed.hasAttribute('open')).toBe(false)
    // Still in the document — find-in-page, a screen reader walking it, and one tap
    // for everybody else — and still the same sentence it was on page one.
    expect(screen.getByText(copy.es('surveyRespond.anonymousBody')).textContent).toBe(openWords)
    // And the state word is still readable while it is shut, because that is the part
    // that has to survive the collapse.
    expect(collapsed.querySelector('[data-slot="anonymity-label"]')?.textContent).toBe(
      copy.es('surveyRespond.anonymousChip'),
    )
  })
})

/**
 * Self-declared demographics: the prelude a respondent with NO account answers before
 * question 1 (Igoal — operarios with no email, so no invitation can reach them).
 *
 * The fixture's `demographics` is what the server sends only for an unauthenticated
 * visitor to an anonymous survey whose author turned the setting on. Every other
 * respondent gets `[]`, which is why the rest of this file never sees this stage.
 */
describe('SurveyRespondForm — the demographic prelude', () => {
  function area(overrides: Partial<SurveyRespondDemographicField> = {}): SurveyRespondDemographicField {
    return {
      field: 'area',
      label: '¿En qué área trabaja?',
      options: [
        { value: 'operaciones', label: 'Operaciones' },
        { value: 'ventas', label: 'Ventas' },
      ],
      required: true,
      order: 0,
      ...overrides,
    }
  }

  const sexo = area({
    field: 'sexo',
    label: 'Sexo',
    options: [
      { value: 'hombre', label: 'Hombre' },
      { value: 'mujer', label: 'Mujer' },
    ],
    required: false,
    order: 1,
  })

  it('asks the demographics BEFORE the first question', async () => {
    respondWith(view({ demographics: [area()] }))
    renderForm({ publicEntry: true })

    // The field, not the question: the prelude stands in front of the whole question
    // flow, so page 0 of the survey has not been reached yet.
    await screen.findByText('¿En qué área trabaja?')
    expect(screen.queryByText('¿Qué tan satisfecho estás?')).toBeNull()
  })

  it('states the promise OPEN while it is asking, because this is the consent moment', async () => {
    respondWith(view({ demographics: [area()] }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')

    // A SECTION, not a collapsed DETAILS. The respondent is about to disclose their
    // area; the promise about what happens to it has to be legible as they do, not one
    // tap behind a disclosure.
    expect(document.querySelector('[data-slot="anonymity-notice"]')?.tagName).toBe('SECTION')
    expect(screen.getByText(copy.es('surveyRespond.anonymousBody'))).toBeTruthy()
  })

  it('refuses to move on from a REQUIRED field nobody answered', async () => {
    respondWith(view({ demographics: [area()] }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')

    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.demographics.start') }))

    expect(screen.getByText(copy.es('surveyRespond.demographics.missing'))).toBeTruthy()
    // Still on the field, not dropped into the survey.
    expect(screen.queryByText('¿Qué tan satisfecho estás?')).toBeNull()
  })

  it('offers "prefiero no decir" on an OPTIONAL field and not on a required one', async () => {
    respondWith(view({ demographics: [area(), sexo] }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')

    // Whether a field may be declined is the admin's call, taken on the field.
    expect(screen.queryByLabelText(copy.es('surveyRespond.demographics.preferNotToSay'))).toBeNull()

    await userEvent.click(screen.getByLabelText('Operaciones'))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    await screen.findByText('Sexo')
    expect(screen.getByLabelText(copy.es('surveyRespond.demographics.preferNotToSay'))).toBeTruthy()
  })

  it('sends what was declared on the COMPLETING post, keyed by field and valued by option', async () => {
    respondWith(view({ demographics: [area(), sexo] }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')

    await userEvent.click(screen.getByLabelText('Operaciones'))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await screen.findByText('Sexo')
    await userEvent.click(screen.getByLabelText('Mujer'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.demographics.start') }))

    await screen.findByText('¿Qué tan satisfecho estás?')
    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.submitResponse') }))

    await screen.findByText(copy.es('surveyRespond.thankYouTitle'))
    // The stable option VALUES, never the labels the respondent read (#195): submitting
    // "Operaciones" would make the same answer two unrelated groups across languages.
    expect(lastSubmission().demographics).toEqual({ area: 'operaciones', sexo: 'mujer' })
  })

  it('records a DECLINED optional field as an empty value rather than omitting it', async () => {
    respondWith(view({ demographics: [area(), sexo] }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')

    await userEvent.click(screen.getByLabelText('Operaciones'))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await screen.findByText('Sexo')
    await userEvent.click(screen.getByLabelText(copy.es('surveyRespond.demographics.preferNotToSay')))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.demographics.start') }))

    await screen.findByText('¿Qué tan satisfecho estás?')
    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.submitResponse') }))

    await screen.findByText(copy.es('surveyRespond.thankYouTitle'))
    // An empty string is a deliberate declination, which the server treats as clearing
    // the answer so no row is written. Omitting the key entirely would be the shape of
    // a screen the respondent never reached.
    expect(lastSubmission().demographics).toEqual({ area: 'operaciones', sexo: '' })
  })

  it('never puts a demographic on a PARTIAL save', async () => {
    respondWith(view({ demographics: [area()], allowPartialResponses: true }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')

    await userEvent.click(screen.getByLabelText('Operaciones'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.demographics.start') }))
    await screen.findByText('¿Qué tan satisfecho estás?')
    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.saveAndFinishLater') }))

    // The guarantee the autosave's own comment makes — "Nothing here is a new field, a
    // new identifier or a demographic" — extended to the manual save. A respondent who
    // abandons halfway leaves no demographic trail anywhere.
    const partial = lastSubmission()
    expect(partial.isComplete).toBe(false)
    expect(partial.demographics).toBeUndefined()
  })

  it('renders radios up to the ceiling and a dropdown above it', async () => {
    const option = (n: number) => ({ value: `a${n}`, label: `Area ${n}` })

    respondWith(view({
      demographics: [area({ options: Array.from({ length: RADIO_CEILING }, (_, i) => option(i)) })],
    }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')
    expect(screen.getAllByRole('radio')).toHaveLength(RADIO_CEILING)
    expect(document.querySelector('select')).toBeNull()

    cleanup()

    // One more than the ceiling: ten areas is the shape Federico asked about, and a
    // radio list that long puts the way-on button under the fold on a phone.
    respondWith(view({
      demographics: [area({ options: Array.from({ length: RADIO_CEILING + 1 }, (_, i) => option(i)) })],
    }))
    renderForm({ publicEntry: true })
    await screen.findByText('¿En qué área trabaja?')
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(document.querySelector('select')).toBeTruthy()
  })

  /**
   * The deploy window. The web auto-deploys on merge; the API needs a MANUAL
   * `deploy-prod` dispatch, and is routinely behind — measured 2026-10-07, prod API on
   * `af20a73e` while main was on `c8d5cbcc`. So between those two deploys the NEW form
   * runs against an API whose respond payload has no `demographics` key at all.
   */
  it('survives a respond payload from an API that predates demographics', async () => {
    const old = view()
    delete (old as Partial<SurveyRespondView>).demographics
    respondWith(old)
    renderForm({ publicEntry: true })

    // The survey must still be answerable. A crash here is a white screen on the one
    // page in this product whose failure cannot be re-collected.
    await screen.findByText('¿Qué tan satisfecho estás?')
    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.submitResponse') }))

    await screen.findByText(copy.es('surveyRespond.thankYouTitle'))
    expect(lastSubmission().demographics).toBeUndefined()
  })

  it('does not ask a respondent the server sent no demographics for', async () => {
    // The authenticated case, and every survey whose author left the setting off: their
    // demographics come from their profile through the write-time cohort floor.
    respondWith(view({ demographics: [] }))
    renderForm()

    await screen.findByText('¿Qué tan satisfecho estás?')
    expect(screen.queryByText(copy.es('surveyRespond.demographics.eyebrow'))).toBeNull()
  })
})

/**
 * The shared device: a plant kiosk, or one supervisor's phone passed down a line.
 *
 * `respondReceipt`'s flag is per survey and per browser, so without this the FIRST
 * person to answer through a public link locks out everyone behind them, silently and
 * with no way back short of clearing site data.
 */
describe('SurveyRespondForm — the answered flag on a shared device', () => {
  it('lets the next person step past it on the PUBLIC path', async () => {
    markAnswered('s1')
    respondWith(view())
    renderForm({ publicEntry: true })

    await screen.findByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.sharedDeviceAnswer') }))

    // Through to the survey, and the flag is still in storage: the person who actually
    // answered is not re-asked next time they open the link on their own device.
    await screen.findByText('¿Qué tan satisfecho estás?')
    expect(hasAnswered('s1')).toBe(true)
  })

  it('offers no such escape on the invitation path', async () => {
    // `respondReceipt`'s ruling stands where the survey went to one named person: a
    // visible control for answering twice is an invitation to.
    markAnswered('s1')
    respondWith(view())
    renderForm()

    await screen.findByText(copy.es('surveyRespond.answeredOnThisDeviceTitle'))
    expect(screen.queryByRole('button', { name: copy.es('surveyRespond.sharedDeviceAnswer') })).toBeNull()
  })
})
