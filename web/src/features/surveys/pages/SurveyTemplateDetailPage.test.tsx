import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { setToken, clearToken } from '../../../auth/token'
import SurveyTemplateDetailPage from './SurveyTemplateDetailPage'
import type { SurveyTemplateDetail } from '../api/surveyTemplates'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

function template(overrides: Partial<SurveyTemplateDetail> = {}): SurveyTemplateDetail {
  return {
    id: 't1',
    name: 'Quarterly climate',
    description: 'A standard quarterly pulse',
    category: 'climate',
    industry: null,
    companySize: null,
    isPublic: true,
    companyId: null,
    isGlobal: true,
    tags: ['climate'],
    usageCount: 3,
    rating: 4,
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    questions: [
      {
        id: 'q1',
        text: 'I feel supported by my manager',
        type: 'likert',
        options: null,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabelMin: null,
        scaleLabelMax: null,
        required: true,
        commentRequired: false,
        commentPrompt: null,
        order: 0,
        category: null,
      },
    ],
    sourceSurveyId: null,
    lastUsed: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/templates/t1']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/templates/:id" element={<SurveyTemplateDetailPage />} />
            <Route path="/surveys/:id" element={<div>survey page</div>} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SurveyTemplateDetailPage', () => {
  it('instantiates the template and navigates to the SURVEY it returned, not the template', async () => {
    // `/use` answers 201 with a SurveyDetail. Treating the response as a template
    // would navigate to /surveys/t1 -- the template's own id -- which resolves to a
    // survey that does not exist.
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(template()))
      .mockResolvedValueOnce(ok({ id: 'new-survey-id' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Use This Template' }))

    expect(await screen.findByText('survey page')).toBeTruthy()
    expect(String(fetchMock.mock.calls[1][0])).toContain('/survey-templates/t1/use')
  })

  it('asks a super admin to choose a company instead of firing a request with nowhere to put the survey', async () => {
    // `/use` requires a companyId for this role -- a global super admin has had no
    // implicit tenant since #191. Letting the call fail would produce a 400 that reads
    // like a bug rather than a missing choice.
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
    const fetchMock = vi.fn().mockResolvedValue(ok(template()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(
      await screen.findByText(
        'Choose a company from the header before creating a survey from this template.',
      ),
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Use This Template' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('sends the selected company for a super admin who has chosen one', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'chosen-company')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(template()))
      .mockResolvedValueOnce(ok({ id: 'new-survey-id' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Use This Template' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[1][1].body)).toContain('chosen-company')
  })

  it('renders the server’s refusal without blanking the template underneath it', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    const message = 'A template with no questions cannot create a survey.'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok(template()))
        .mockResolvedValueOnce(ok({ message }, 400)),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Use This Template' }))

    expect((await screen.findByRole('alert')).textContent).toContain(message)
    expect(screen.getByRole('heading', { name: 'Quarterly climate' })).toBeTruthy()
  })

  it('reports the questions’ fallback, which is the only localized content on the page', async () => {
    // The name and description are single unpaired `text` columns, so they are
    // monolingual whatever locale is asked for. `language` describes the questions.
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok(template({ language: 'es', resolvedLocale: 'es', fallbackFields: ['questions[0].text'] })),
      ),
    )
    renderPage()

    expect(
      await screen.findByText('Showing content in Spanish because it is not available in English.'),
    ).toBeTruthy()
    // The unlocalized name is still rendered as stored, not hidden or marked up.
    expect(screen.getByRole('heading', { name: 'Quarterly climate' })).toBeTruthy()
  })

  it('renders a template with no questions as an empty state rather than an empty table', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(template({ questions: [] }))))
    renderPage()

    expect(await screen.findByText('No questions')).toBeTruthy()
  })
})
