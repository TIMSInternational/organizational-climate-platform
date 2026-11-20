import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyRespondForm from '../components/SurveyRespondForm'
import RespondPreviewPage from './RespondPreviewPage'
import { TranslationProvider } from '../../../i18n'
import { CATALOGUES, LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { createTranslator } from '../../../i18n/translate'
import { getSurveyRespondView, submitSurveyResponse, type SurveyRespondQuestion, type SurveyRespondView } from '../api/surveyResponses'
import { clearSessionId, ensureSessionId } from '../respondSession'
import { hasAnswered, markAnswered } from '../respondReceipt'
import { orderQuestions } from '../respondAnswers'
import { RESPOND_AUTOSAVE_DELAY_MS } from '../respondAutosave'
import type { RespondPreviewSeam } from '../respondPreview'

// Every respondent side effect the form has, spied on so a preview can be shown to reach none
// of them. The real implementations run underneath: a call that slipped through would still do
// what it does, and the test below would still see it.
vi.mock('../api/surveyResponses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/surveyResponses')>()
  return {
    ...actual,
    getSurveyRespondView: vi.fn(actual.getSurveyRespondView),
    submitSurveyResponse: vi.fn(actual.submitSurveyResponse),
  }
})
vi.mock('../respondSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../respondSession')>()
  return { ...actual, ensureSessionId: vi.fn(actual.ensureSessionId), clearSessionId: vi.fn(actual.clearSessionId) }
})
vi.mock('../respondReceipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../respondReceipt')>()
  return { ...actual, hasAnswered: vi.fn(actual.hasAnswered), markAnswered: vi.fn(actual.markAnswered) }
})

const es = createTranslator(CATALOGUES.es)

