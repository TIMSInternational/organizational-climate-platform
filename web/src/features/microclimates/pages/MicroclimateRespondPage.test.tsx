import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateRespondPage from './MicroclimateRespondPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import type { PublicMicroclimateDetail } from '../api/microclimates'

// The whole point of the stable-value option shape (#195): a respondent sees a label
// in their own language but the submitted answer is locale-independent, so the same
// choice made in Spanish and in English is ONE value in the database rather than two
// strings that reconcile by row count and disagree by meaning.
function spanishMicroclimate(): PublicMicroclimateDetail {
  return {
    id: 'm1',
    title: 'Pulso semanal',
    status: 'active',
    language: 'both',
    resolvedLocale: 'es',
    fallbackFields: [],
    questions: [
      {
        id: 'q1',
        text: '¿Qué tan satisfecho estás?',
        type: 'multiple_choice',
        required: true,
        order: 0,
        options: [
          { order: 0, value: 'strongly_agree', label: 'Muy de acuerdo' },
          { order: 1, value: 'disagree', label: 'En desacuerdo' },
        ],
      },
    ],
  }
}

/**
 * The shape the design's 'pulse' screen is drawn for: one 1–5 question with no
 * option set of its own, which is what `isNumericScale` calls a numeric scale and
 * what `MicroclimateEndpoints.cs` validates as `rating is >= 1 and <= 5`.
 */
function pulseMicroclimate(): PublicMicroclimateDetail {
  return {
    id: 'm1',
    title: 'Pulso semanal',
    status: 'active',
    language: 'both',
    resolvedLocale: 'es',
    fallbackFields: [],
    questions: [
      {
        id: 'q1',
        text: '¿Qué tan apoyado se sintió esta semana?',
        type: 'likert',
        required: true,
        order: 0,
        options: null,
      },
    ],
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/m1/respond']}>
        <Routes>
          <Route path="/microclimates/:id/respond" element={<MicroclimateRespondPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('MicroclimateRespondPage option values', () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers and
    // rendered trees would otherwise stack up across cases in this file.
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('requests the microclimate in the respondent\'s own locale', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }))

    renderPage()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/microclimates/m1?lang=es'), expect.anything())
    })
  })

  it('renders the localized label but submits the stable value', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))

    renderPage()

    const option = await screen.findByLabelText('Muy de acuerdo')
    await userEvent.click(option)
    await userEvent.click(screen.getByRole('button', { name: /enviar|submit/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const submitCall = vi.mocked(fetch).mock.calls[1]
    const body = JSON.parse(String((submitCall[1] as RequestInit).body)) as {
      answers: Record<string, string>
      language: string
    }

    // Not "Muy de acuerdo" -- the label is display only.
    expect(body.answers.q1).toBe('strongly_agree')
    // And the locale the respondent was actually served is recorded, so the word
    // cloud can bucket their open text by language instead of mixing it in.
    expect(body.language).toBe('es')
  })

  it('falls back to the option value when a label is missing in every language', async () => {
    const detail = spanishMicroclimate()
    detail.questions[0].options![1].label = null
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))

    renderPage()

    // Never blank and never a key path -- #78 fixed exactly that failure for UI
    // strings and it must not come back at content level.
    expect(await screen.findByLabelText('disagree')).toBeDefined()
  })
})

/**
 * The redesign. This page used to be an unstyled `<h1>`, a stack of bare
 * `<fieldset>`s and a naked `<button>` — no layout at all on the only screen an
 * ordinary employee ever sees.
 */
