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
