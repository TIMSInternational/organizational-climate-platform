import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import PublicSurveyLinkPage from './pages/PublicSurveyLinkPage'
import SurveyInvitationPage from './pages/SurveyInvitationPage'
import { TranslationProvider } from '../../i18n'
import { CATALOGUES, LOCALE_STORAGE_KEY } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'
import { singleLanguageOf } from './useSurveyInterfaceLocale'
import type { SurveyRespondView } from './api/surveyResponses'
import type { SurveyInvitationTokenDetail, SurveyPublicLinkDetail } from './api/surveyLinks'

/**
 * Gap #9 of `docs/audits/2026-11-19-what-still-needs-a-developer.md`: the PROCOMER link, opened
 * by a browser set to English, said «Start answering» over a Spanish-only survey. A
 * single-language survey now sets the respondent interface to its language; a bilingual one
 * leaves it to the browser; the visitor's own choice wins over both.
 */

const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const es = createTranslator(CATALOGUES.es)
const en = createTranslator(CATALOGUES.en)

function link(language: string): SurveyPublicLinkDetail {
  return {
    surveyId: 'survey-77',
    surveyTitle: 'Clima laboral 2026',
    surveyDescription: null,
    language,
    resolvedLocale: language === 'both' ? 'en' : language,
    fallbackFields: [],
    surveyStartDate: '2026-01-01T00:00:00Z',
    surveyEndDate: '2026-12-31T00:00:00Z',
    requireLogin: false,
    allowAnonymous: true,
    singleResponse: true,
    companyName: 'PROCOMER',
    companyLogoUrl: null,
  }
}

function invitation(language: string): SurveyInvitationTokenDetail {
  return {
    invitationId: 'inv-1',
    surveyId: 'survey-77',
    surveyTitle: 'Clima laboral 2026',
    surveyDescription: null,
    language,
    resolvedLocale: language,
    fallbackFields: [],
    status: 'sent',
    surveyStartDate: '2026-01-01T00:00:00Z',
    surveyEndDate: '2026-12-31T00:00:00Z',
    expiresAt: '2026-11-30T00:00:00Z',
    anonymity: {
      anonymous: true,
      highestRecordableState: 'opened',
      suppressedStates: ['started', 'completed'],
      guarantee: 'Tracking stops at opened.',
    },
  }
}

/**
 * The respond view as the server answers it: a single-language survey comes back in its own
 * language whatever `lang` asked for; a bilingual one in the language asked for.
 */
function respondView(language: string, requested: string): SurveyRespondView {
  const resolved = language === 'both' ? requested : language
  return {
    id: 'survey-77',
    title: 'Clima laboral 2026',
    description: null,
    type: 'general_climate',
    language,
    resolvedLocale: resolved,
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-12-31T18:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    autoSave: true,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1',
        text: resolved === 'es' ? '¿Cómo se siente?' : 'How do you feel?',
        type: 'multiple_choice',
        options: [{ order: 0, value: 'good', label: resolved === 'es' ? 'Bien' : 'Good' }],
        scaleMin: null,
        scaleMax: null,
        scaleLabelMin: null,
        scaleLabelMax: null,
        required: true,
        commentRequired: false,
        commentPrompt: null,
        order: 0,
        category: null,
      },
    ],
    demographics: [],
    inProgress: null,
  }
}

const SUBMISSION = {
  responseId: 'r1',
  sessionId: 'session-1',
  isComplete: true,
  isAnonymous: true,
  alreadySubmitted: false,
  language: 'es',
  answeredQuestionCount: 1,
  questionCount: 1,
  suppressedDemographics: [],
}