describe('MicroclimateRespondPage as a respondent surface', () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  /**
   * The same standalone frame as the two survey respond routes, and none of the
   * administrator's shell: this route is open to anyone holding a link, and a
   * role-aware rail is a way for a company's structure to appear on it.
   */
  it('renders the standalone respond shell and none of the admin one', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }),
    )
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'Pulso semanal' })
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()

    const skip = screen.getByRole('link', { name: 'Ir a las preguntas' })
    expect(container.firstElementChild?.firstElementChild).toBe(skip)
    expect(container.querySelector('#questions')).toBeTruthy()
  })

  /**
   * `PublicMicroclimateDetail` carries no `anonymousResponses` flag, so this page
   * cannot report the session's configuration and does not claim to. What it states
   * is what `submitResponse` verifiably does: post with `Content-Type` alone and no
   * bearer token.
   */
  it('states what leaves the page with the answers, and attaches no token', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    renderPage()

    expect(
      await screen.findByText('Su nombre no se envía con sus respuestas'),
    ).toBeTruthy()
    // The word beside the colour, so green is never the only thing saying it.
    expect(screen.getByText('No se asocia a usted')).toBeTruthy()

    await userEvent.click(await screen.findByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: /enviar|submit/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const headers = new Headers(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).headers as HeadersInit,
    )
    expect(headers.get('Authorization')).toBeNull()
  })

  /**
   * The rail is gone, and this is what replaced the case that used to measure its
   * answered-count tile.
   *
   * The tile and the anonymity promise sat in a `lg:grid-cols-3` right-hand panel
   * that the design never drew — it survived the employee redesign only because
   * `components/layout/respondSticky.test.tsx` asserted a sticky panel on this
   * route. The drawing is one column: eyebrow, question, scale, optional box, a
   * single Send, and the anonymity line as the footnote under it. The two survey
   * routes moved their instrument to a bottom bar; the pulse has no bar either.
   */
  it('draws one column with no rail beside it and no bar under it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }),
    )
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Pulso semanal' })

    const columns = container.querySelectorAll('[data-slot="pulse-column"]')
    expect(columns, 'the pulse is exactly one column').toHaveLength(1)
    const column = columns[0]

    // The rail was a labelled region ("Sobre esta sesión") in its own grid track,
    // and the survey routes' instrument is a `respond-submit-bar`. Neither is drawn
    // here, so neither may be present.
    expect(screen.queryByRole('region', { name: 'Sobre esta sesión' })).toBeNull()
    expect(container.querySelector('[data-slot="respond-submit-bar"]')).toBeNull()
    expect(
      [...container.querySelectorAll('[class]')].filter((element) =>
        /grid-cols-|sticky/.test(element.getAttribute('class') ?? ''),
      ),
      'no multi-column track and nothing pinned — the pulse is a plain reading order',
    ).toEqual([])

    // The answered count went with the rail. Position, when a session has more than
    // one question, is carried by the per-question numbering instead.
    expect(screen.queryByText('0 / 1')).toBeNull()
    expect(screen.queryByText('0 de 1 preguntas respondidas')).toBeNull()

    // The anonymity line is the FOOTNOTE the design draws: last in the column,
    // after the Send button rather than beside the questions.
    const note = screen.getByText('Su nombre no se envía con sus respuestas').closest('section')
    expect(note, 'the anonymity note is its own section').toBeTruthy()
    expect(column.lastElementChild, 'and it is the last thing in the column').toBe(note)
  })

  /**
   * The word carries whether an answer is required, never a colour (WCAG 1.4.1) —
   * the rule `surveys/RespondQuestionField.tsx` already keeps.
   */
  it('marks a required question in words, inside the legend that names the group', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }),
    )
    renderPage()

    const legend = await waitFor(() => {
      const found = document.querySelector('legend')
      expect(found).toBeTruthy()
      return found!
    })
    expect(legend.textContent).toContain('(obligatoria)')
  })

  /**
   * A session that asks TWO questions has positions worth keeping track of, so the
   * mono index reading and the sentence beside it both come back.
   */
  it('numbers the questions once there is more than one of them', async () => {
    const detail = spanishMicroclimate()
    detail.questions.push({ ...detail.questions[0], id: 'q2', text: '¿Y esta semana?', order: 1 })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    renderPage()

    const legend = await waitFor(() => {
      const found = document.querySelector('legend')
      expect(found).toBeTruthy()
      return found!
    })
    expect(legend.textContent).toContain('Pregunta 1 de 2')
    const marker = screen.getByText('1/2')
    expect(marker.className).toContain('font-mono')
    expect(marker.getAttribute('aria-hidden')).toBe('true')
  })

  /**
   * The design's pulse screen numbers nothing, and it is right not to: "1/1" and
   * "Question 1 of 1" are two ways of saying there is no position to keep track of,
   * on the one screen whose whole job is to ask a single thing and get out of the
   * way. The required marker stays — that is not decoration.
   */
  it('numbers nothing when the session asks a single question', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(pulseMicroclimate()), { status: 200 }),
    )
    renderPage()

    const legend = await waitFor(() => {
      const found = document.querySelector('legend')
      expect(found).toBeTruthy()
      return found!
    })
    expect(legend.textContent).toContain('(obligatoria)')
    expect(legend.textContent).not.toContain('Pregunta 1 de 1')
    expect(screen.queryByText('1/1')).toBeNull()
  })

  /**
   * The 1–5 scale is `ui/SegmentedScale`, not a row of native radios.
   *
   * A native radio is ~13px against the 24px WCAG 2.2 target minimum, on the screen
   * most often answered on a phone. Asserted through the rendered DOM rather than by
   * reading the source: `data-slot` is the primitive's own handle, and a segment is
   * a `<button role="radio">` where the control it replaces was an `<input>`.
   */
  it('answers an unlabelled 1–5 question on segments rather than on 13px radios', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(pulseMicroclimate()), { status: 200 }),
    )
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Pulso semanal' })

    const scale = container.querySelector('[data-slot="segmented-scale"]')
    expect(scale, 'the 1–5 scale is the SegmentedScale primitive').toBeTruthy()
    const points = within(scale as HTMLElement).getAllByRole('radio')
    expect(points.map((point) => point.textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(points.every((point) => point.tagName === 'BUTTON')).toBe(true)
    // The anchors under the ends of the row come from the catalogue, not from a
    // literal — nothing in the payload names the ends of an unlabelled scale.
    expect(within(scale as HTMLElement).getByText('Bajo')).toBeTruthy()
    expect(within(scale as HTMLElement).getByText('Alto')).toBeTruthy()
    // The page still has no native radio to fall back to.
    expect(container.querySelector('input[type="radio"]')).toBeNull()
  })

  it('submits the scale point as the integer the server validates, not as a label', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(pulseMicroclimate()), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: '4' }))
    await userEvent.click(screen.getByRole('button', { name: /enviar|submit/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const body = JSON.parse(
      String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body),
    ) as { answers: Record<string, string> }
    // `MicroclimateEndpoints.cs` accepts a numeric-scale answer only as an int 1–5
    // when the question configures no options of its own.
    expect(body.answers.q1).toBe('4')
  })

  /**
   * An authored option set is not a numeric scale — its values are words, and
   * `SegmentedScale` draws an integer run — so those questions keep the choice list
   * they had. This is the branch the server also validates differently.
   */
  it('keeps the choice list for a scale question that configures its own options', async () => {
    const detail = pulseMicroclimate()
    detail.questions[0].options = [
      { order: 0, value: 'never', label: 'Nunca' },
      { order: 1, value: 'always', label: 'Siempre' },
    ]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    const { container } = renderPage()

    expect(await screen.findByLabelText('Nunca')).toBeTruthy()
    expect(container.querySelector('[data-slot="segmented-scale"]')).toBeNull()
  })

  /**
   * "One question, large, centred, no scroll." The whole column — heading, form and
   * footnote — is capped at the prose measure and centred, not just the form inside
   * a wider grid. A pulse is answered in seconds and should not read like a
   * twelve-question climate survey.
   */
  it('draws the question in a centred column at the prose measure', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(pulseMicroclimate()), { status: 200 }),
    )
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Pulso semanal' })

    const column = container.querySelector('[data-slot="pulse-column"]')
    expect(column).toBeTruthy()
    expect(column!.className).toContain('max-w-measure')
    expect(column!.className).toContain('mx-auto')
    // And the form is inside it rather than beside it, so the cap applies to the
    // questions too.
    expect(container.querySelector('form')?.closest('[data-slot="pulse-column"]')).toBe(column)
  })

  /**
   * The design's box under the scale — "Anything you want to add?" — is a textarea.
   * This branch was a single-line `<input type="text">` with no accessible name at
   * all: a `<legend>` names the FIELDSET, never the control inside it.
   */
  it('answers an open question in a named textarea rather than a one-line input', async () => {
    const detail = pulseMicroclimate()
    detail.questions[0].type = 'open_ended'
    detail.questions[0].required = false
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Pulso semanal' })

    const box = container.querySelector('[data-slot="textarea"]')
    expect(box, 'free text is the Textarea primitive').toBeTruthy()
    expect(box!.tagName).toBe('TEXTAREA')
    expect(container.querySelector('input[type="text"]')).toBeNull()
    // Named by the question it answers, through the legend that holds it.
    const legend = container.querySelector('legend')
    expect(box!.getAttribute('aria-labelledby')).toBe(legend!.id)
    expect(legend!.id.length).toBeGreaterThan(0)
  })

  it('tells a respondent that a session is not taking answers, rather than showing a form', async () => {
    const detail = spanishMicroclimate()
    detail.status = 'completed'
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    renderPage()

    expect(await screen.findByText('Esta sesión no está recibiendo respuestas')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('reports a failed load as an alert rather than a bare line of text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Microclimate not found' }), { status: 404 }),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('No se pudo cargar esta sesión')
    expect(alert.textContent).toContain('Microclimate not found')
  })
})