function question(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return {
    id: 'q1',
    text: 'Pregunta 1',
    type: 'multiple_choice',
    options: [
      { order: 0, value: 'yes', label: 'Sí' },
      { order: 1, value: 'no', label: 'No' },
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

/** Partial responses and autosave ON: the survey on which a respondent's page writes the most. */
function view(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 's1',
    title: 'Clima 2026',
    description: null,
    type: 'general_climate',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-12T12:00:00Z',
    anonymous: true,
    allowPartialResponses: true,
    autoSave: true,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [question(), question({ id: 'q2', text: 'Pregunta 2', order: 1 })],
    demographics: [],
    inProgress: null,
    closingMessage: 'Gracias de parte de la empresa',
    // The server sends the effective texts beside the legacy fields (survey → company →
    // default), and the screens read `content`: a preview shows the client's own words.
    content: {
      thankYouTitle: 'Gracias de parte de la empresa',
      anonymousBody: 'Párrafo de anonimato de la empresa',
    },
    ...overrides,
  }
}

/** Every respondent write and every browser-local record a respondent leaves, as one assertion. */
function expectNothingSaved() {
  expect(submitSurveyResponse).not.toHaveBeenCalled()
  expect(getSurveyRespondView).not.toHaveBeenCalled()
  expect(ensureSessionId).not.toHaveBeenCalled()
  expect(clearSessionId).not.toHaveBeenCalled()
  expect(hasAnswered).not.toHaveBeenCalled()
  expect(markAnswered).not.toHaveBeenCalled()
  // The session id, the answered flag and the open-tab lock all live in localStorage: a
  // preview leaves only the language the test itself set.
  expect(Object.keys(window.localStorage)).toEqual([LOCALE_STORAGE_KEY])
}

/** Answers the question on screen, waits out the autosave debounce, and turns the page. */
async function answerAndWalkToTheEnd() {
  await userEvent.click(await screen.findByRole('radio', { name: 'Sí' }))
  await new Promise((resolve) => setTimeout(resolve, RESPOND_AUTOSAVE_DELAY_MS + 300))
  await userEvent.click(screen.getByRole('button', { name: es('surveyRespond.next.next') }))
  await userEvent.click(await screen.findByRole('radio', { name: 'No' }))
  await userEvent.click(screen.getByRole('button', { name: es('surveyRespond.submitResponse') }))
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(getSurveyRespondView).mockClear()
  vi.mocked(submitSurveyResponse).mockClear()
  vi.mocked(ensureSessionId).mockClear()
  vi.mocked(clearSessionId).mockClear()
  vi.mocked(hasAnswered).mockClear()
  vi.mocked(markAnswered).mockClear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SurveyRespondForm in preview mode', () => {
  function renderPreview(seam: RespondPreviewSeam) {
    return render(
      <TranslationProvider>
        <MemoryRouter initialEntries={['/surveys/s1/preview']}>
          <SurveyRespondForm surveyId="s1" publicEntry preview={seam} />
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  it('walks every question to the thank-you without a session, an autosave, a submit, a receipt or a lock', async () => {
    const load = vi.fn((lang: string) => {
      void lang
      return Promise.resolve(view())
    })
    renderPreview({ load, seed: 'preview:test' })

    await answerAndWalkToTheEnd()

    expect(await screen.findByText('Gracias de parte de la empresa')).toBeTruthy()
    expect(load).toHaveBeenCalledWith('es')
    expectNothingSaved()
    expect(fetch).not.toHaveBeenCalled()
  }, 15000)

  it('serves the questions in the order the preview seed shuffles them, not the authored one', async () => {
    const questions = Array.from({ length: 8 }, (_, index) =>
      question({ id: `q${index}`, text: `Pregunta ${index}`, order: index }),
    )
    const randomised = view({ randomizeQuestions: true, questions })
    // A seed whose first question is not the authored first, so the assertion cannot pass by
    // accident on an unshuffled form.
    const seed = ['preview:a', 'preview:b', 'preview:c', 'preview:d'].find(
      (candidate) => orderQuestions(questions, true, candidate)[0].id !== 'q0',
    )!
    const first = orderQuestions(questions, true, seed)[0]

    renderPreview({ load: () => Promise.resolve(randomised), seed })

    expect(await screen.findByText(first.text ?? '')).toBeTruthy()
    expect(screen.queryByText('Pregunta 0')).toBeNull()
    expectNothingSaved()
  })

  it('without the seam, the same form does reach the session and the respond GET (the spies bite)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(view()), { status: 200 }))
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={['/survey/s1']}>
          <SurveyRespondForm surveyId="s1" publicEntry />
        </MemoryRouter>
      </TranslationProvider>,
    )

    await screen.findByText('Pregunta 1')
    expect(ensureSessionId).toHaveBeenCalledWith('s1')
    expect(getSurveyRespondView).toHaveBeenCalled()
    expect(hasAnswered).toHaveBeenCalledWith('s1')
  })
})

describe('RespondPreviewPage', () => {
  it('shows the banner over the start page, the questions and the thank-you, and only ever reads', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ view: view(), companyName: 'Empresa', companyLogoUrl: null, status: 'draft' }),
          { status: 200 },
        ),
      ),
    )

    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={['/surveys/s1/preview']}>
          <Routes>
            <Route path="/surveys/:id/preview" element={<RespondPreviewPage />} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )

    const banner = es('surveys.next.respondPreview.banner')
    expect(await screen.findByText(banner)).toBeTruthy()
    expect(await screen.findByText('Clima 2026')).toBeTruthy()
    expect(screen.getByText('Párrafo de anonimato de la empresa')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: es('surveyRespond.next.entryStart') }))
    expect(screen.getByText(banner)).toBeTruthy()
    await answerAndWalkToTheEnd()

    expect(await screen.findByText('Gracias de parte de la empresa')).toBeTruthy()
    expect(screen.getByText(banner)).toBeTruthy()
    expectNothingSaved()

    // Every request the page made was the preview's GET.
    const requests = vi.mocked(fetch).mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? 'GET',
    }))
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      expect(request.method).toBe('GET')
      expect(request.url).toContain('/surveys/s1/respond-preview?lang=')
    }
    await waitFor(() => expect(submitSurveyResponse).not.toHaveBeenCalled())
  }, 15000)

  /**
   * A Spanish-only survey opened by an operator whose browser is in English and who never chose a
   * language: the real link adopts Spanish (`useSurveyInterfaceLocale`), so the preview must too,
   * or its start page draws the English default where the respondent reads the client's words.
   */
  it('adopts a one-language survey\'s language on the start page, as the real link does', async () => {
    window.localStorage.clear()
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(
          // The server answers a Spanish-only survey in Spanish whatever `lang` asked for.
          JSON.stringify({ view: view(), companyName: 'Empresa', companyLogoUrl: null, status: 'draft' }),
          { status: 200 },
        ),
      ),
    )

    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={['/surveys/s1/preview']}>
          <Routes>
            <Route path="/surveys/:id/preview" element={<RespondPreviewPage />} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )

    expect(await screen.findByText('Párrafo de anonimato de la empresa')).toBeTruthy()
    expect(screen.getByRole('button', { name: es('surveyRespond.next.entryStart') })).toBeTruthy()
    // Adopted, never persisted: the operator's own language is untouched.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
    languages.mockRestore()
  }, 15000)
})