function serve(language: string): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/survey-links/')) return Promise.resolve(new Response(JSON.stringify(link(language)), { status: 200 }))
    if (url.includes('/survey-invitations/') && init?.method === 'POST') return Promise.resolve(new Response('{}', { status: 200 }))
    if (url.includes('/survey-invitations/')) return Promise.resolve(new Response(JSON.stringify(invitation(language)), { status: 200 }))
    if (url.includes('/responses')) return Promise.resolve(new Response(JSON.stringify(SUBMISSION), { status: 201 }))
    const requested = new URL(url, 'http://localhost').searchParams.get('lang') ?? 'en'
    return Promise.resolve(new Response(JSON.stringify(respondView(language, requested)), { status: 200 }))
  })
}

function respondReads(): string[] {
  return vi.mocked(fetch).mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/respond'))
}

/** Lets every effect queued by the landing run, so a late adoption would have happened by now. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

function renderLink() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
        <Routes>
          <Route path="/s/:token" element={<PublicSurveyLinkPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function renderInvitation() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/survey-invitations/${TOKEN}`]}>
        <Routes>
          <Route path="/survey-invitations/:token" element={<SurveyInvitationPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  // A browser set to English, and a visitor who has never chosen a language here.
  window.localStorage.clear()
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['en-US', 'en'])
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('singleLanguageOf', () => {
  it('names the language of a one-language survey and none for a bilingual one', () => {
    expect(singleLanguageOf('es')).toBe('es')
    expect(singleLanguageOf('en')).toBe('en')
    expect(singleLanguageOf('both')).toBeNull()
    expect(singleLanguageOf(undefined)).toBeNull()
  })
})

describe('a single-language survey sets the respondent interface language', () => {
  it('opens a Spanish-only share link in Spanish on an English browser', async () => {
    serve('es')
    renderLink()

    expect(await screen.findByRole('button', { name: /Empezar a responder/ })).toBeTruthy()
    expect(document.documentElement.lang).toBe('es')
    expect(screen.queryByRole('button', { name: new RegExp(en('surveyRespond.next.entryStart')) })).toBeNull()
    // The view on screen was read in the interface's language, so its `resolvedLocale` equals the
    // interface locale -- the condition `effectiveText` needs to show the client's own words.
    const reads = respondReads()
    expect(reads[reads.length - 1]).toContain('lang=es')
    // Not persisted: the survey's language is not the visitor's preference.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
  })

  it('carries the Spanish through the questions to the thank-you', async () => {
    serve('es')
    renderLink()

    await userEvent.click(await screen.findByRole('button', { name: /Empezar a responder/ }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Bien' }))
    await userEvent.click(screen.getByRole('button', { name: es('surveyRespond.submitResponse') }))

    expect(await screen.findByText(es('surveyRespond.thankYouTitle'))).toBeTruthy()
  })

  it('opens a personal-link invitation for a Spanish-only survey in Spanish', async () => {
    serve('es')
    renderInvitation()

    expect(await screen.findByRole('button', { name: 'Empezar a responder' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('es')
  })

  it('opens an English-only survey in English on a Spanish browser', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['es-CR', 'es'])
    serve('en')
    renderLink()

    expect(await screen.findByRole('button', { name: /Start answering/ })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
  })

  it('leaves a bilingual survey to the browser', async () => {
    serve('both')
    renderLink()

    await screen.findByRole('button', { name: /Start answering/ })
    await settle()
    expect(screen.getByRole('button', { name: /Start answering/ })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    expect(respondReads().every((url) => url.includes('lang=en'))).toBe(true)
  })

  it('never overrides a language the visitor chose', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    serve('es')
    renderLink()

    await screen.findByRole('button', { name: /Start answering/ })
    await settle()
    expect(screen.getByRole('button', { name: /Start answering/ })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })

  it('lets the visitor switch away from the survey language, and keeps the choice', async () => {
    serve('es')
    renderLink()
    await screen.findByRole('button', { name: /Empezar a responder/ })

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cambiar idioma' }), 'en')

    await screen.findByRole('button', { name: /Start answering/ })
    await settle()
    expect(screen.getByRole('button', { name: /Start answering/ })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
  })
})
