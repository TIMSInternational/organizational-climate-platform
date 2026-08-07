import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateDetailPage from './MicroclimateDetailPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { MicroclimateDetail } from '../api/microclimates'

function detail(overrides: Partial<MicroclimateDetail> = {}): MicroclimateDetail {
  return {
    id: 'm1',
    title: 'Friday pulse',
    description: null,
    companyId: 'c1',
    createdBy: 'u1',
    status: 'draft',
    responseCount: 0,
    targetParticipantCount: 40,
    startTime: '2026-08-07T09:00:00Z',
    endTime: '2026-08-07T09:20:00Z',
    anonymousResponses: true,
    showLiveResults: true,
    questions: [
      { id: 'q1', text: 'How was the week?', type: 'open_ended', options: null, required: true, order: 1 },
    ],
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/m1']}>
        <Routes>
          <Route path="/microclimates/:id" element={<MicroclimateDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(detail())))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MicroclimateDetailPage', () => {
  it('sends the reader locale, so a bilingual session resolves for them and not for itself', async () => {
    // Letting the server default `lang` resolves against the microclimate's own
    // language, which silently serves English to a Spanish reader.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderPage()

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('lang=es')
  })

  it('renders the status in the reader language rather than the wire value', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderPage()

    // "Borrador", not "draft" -- and masculine, because a microclimate is *un*
    // microclima where a survey is *una* encuesta.
    expect((await screen.findAllByText('Borrador')).length).toBeGreaterThan(0)
  })

  it('offers only the transition that makes sense from here', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: 'Launch' })).toBeTruthy()
    // Reopening a closed session would restart collection on results somebody has
    // already read, so `closed` is not offered from `draft` either.
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull()
  })

  it('renders the publish gate refusal verbatim, without blanking the page', async () => {
    // The gate names the fields that were never translated. A client-side guess
    // could not, which is why it is not pre-checked.
    renderPage()
    await screen.findByRole('button', { name: 'Launch' })

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'Missing translations: questions[1].text', missingTranslations: ['questions[1].text'] }),
        { status: 400 },
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Launch' }))

    expect(await screen.findByText(/Missing translations/)).toBeTruthy()
    // Still on the page it was about.
    expect(screen.getByText('How was the week?')).toBeTruthy()
  })

  it('links the live view only once the session is open', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Launch' })
    expect(screen.queryByRole('link', { name: 'View Live' })).toBeNull()

    cleanup()
    vi.mocked(fetch).mockResolvedValue(ok(detail({ status: 'active' })))
    renderPage()
    expect(await screen.findByRole('link', { name: 'View Live' })).toBeTruthy()
  })

  it('names an untitled session instead of rendering an empty link', async () => {
    // #195's resolver returns null when there is no text in any language, so the
    // caller has to decide -- an unlabelled heading is not a decision.
    vi.mocked(fetch).mockResolvedValue(ok(detail({ title: null })))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Untitled microclimate' })).toBeTruthy()
  })
})
