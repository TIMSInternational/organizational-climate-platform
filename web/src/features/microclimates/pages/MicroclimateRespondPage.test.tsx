import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
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

  it('counts answers as a mono reading, and says the same thing in words', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(spanishMicroclimate()), { status: 200 }),
    )
    renderPage()

    const reading = await screen.findByText('0 / 1')
    expect(reading.className).toContain('font-mono')
    expect(reading.className).toContain('tabular-nums')
    expect(reading.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('0 de 1 preguntas respondidas')).toBeTruthy()

    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    expect(screen.getByText('1 / 1')).toBeTruthy()
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
    // The mono index reading, with the sentence beside it for a screen reader.
    expect(legend.textContent).toContain('Pregunta 1 de 1')
    const marker = screen.getByText('1/1')
    expect(marker.className).toContain('font-mono')
    expect(marker.getAttribute('aria-hidden')).toBe('true')
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
