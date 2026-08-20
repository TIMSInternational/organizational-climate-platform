import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyQuestionsEditPage from './SurveyQuestionsEditPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'

function payload(overrides: { language?: string; status?: string; fallbackFields?: string[] } = {}) {
  return {
    id: 's1',
    title: 'Clima laboral 2026',
    language: overrides.language ?? 'both',
    status: overrides.status ?? 'draft',
    fallbackFields: overrides.fallbackFields ?? [],
    questions: [
      {
        id: 'q1',
        text: '¿Cómo te sientes?',
        type: 'multiple_choice',
        options: [
          { order: 0, value: 'opt-key-0', label: 'Bien' },
          { order: 1, value: 'opt-key-1', label: 'Mal' },
        ],
        scaleMin: null,
        scaleMax: null,
        scaleLabelMin: null,
        scaleLabelMax: null,
        required: true,
        commentRequired: false,
        commentPrompt: null,
        order: 0,
        category: 'Bienestar',
      },
      {
        id: 'q2',
        text: '¿Recomendarías este lugar?',
        type: 'yes_no',
        options: [{ order: 0, value: 'yes-key', label: 'Sí' }],
        scaleMin: null,
        scaleMax: null,
        scaleLabelMin: null,
        scaleLabelMax: null,
        required: false,
        commentRequired: false,
        commentPrompt: null,
        order: 1,
        category: 'Lealtad',
      },
    ],
  }
}

function serve(options: { save?: () => Response } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (init?.method === 'PUT') {
      return Promise.resolve(options.save?.() ?? new Response('{}', { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(payload()), { status: 200 }))
  })
  return calls
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1/questions']}>
        <Routes>
          <Route path="/surveys/:id/questions" element={<SurveyQuestionsEditPage />} />
          <Route path="/surveys/:id" element={<p>survey detail</p>} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('SurveyQuestionsEditPage', () => {
  it('edits a label and sends the option key back untouched', async () => {
    const calls = serve()
    renderPage()

    const option = await screen.findByLabelText('Opción (Español) — opt-key-0')
    await userEvent.clear(option)
    await userEvent.type(option, 'Muy bien')

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.init?.method === 'PUT')!
    const body = JSON.parse(String(put.init!.body)) as {
      questions: { options: { value: string; label: Record<string, string> }[] }[]
    }

    // The whole point of #273: a renamed label must not repoint the aggregation key.
    expect(body.questions[0].options.map((o) => o.value)).toEqual(['opt-key-0', 'opt-key-1'])
    expect(body.questions[0].options[0].label.es).toBe('Muy bien')
    // And nothing but the questions was written.
    expect(Object.keys(body)).toEqual(['questions'])
  })

  it('returns to the survey once the edit is saved', async () => {
    serve()
    renderPage()

    await screen.findByLabelText('Opción (Español) — opt-key-0')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('survey detail')).toBeTruthy()
  })

  /**
   * The server refuses twice and explains itself better than any wording of ours. The
   * counter it checks first is only a fast path, so this refusal can arrive on a survey
   * whose payload said `responseCount: 0`.
   */
  it('shows the server reason verbatim when the save is refused', async () => {
    serve({
      save: () =>
        new Response(
          JSON.stringify({
            message: 'This survey already has responses; its content can no longer be edited.',
          }),
          { status: 409 },
        ),
    })
    renderPage()

    await screen.findByLabelText('Opción (Español) — opt-key-0')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(
      await screen.findByText(
        'This survey already has responses; its content can no longer be edited.',
      ),
    ).toBeTruthy()
    // Still on the editor, with the work intact.
    expect(screen.getByLabelText('Opción (Español) — opt-key-0')).toBeTruthy()
  })

  it('removes a question and renumbers what is left', async () => {
    const calls = serve()
    renderPage()

    await screen.findByLabelText('Opción (Español) — opt-key-0')
    await userEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.init?.method === 'PUT')!
    const sent = JSON.parse(String(put.init!.body)).questions as { order: number; category: string }[]

    // The survivor closes the gap rather than keeping its old index.
    expect(sent.map((q) => q.category)).toEqual(['Lealtad'])
    expect(sent.map((q) => q.order)).toEqual([0])
  })

  /**
   * `order` is stored and the respond form reads it, so moving a question has to renumber
   * the whole list rather than only change the array's sequence: a saved list carrying
   * `order: 1, 0` — or two questions both claiming 0 — is a real ordering bug in the
   * survey people answer, and the array position that looked right here would not save it.
   */
  it('renumbers order when a question is moved, not just its position', async () => {
    const calls = serve()
    renderPage()

    await screen.findByLabelText('Opción (Español) — opt-key-0')
    // The second question's "move up" — the first question's is disabled.
    const moveUps = screen.getAllByRole('button', { name: 'Subir' })
    await userEvent.click(moveUps[1])
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true))
    const put = calls.find((c) => c.init?.method === 'PUT')!
    const sent = JSON.parse(String(put.init!.body)).questions as {
      order: number
      category: string
    }[]

    expect(sent.map((q) => q.category)).toEqual(['Lealtad', 'Bienestar'])
    expect(sent.map((q) => q.order)).toEqual([0, 1])
  })

  it('reads the survey in both languages when it is written in both', async () => {
    const calls = serve()
    renderPage()

    await screen.findByLabelText('Opción (Español) — opt-key-0')
    const reads = calls.filter((c) => c.init?.method !== 'PUT')
    expect(reads).toHaveLength(2)
    expect(reads.some((c) => c.url.includes('lang=en'))).toBe(true)
    expect(reads.some((c) => c.url.includes('lang=es'))).toBe(true)
  })
})