/**
 * `emoji_rating` (#198).
 *
 * The type was refused on microclimates until the server had somewhere to store an
 * emoji set, and the reason the plain option rows were rejected as that storage is the
 * one thing these cases have to prove: **an emoji is not an accessible name.** So the
 * assertions are about the ACCESSIBLE NAME the browser computes for each radio, not
 * about the text rendered next to it — those coincide only if the glyph is correctly
 * hidden from assistive technology, which is exactly what could regress.
 */
describe('MicroclimateRespondPage emoji scale', () => {
  function emojiMicroclimate(): PublicMicroclimateDetail {
    return {
      id: 'm1',
      title: 'Pulso semanal',
      status: 'active',
      language: 'both',
      resolvedLocale: 'es',
      fallbackFields: [],
      questions: [
        {
          id: 'q1',
          text: '¿Cómo estuvo tu semana?',
          type: 'emoji_rating',
          required: true,
          order: 0,
          options: null,
          emojiOptions: [
            { order: 0, emoji: '\u{1F622}', value: 1, label: 'Triste' },
            { order: 1, emoji: '\u{1F610}', value: 2, label: 'Normal' },
            { order: 2, emoji: '\u{1F642}', value: 3, label: 'Bien' },
          ],
        },
      ],
    }
  }

  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('gives every face an accessible name that is the authored word, not the glyph', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(emojiMicroclimate()), { status: 200 }),
    )
    renderPage()

    const faces = await screen.findAllByRole('radio')
    expect(faces).toHaveLength(3)

    // `getByRole(..., { name })` matches the COMPUTED accessible name exactly, so this
    // fails both if the word is missing and if the glyph leaks into the name.
    for (const name of ['Triste', 'Normal', 'Bien']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy()
    }

    // The glyph itself is hidden, which is what makes the name above exactly the word.
    for (const glyph of ['\u{1F622}', '\u{1F610}', '\u{1F642}']) {
      expect(screen.getByText(glyph).getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('keeps the word visible as well as announced', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(emojiMicroclimate()), { status: 200 }),
    )
    renderPage()

    // `sr-only` would satisfy the assertion above and still leave a sighted respondent
    // guessing whether 🙂 means "fine" or "not bad". The word is on the screen.
    const word = await screen.findByText('Triste')
    expect(word.className).not.toContain('sr-only')
  })

  it('submits the stable value as a string, never the glyph or the word', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(emojiMicroclimate()), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    renderPage()

    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    await userEvent.click(screen.getByRole('button', { name: /enviar|submit/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const body = JSON.parse(
      String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body),
    ) as { answers: Record<string, string> }

    // '3' -- what MicroclimateEndpoints validates against the question's emoji values.
    expect(body.answers.q1).toBe('3')
  })

  it('says so rather than drawing an empty group when a question has no scale', async () => {
    const detail = emojiMicroclimate()
    detail.questions[0].emojiOptions = []
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }))
    renderPage()

    // There is no 1-5 fallback for this type: the server rejects every answer to a
    // scale-less emoji question, so a rendered control would be one whose every answer
    // is a 400.
    expect(
      await screen.findByText(
        'Esta pregunta no tiene opciones configuradas y no se puede responder.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
